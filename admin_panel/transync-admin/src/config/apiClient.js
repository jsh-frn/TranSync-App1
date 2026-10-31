/**
 * Thin fetch wrapper that auto-attaches the admin session token from localStorage.
 * Use this instead of raw fetch() for all authenticated admin API calls.
 */
import API_BASE from "./admin_api.js";

function getToken() {
  try {
    const raw = localStorage.getItem("admin_token");
    return raw || null;
  } catch {
    return null;
  }
}

function authHeaders(extra = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders(),
  });
  return res;
}

export async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method:  "POST",
    headers: authHeaders(),
    body:    JSON.stringify(body),
  });
  return res;
}

export async function apiDelete(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    method:  "DELETE",
    headers: authHeaders(),
  });
  return res;
}

/**
 * Drop-in replacement for fetch() that automatically adds the Authorization header.
 * Pages can swap `fetch(url, opts)` → `authFetch(url, opts)` with no other changes.
 */
export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}

export function clearAdminSession() {
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin");
}
