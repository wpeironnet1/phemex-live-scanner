# Phemex Live Scanner

Read-only Phemex perpetual-market scanner using Phemex public market data. **No private API key is required.**

## Current API
- `GET /health` — service status and timestamp
- `GET /products` — raw Phemex product catalogue
- `GET /ticker/:symbol` — normalized ticker plus raw upstream payload
- `GET /scan?limit=20&maxSymbols=120` — discovers listed perpetuals, fetches fresh 24h ticker data, normalizes fields and ranks candidates

The first ranking model is deliberately simple. It combines positive 24h momentum, trading range and activity. The next layer will add rolling 1m/5m observations, volume acceleration, order-book imbalance, funding/open-interest normalization and WebSocket collection.

## Run
```bash
npm install
npm start
```

Default port is `3000`.

## Security
Public-data-only. Never commit Phemex API keys, secrets, account credentials, or withdrawal/trading credentials.

## Architecture
`src/phemex.js` isolates Phemex HTTP access. `src/scanner.js` owns normalization/ranking. `src/server.js` exposes the HTTP interface. This separation lets us adapt if Phemex changes a response schema without rewriting the scoring layer.
