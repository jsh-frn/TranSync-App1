import API_BASE from "../config/api";

export async function getWallet(commuterId: number) {
  const res = await fetch(`${API_BASE}/wallet/wallet.php?commuter_id=${commuterId}`);
  return res.json();
}
