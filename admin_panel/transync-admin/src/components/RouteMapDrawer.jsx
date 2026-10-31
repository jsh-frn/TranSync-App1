import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { GoogleMap, Marker } from "@react-google-maps/api";

const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };
const DEFAULT_CENTER = { lat: 15.14, lng: 120.67 };
const DEFAULT_ZOOM = 12;
const MAP_OPTIONS = {
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: true,
  mapTypeControlOptions: {
    position: 3, // google.maps.ControlPosition.TOP_RIGHT — keeps top-left clear for our buttons
  },
  fullscreenControl: false,
  clickableIcons: false,
  gestureHandling: "cooperative",
};

const GHOST_ICONS = [
  {
    icon: {
      path: "M 0,-1 0,1",
      strokeOpacity: 0.55,
      strokeWeight: 3,
      strokeColor: "#9ca3af",
      scale: 3,
    },
    offset: "0",
    repeat: "12px",
  },
];

const SEARCH_PIN_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36">
    <path d="M14 0C6.268 0 0 6.268 0 14C0 22.732 14 36 14 36C14 36 28 22.732 28 14C28 6.268 21.732 0 14 0Z" fill="#4285F4"/>
    <circle cx="14" cy="14" r="6" fill="white"/>
  </svg>`
);

// Module-level helper — no dependency on component state
const toLatLng = (wps) => wps.map((wp) => ({ lat: wp.latitude, lng: wp.longitude }));

function makeIcon(color, label, isSelected, isGhost) {
  const bg   = isGhost ? "#9ca3af" : isSelected ? "#ffffff" : color;
  const size = isSelected ? 22 : label ? 26 : 14;

  let svg;
  if (label) {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26">
      <circle cx="13" cy="13" r="12" fill="${isGhost ? "#9ca3af" : color}" stroke="white" stroke-width="2.5"/>
      <text x="13" y="17.5" text-anchor="middle" fill="white" font-size="11" font-weight="bold" font-family="Arial,sans-serif">${label}</text>
    </svg>`;
  } else if (isSelected) {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22">
      <circle cx="11" cy="11" r="10" fill="white" stroke="${color}" stroke-width="3"/>
    </svg>`;
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="${bg}" stroke="white" stroke-width="2"/>
    </svg>`;
  }

  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(size, size),
    anchor: new window.google.maps.Point(size / 2, size / 2),
  };
}

const SEARCH_ICON = () => ({
  url: `data:image/svg+xml;charset=utf-8,${SEARCH_PIN_SVG}`,
  scaledSize: new window.google.maps.Size(28, 36),
  anchor: new window.google.maps.Point(14, 36),
});

