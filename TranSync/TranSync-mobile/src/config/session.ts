import AsyncStorage from "@react-native-async-storage/async-storage";

// Mirrors the admin panel's proven pattern (admin_panel/transync-admin/src/
// config/apiClient.js's authFetch()), adapted for AsyncStorage's async API
// in place of localStorage's sync one.

export async function getToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem("session_token");
  } catch {
    return null;
  }
}

/**
 * Drop-in replacement for fetch() that automatically adds the Authorization
 * header when a session token is stored. Never sets/overwrites Content-Type
 * or any other header the caller already passed — only adds Authorization.
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers = { ...(options.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}
