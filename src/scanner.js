const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function unwrapTicker(payload, symbol) {
  const root = payload?.result ?? payload?.data ?? payload;
  const t = Array.isArray(root) ? root[0] : root;
  if (!t || typeof t !== "object") return null;

  const last = num(t.lastEp ?? t.lastRp ?? t.last ?? t.closeRp ?? t.close);
  const open = num(t.openEp ?? t.openRp ?? t.open);
  const high = num(t.highEp ?? t.highRp ?? t.high);
  const low = num(t.lowEp ?? t.lowRp ?? t.low);
  const volume = num(t.volumeEv ?? t.volumeRq ?? t.volume ?? t.turnoverEv ?? t.turnoverRv);
  const funding = num(t.fundingRateEr ?? t.fundingRateRr ?? t.fundingRate);
  const openInterest = num(t.openInterest ?? t.openInterestRv ?? t.openInterestEv);

  const changePct = last != null && open ? ((last / open) - 1) * 100 : null;
  const rangePct = high != null && low != null && low !== 0 ? ((high / low) - 1) * 100 : null;

  return { symbol, last, open, high, low, volume, funding, openInterest, changePct, rangePct, raw: t };
}

export function scoreTicker(t) {
  if (!t?.last) return -Infinity;
  // Discovery score only: favors active positive momentum and wide enough range.
  // It is not a trade recommendation and intentionally avoids leverage assumptions.
  const momentum = Math.max(-25, Math.min(25, t.changePct ?? 0));
  const range = Math.max(0, Math.min(25, t.rangePct ?? 0));
  const activity = t.volume && t.volume > 0 ? Math.log10(t.volume + 1) : 0;
  return +(momentum * 2 + range * 0.35 + activity * 0.5).toFixed(4);
}

export function rankTickers(tickers, limit = 20) {
  return tickers
    .map(t => ({ ...t, score: scoreTicker(t) }))
    .filter(t => Number.isFinite(t.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
