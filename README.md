# Phemex Live Scanner

A read-only bridge for scanning Phemex perpetual markets from Phemex public market data.

## Goals
- live perpetual ticker snapshots
- short-term momentum and volume acceleration
- order-book imbalance
- funding and open-interest fields when exposed by Phemex
- ranked candidates through a simple HTTP API

## Security
This project is intentionally public-data-only. Do **not** add Phemex API keys or account secrets.

## Status
Initial scaffold. The Phemex adapter is isolated so endpoint/schema changes can be updated without changing the scanner.
