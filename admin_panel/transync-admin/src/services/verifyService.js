import { apiGet, apiPost } from "../config/apiClient.js";

export async function getPendingVerifications(type) {
  const res = await apiGet(`/auth/verify.php?type=${type}`);
  return res.json();
}

export async function reviewVerification(id, type, action) {
  const res = await apiPost("/auth/verify.php", { id, type, action });
  return res.json();
}
