/**
 * Central API service.
 * Import the specific service file (auth, routes, trips…) rather than
 * calling fetch directly in screen components.
 */
export { default as API_BASE } from "../config/api";

export * from "./authService";
export * from "./routeService";
export * from "./tripService";
export * from "./walletService";

