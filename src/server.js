import express from "express";
import { BASE_URL, fetchProducts, fetchTicker24h } from "./phemex.js";
import { rankTickers, unwrapTicker } from "./scanner.js";

const app = express();
app.use(express.json());

function extractPerpSymbols(payload) {
  const root = payload?.data ?? payload?.result ?? payload ?? {};
  const candidates = [
    ...(root.perpProductsV2 ?? []),
    ...(root.products ?? []),
  ];
  return [...new Set(candidates
    .filter(p => {
      const type = String(p.type ?? p.productType ?? "").toLowerCase();
      const status = String(p.status ?? "listed").toLowerCase();
      return status === "listed" && (type.includes("perpetual") || type.includes("perp") || p.settleCurrency === "USDT");
    })
    .map(p => p.symbol)
    .filter(Boolean))];
}

async function mapLimit(items, concurrency, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try { out[i] = await fn(items[i]); }
      catch (e) { out[i] = { symbol: items[i], error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

app.get("/", (_req, res) => res.json({
  service: "phemex-live-scanner",
  mode: "public-read-only",
  upstream: BASE_URL,
  endpoints: ["/health", "/products", "/ticker/:symbol", "/scan?limit=20&maxSymbols=120"]
}));

app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.get("/products", async (_req, res) => {
  try { res.json(await fetchProducts()); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get("/ticker/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const raw = await fetchTicker24h(symbol);
    res.json({ ts: new Date().toISOString(), ticker: unwrapTicker(raw, symbol), raw });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get("/scan", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
    const maxSymbols = Math.max(1, Math.min(300, Number(req.query.maxSymbols) || 120));
    const products = await fetchProducts();
    const symbols = extractPerpSymbols(products).slice(0, maxSymbols);
    const rows = await mapLimit(symbols, 8, async symbol => {
      const raw = await fetchTicker24h(symbol);
      return unwrapTicker(raw, symbol);
    });
    const valid = rows.filter(Boolean).filter(r => !r.error);
    res.json({
      ts: new Date().toISOString(),
      source: "Phemex public API",
      scanned: symbols.length,
      succeeded: valid.length,
      ranked: rankTickers(valid, limit),
      errors: rows.filter(r => r?.error).slice(0, 20)
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Phemex scanner listening on :${port}`));
