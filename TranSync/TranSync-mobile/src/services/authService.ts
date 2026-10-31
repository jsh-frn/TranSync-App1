import API_BASE from "../config/api";

export async function loginMobile(email: string, password: string) {
  const res  = await fetch(`${API_BASE}/auth/login_mobile.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, password }),
  });
  return res.json();
}

export async function registerCommuter(formData: FormData) {
  const res = await fetch(`${API_BASE}/auth/commuter_register.php`, {
    method: "POST",
    body:   formData,
  });
  return res.json();
}

export async function registerOperator(formData: FormData) {
  const res = await fetch(`${API_BASE}/auth/operator_register.php`, {
    method: "POST",
    body:   formData,
  });
  return res.json();
}

export async function registerAssociation(formData: FormData) {
  const res = await fetch(`${API_BASE}/auth/association_register.php`, {
    method: "POST",
    body:   formData,
  });
  return res.json();
}

export async function resubmitDocument(formData: FormData) {
  const res = await fetch(`${API_BASE}/auth/resubmit.php`, {
    method: "POST",
    body:   formData,
  });
  return res.json();
}
