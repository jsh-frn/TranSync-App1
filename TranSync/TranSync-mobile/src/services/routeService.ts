import API_BASE from "../config/api";

export async function getCommuterRoutes() {
  const res = await fetch(`${API_BASE}/routes/get_commuter_routes.php`);
  return res.json();
}

export async function getAllRoutes() {
  const res = await fetch(`${API_BASE}/routes/get_all_routes.php`);
  return res.json();
}

export async function getRoutes(operatorId?: number) {
  const url = operatorId
    ? `${API_BASE}/routes/get_routes.php?operator_id=${operatorId}`
    : `${API_BASE}/routes/get_routes.php`;
  const res = await fetch(url);
  return res.json();
}

export async function getAssociationRoutes(associationId: number) {
  const res = await fetch(`${API_BASE}/routes/get_association_routes.php?association_id=${associationId}`);
  return res.json();
}

export async function getDriverRoute(driverId: number) {
  const res = await fetch(`${API_BASE}/drivers/get_driver_route.php?driver_id=${driverId}`);
  return res.json();
}

export interface PlanJourneyParams {
  destination: string;
  origin?: string;
  origLat?: number;
  origLng?: number;
  destLat?: number;
  destLng?: number;
}

export async function planJourney(params: PlanJourneyParams) {
  const qs = new URLSearchParams({ destination: params.destination });
  if (params.destLat != null) qs.append("dest_lat", String(params.destLat));
  if (params.destLng != null) qs.append("dest_lng", String(params.destLng));
  if (params.origLat != null) {
    qs.append("orig_lat", String(params.origLat));
    qs.append("orig_lng", String(params.origLng!));
  } else if (params.origin?.trim()) {
    qs.append("origin", params.origin.trim());
  }
  const res = await fetch(`${API_BASE}/routes/route_planner.php?${qs.toString()}`);
  return res.json();
}

export async function saveRoute(formData: FormData) {
  const res = await fetch(`${API_BASE}/routes/save_route.php`, {
    method: "POST",
    body:   formData,
  });
  return res.json();
}

export async function deleteRoute(routeId: number) {
  const res = await fetch(`${API_BASE}/routes/delete_route.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ route_id: routeId }),
  });
  return res.json();
}

export async function assignRoute(driverId: number, routeId: number) {
  const res = await fetch(`${API_BASE}/routes/assign_route.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ driver_id: driverId, route_id: routeId }),
  });
  return res.json();
}

export async function assignAssociationDriver(driverId: number, routeId: number) {
  const res = await fetch(`${API_BASE}/associations/assign_association_driver.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ driver_id: driverId, route_id: routeId }),
  });
  return res.json();
}
