import express from "express";
import { BASE_URL, fetchProducts, fetchTicker24h } from "./phemex.js";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => res.json({
  service: "phemex-live-scanner",
  mode: "public-read-only",
  upstream: BASE_URL,
  endpoints: ["/health", "/products", "/ticker/:symbol"]
}));

app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.get("/products", async (_req, res) => {
  try { res.json(await fetchProducts()); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get("/ticker/:symbol", async (req, res) => {
  try { res.json(await fetchTicker24h(req.params.symbol.toUpperCase())); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Phemex scanner listening on :${port}`));
