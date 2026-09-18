const BASE_URL = process.env.PHEMEX_BASE_URL || "https://api.phemex.com";

async function getJson(path) {
  const res = await fetch(BASE_URL + path, {
    headers: { "accept": "application/json", "user-agent": "phemex-live-scanner/0.1" }
  });
  if (!res.ok) throw new Error(`Phemex HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// Public endpoint: no API credentials. Kept behind an adapter because Phemex
// has multiple contract generations/schemas.
export async function fetchProducts() {
  return getJson("/public/products");
}

export async function fetchTicker24h(symbol) {
  const q = new URLSearchParams({ symbol });
  return getJson(`/md/v2/ticker/24hr?${q}`);
}

export { BASE_URL };
