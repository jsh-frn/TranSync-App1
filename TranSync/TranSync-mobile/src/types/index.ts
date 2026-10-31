// ── Shared domain types ────────────────────────────────────────────────────

export type UserRole = "commuter" | "driver" | "operator" | "association";

export type VerificationStatus = "active" | "inactive";

export type VehicleType = "Jeepney" | "UV Express" | "Bus";

export type CommuterCategory = "default" | "student" | "disabled" | "elderly";

export interface Commuter {
  id: number;
  name: string;
  email: string;
  phone: string;
  category: CommuterCategory;
  is_verified: 0 | 1;
  status: VerificationStatus;
  rejected_at: string | null;
  latitude?: number;
  longitude?: number;
}

export interface Driver {
  id: number;
  name: string;
  email: string;
  phone: string;
  license_number: string;
  status: VerificationStatus;
  operator_id: number | null;
  association_id: number | null;
  vehicle_id: number | null;
  latitude?: number;
  longitude?: number;
  is_online: 0 | 1;
  is_full: 0 | 1;
  wallet_balance: number;
}

export interface Vehicle {
  id: number;
  operator_id: number;
  type: VehicleType;
  plate_number: string;
  status: "active" | "inactive";
  driver_id: number | null;
  seat_config: string | null;
}

export interface Route {
  id: number;
  name: string;
  from_location: string | null;
  to_location: string | null;
  fare: number | null;
  vehicle_type: VehicleType | null;
  color: string;
  has_waypoints: 0 | 1;
  status: "active" | "inactive";
  waypoints?: Waypoint[];
}

export interface Waypoint {
  latitude: number;
  longitude: number;
}

export interface Association {
  id: number;
  name: string;
  address: string;
  contact_email: string;
  contact_phone: string;
  status: "active" | "inactive" | "pending";
}

export type DiscountType = "default" | "student" | "disabled" | "elderly";

export interface JeepneyRide {
  id: number;
  commuter_id: number;
  driver_id: number;
  status: "active" | "completed" | "cancelled" | "dropoff_requested";
  board_lat: number | null;
  board_lng: number | null;
  board_time: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_time: string | null;
  distance_km: number | null;
  fare_amount: number | null;
  discount_type: DiscountType;
}

export interface WalletTransaction {
  id: number;
  type: "debit" | "credit";
  amount: number;
  reference_type: "jeepney_ride" | "booking" | "topup" | "refund";
  reference_id: number | null;
  balance_after: number;
  note: string;
  created_at: string;
}
