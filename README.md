# Phemex Live Scanner
Production-ready, public-data-only Phemex perpetual scanner. No Phemex API key is required.

## Live engine
The service connects to Phemex's public WebSocket, subscribes to the packed perpetual 24h stream, retains rolling snapshots, and dynamically focuses order-book/trade subscriptions on the strongest six symbols (kept below Phemex's documented per-connection subscription limit). It reconnects automatically and sends heartbeats.

## Signals
`/scan` ranks current perpetuals using 1m/5m price momentum, rolling volume acceleration, 1m open-interest change, top-10 order-book imbalance, 1m aggressive trade flow, funding and turnover context. `/market/:symbol` returns ticker, book, recent trades, 1m klines and 5m klines directly from Phemex REST for drill-down.

## Endpoints
- `GET /health`
- `GET /scan?limit=20&minTurnover=0`
- `GET /market/ENAUSDT`
- `GET /products`

## Deploy
A Dockerfile and `render.yaml` are included for an always-on Render web service. Any Docker host works. Set no secrets; optional variables are `PORT`, `PHEMEX_BASE_URL`, and `PHEMEX_WS_URL`.

## Security
Never add exchange keys or account credentials. This service reads public market data only.
