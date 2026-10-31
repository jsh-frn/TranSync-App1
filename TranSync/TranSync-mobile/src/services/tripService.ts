import API_BASE from "../config/api";

export async function getActiveRide(commuterId: number) {
  const res = await fetch(`${API_BASE}/trips/active_ride.php?commuter_id=${commuterId}`);
  return res.json();
}

export async function getLatestRide(driverId: number) {
  const res = await fetch(`${API_BASE}/trips/latest_ride.php?driver_id=${driverId}`);
  return res.json();
}

export async function requestDropoff(rideId: number, lat: number, lng: number) {
  const res = await fetch(`${API_BASE}/trips/request_dropoff.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ride_id: rideId, dropoff_lat: lat, dropoff_lng: lng }),
  });
  return res.json();
}

export async function cancelDropoff(rideId: number) {
  const res = await fetch(`${API_BASE}/trips/cancel_dropoff.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ride_id: rideId }),
  });
  return res.json();
}

export async function endRide(
  rideId: number,
  dropoffLat: number,
  dropoffLng: number,
  triggeredBy: "commuter" | "auto",
) {
  const res = await fetch(`${API_BASE}/trips/end_ride.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      ride_id:      rideId,
      dropoff_lat:  dropoffLat,
      dropoff_lng:  dropoffLng,
      triggered_by: triggeredBy,
    }),
  });
  return res.json();
}

export async function startTrip(driverId: number) {
  const res = await fetch(`${API_BASE}/trips/start_trip.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ driver_id: driverId }),
  });
  return res.json();
}

export async function endTrip(driverId: number) {
  const res = await fetch(`${API_BASE}/trips/end_trip.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ driver_id: driverId }),
  });
  return res.json();
}

export async function joinQueue(driverId: number, operatorId: number) {
  const res = await fetch(`${API_BASE}/queue/join_queue.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ driver_id: driverId, operator_id: operatorId }),
  });
  return res.json();
}

export async function leaveQueue(driverId: number) {
  const res = await fetch(`${API_BASE}/queue/leave_queue.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ driver_id: driverId }),
  });
  return res.json();
}

export async function getQueuePosition(driverId: number, operatorId: number) {
  const res = await fetch(
    `${API_BASE}/queue/queue_position.php?driver_id=${driverId}&operator_id=${operatorId}`,
  );
  return res.json();
}

export async function getNearbyCommuters(lat: number, lng: number) {
  const res = await fetch(
    `${API_BASE}/commuter/nearby_commuters.php?lat=${lat}&lng=${lng}`,
  );
  return res.json();
}

export async function getNearbyDriversByDestination(lat: number, lng: number) {
  const res = await fetch(
    `${API_BASE}/commuter/nearby_drivers_by_destination.php?lat=${lat}&lng=${lng}`,
  );
  return res.json();
}

export async function verifyQr(token: string) {
  const res = await fetch(`${API_BASE}/system/verify_qr_board.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ token }),
  });
  return res.json();
}
