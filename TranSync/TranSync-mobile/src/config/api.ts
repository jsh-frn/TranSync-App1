import { Platform } from "react-native";

// Set EXPO_PUBLIC_API_BASE_URL (see .env.example) to point a build at a real
// server, e.g. https://api.transync.app/TranSync-App/transync-backend/api —
// required for any production/EAS build, since a hardcoded LAN IP or
// localhost only ever works on the dev machine's own network. Falls back to
// the old per-platform local-dev defaults when unset, so existing local dev
// workflows keep working unchanged.
const ENV_API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, "");

const API_BASE = ENV_API_BASE || (Platform.OS === "web"
  ? "http://localhost/TranSync-App/transync-backend/api"
  : "http://192.168.1.3/TranSync-App/transync-backend/api");

// Base for static files (uploads/...) served straight by Apache, not through
// api/*.php — derived from the same host API_BASE already resolves per
// platform (localhost on web, the LAN IP on a real device/emulator), so a
// relative path returned by the backend (e.g. avatar_url) always resolves to
// a host this client can actually reach. Endpoints must NOT hardcode
// "http://localhost/..." into a URL handed back to the mobile client — that
// only ever works on Expo web, never on a physical device or emulator, where
// "localhost" means the device itself.
export const FILE_BASE = API_BASE.replace(/\/api\/?$/, "/");

export default API_BASE;

