import { apiGet, apiDelete } from "../config/apiClient.js";

export async function getOverview() {
  const res = await apiGet("/system/overview.php");
  return res.json();
}

export async function getUsers(type) {
  const res = await apiGet(`/system/users.php?type=${type}`);
  return res.json();
}

export async function deleteUser(id, type) {
  const res = await apiDelete(`/system/users.php?id=${id}&type=${type}`);
  return res.json();
}

export async function getTerminals() {
  const res = await apiGet("/system/terminals.php");
  return res.json();
}