export default function RouteMapDrawer({
  waypoints,
  onChange,
  color = "#1a4a52",
  flyToTarget = null,
  isLoaded = false,
  loadError = null,
  // Terminal-pin mode: when true, map clicks place/move a single terminal marker
  // instead of adding waypoints. Used for the "place a terminal" step before route
  // drawing begins — the rest of this component (waypoint drawing) is unaffected
  // and stays backward-compatible when these props are simply omitted.
  terminalMode = false,
  terminalPoint = null,
  onTerminalChange = null,
  stopoverPoints = [],
}) {
  const [history,     setHistory]     = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [searchPin,   setSearchPin]   = useState(null);
  const [mapReady,    setMapReady]    = useState(false);

  const mapRef        = useRef(null);
  const prevFlyTs     = useRef(null);
  const polylineRef   = useRef(null);  // solid route line
  const ghostPolyRef  = useRef(null);  // dashed ghost segment

  // ── Derived paths ────────────────────────────────────────────────────────────
  const solidLine = useMemo(
    () => (selectedIdx !== null ? waypoints.slice(0, selectedIdx + 1) : waypoints),
    [selectedIdx, waypoints]
  );
  const ghostLine = useMemo(
    () => (selectedIdx !== null && selectedIdx < waypoints.length - 1
      ? waypoints.slice(selectedIdx)
      : []),
    [selectedIdx, waypoints]
  );

  // ── Imperative polyline: solid ───────────────────────────────────────────────
  // Using useEffect + direct Google Maps API calls instead of <Polyline> to
  // guarantee setPath / setMap(null) fires immediately when waypoints change.
  useEffect(() => {
    if (!mapReady) return;
    const path = toLatLng(solidLine);
    if (solidLine.length >= 2) {
      if (!polylineRef.current) {
        polylineRef.current = new window.google.maps.Polyline({
          map: mapRef.current,
          path,
          strokeColor: color,
          strokeWeight: 5,
          strokeOpacity: 1,
        });
      } else {
        polylineRef.current.setPath(path);
        polylineRef.current.setOptions({ strokeColor: color });
      }
    } else {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
    }
  }, [solidLine, color, mapReady]);

  // ── Imperative polyline: ghost ───────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const path = toLatLng(ghostLine);
    if (ghostLine.length >= 2) {
      if (!ghostPolyRef.current) {
        ghostPolyRef.current = new window.google.maps.Polyline({
          map: mapRef.current,
          path,
          strokeOpacity: 0,
          icons: GHOST_ICONS,
        });
      } else {
        ghostPolyRef.current.setPath(path);
      }
    } else {
      if (ghostPolyRef.current) {
        ghostPolyRef.current.setMap(null);
        ghostPolyRef.current = null;
      }
    }
  }, [ghostLine, mapReady]);

  // ── Cleanup polylines on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (polylineRef.current)  { polylineRef.current.setMap(null);  polylineRef.current  = null; }
      if (ghostPolyRef.current) { ghostPolyRef.current.setMap(null); ghostPolyRef.current = null; }
    };
  }, []);

  // ── Fly-to on search ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flyToTarget || flyToTarget.ts === prevFlyTs.current) return;
    prevFlyTs.current = flyToTarget.ts;
    setSearchPin({ lat: flyToTarget.lat, lng: flyToTarget.lng });
    if (mapRef.current) {
      mapRef.current.panTo({ lat: flyToTarget.lat, lng: flyToTarget.lng });
      mapRef.current.setZoom(16);
    }
  }, [flyToTarget]);

  // ── Map load ─────────────────────────────────────────────────────────────────
  const onMapLoad = useCallback((map) => {
    mapRef.current = map;
    setMapReady(true);
    if (waypoints.length >= 2) {
      const bounds = new window.google.maps.LatLngBounds();
      waypoints.forEach((wp) => bounds.extend({ lat: wp.latitude, lng: wp.longitude }));
      map.fitBounds(bounds, 60);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Drawing handlers ─────────────────────────────────────────────────────────
  const handleMapClick = useCallback((e) => {
    const pt = { latitude: e.latLng.lat(), longitude: e.latLng.lng() };
    if (terminalMode) {
      onTerminalChange?.(pt);
      return;
    }
    if (selectedIdx !== null) {
      const truncated = waypoints.slice(0, selectedIdx + 1);
      setHistory((h) => [...h, waypoints]);
      onChange([...truncated, pt]);
      setSelectedIdx(null);
    } else {
      setHistory((h) => [...h, waypoints]);
      onChange([...waypoints, pt]);
    }
  }, [selectedIdx, waypoints, onChange, terminalMode, onTerminalChange]);

  const undo = useCallback(() => {
    if (!history.length) return;
    onChange(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    setSelectedIdx(null);
  }, [history, onChange]);

  const clear = useCallback(() => {
    if (!waypoints.length) return;
    setHistory((h) => [...h, waypoints]);
    onChange([]);
    setSelectedIdx(null);
  }, [waypoints, onChange]);

  const deleteSelected = useCallback(() => {
    if (selectedIdx === null) return;
    setHistory((h) => [...h, waypoints]);
    onChange(waypoints.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
  }, [selectedIdx, waypoints, onChange]);

  const toggleSelect = useCallback((i) => setSelectedIdx((p) => (p === i ? null : i)), []);

  // ── Derived UI state ─────────────────────────────────────────────────────────
  const canUndo  = history.length > 0;
  const canClear = waypoints.length > 0;

  const bannerText = terminalMode
    ? "Click on the map to place this route's terminal"
    : selectedIdx !== null
      ? `Point ${selectedIdx + 1} selected — click map to resume from here, or delete it above`
      : waypoints.length === 0
        ? "Click on the map to start drawing the route"
        : `${waypoints.length} point${waypoints.length !== 1 ? "s" : ""} — click a point to select / delete it`;

  const btnBase = {
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontFamily: "'Segoe UI', sans-serif",
    transition: "background 0.15s",
  };

  // ── Error / loading states ───────────────────────────────────────────────────
  if (loadError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", background: "#fef2f2", gap: 10, padding: 24 }}>
        <svg style={{ width: 32, height: 32, color: "#f87171" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <span style={{ fontSize: 13, color: "#ef4444", fontWeight: 600, fontFamily: "'Segoe UI', sans-serif" }}>Google Maps failed to load</span>
        <span style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", fontFamily: "'Segoe UI', sans-serif" }}>
          Check that the API key is valid, the Maps JavaScript API and Places API are enabled, and that <strong>localhost</strong> is allowed in the key's referrer restrictions.
        </span>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", background: "#f8fafc", gap: 10 }}>
        <svg style={{ width: 28, height: 28, color: "#94a3b8" }} fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
          <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" opacity="0.75" />
        </svg>
        <span style={{ fontSize: 13, color: "#94a3b8", fontFamily: "'Segoe UI', sans-serif" }}>Loading Google Maps…</span>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        options={MAP_OPTIONS}
        onClick={handleMapClick}
        onLoad={onMapLoad}
      >
        {/* Search result pin */}
        {searchPin && (
          <Marker
            position={{ lat: searchPin.lat, lng: searchPin.lng }}
            icon={SEARCH_ICON()}
            zIndex={500}
            title="Searched location"
          />
        )}

        {/* Terminal marker (place-terminal step, or shown read-only while drawing) */}
        {terminalPoint && (
          <Marker
            position={{ lat: terminalPoint.latitude, lng: terminalPoint.longitude }}
            icon={makeIcon("#1a4a52", null, false, false)}
            zIndex={400}
            title="Terminal"
          />
        )}

        {/* Stopover terminals (read-only reference markers) */}
        {stopoverPoints.map((sp, i) => (
          <Marker
            key={`stopover-${i}`}
            position={{ lat: sp.latitude, lng: sp.longitude }}
            icon={makeIcon("#9333ea", null, false, false)}
            zIndex={300}
            title={sp.name ?? "Stopover"}
          />
        ))}

        {/* Waypoint markers */}
        {!terminalMode && waypoints.map((wp, i) => {
          const isFirst    = i === 0;
          const isLast     = i === waypoints.length - 1 && waypoints.length > 1;
          const isSelected = selectedIdx === i;
          const isGhost    = selectedIdx !== null && i > selectedIdx;
          const label      = isFirst ? "A" : isLast ? "B" : null;
          return (
            <Marker
              key={i}
              position={{ lat: wp.latitude, lng: wp.longitude }}
              icon={makeIcon(color, label, isSelected, isGhost)}
              onClick={() => toggleSelect(i)}
              zIndex={isSelected ? 100 : i + 10}
            />
          );
        })}
      </GoogleMap>

      {/* Undo / Clear / Delete overlay — hidden during terminal-pin mode since it
          operates on route waypoints, not the terminal */}
      {!terminalMode && (
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 20, display: "flex", gap: 6 }}>
        <button
          onClick={undo}
          disabled={!canUndo}
          title="Undo last action"
          style={{ ...btnBase, background: canUndo ? "white" : "#f1f5f9", color: canUndo ? "#374151" : "#9ca3af", cursor: canUndo ? "pointer" : "not-allowed" }}
        >
          ↩ Undo
        </button>
        <button
          onClick={clear}
          disabled={!canClear}
          title="Clear all points"
          style={{ ...btnBase, background: canClear ? "white" : "#f1f5f9", color: canClear ? "#dc2626" : "#9ca3af", cursor: canClear ? "pointer" : "not-allowed" }}
        >
          ✕ Clear
        </button>
        {selectedIdx !== null && (
          <button
            onClick={deleteSelected}
            title="Delete selected point"
            style={{ ...btnBase, background: "#fee2e2", color: "#dc2626", cursor: "pointer" }}
          >
            🗑 Delete pt {selectedIdx + 1}
          </button>
        )}
      </div>
      )}

      {/* Status banner */}
      <div
        style={{
          position: "absolute",
          bottom: 28,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 5,
          background: selectedIdx !== null ? "#1a4a52" : "rgba(0,0,0,0.65)",
          color: "white",
          fontSize: 12,
          fontWeight: 500,
          padding: "6px 14px",
          borderRadius: 20,
          whiteSpace: "nowrap",
          maxWidth: "90%",
          textAlign: "center",
          pointerEvents: "none",
          fontFamily: "'Segoe UI', sans-serif",
        }}
      >
        {bannerText}
      </div>
    </div>
  );
}
