import API_BASE from "../config/admin_api.js";
import { apiPost } from "../config/apiClient.js";

export async function adminLogin(email, password) {
  const res = await fetch(`${API_BASE}/auth/login.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, password }),
  });
  const data = await res.json();

  if (res.ok && data.session_token) {
    localStorage.setItem("admin_token", data.session_token);
    localStorage.setItem("admin", JSON.stringify(data.admin));
  }

  return { ok: res.ok, data };
}

export async function adminLogout() {
  await apiPost("/auth/logout.php", {});
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin");
}
