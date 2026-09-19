const BASE_URL=process.env.PHEMEX_BASE_URL||"https://api.phemex.com";
export const WS_URL=process.env.PHEMEX_WS_URL||"wss://ws.phemex.com";
async function getJson(path){const r=await fetch(BASE_URL+path,{headers:{accept:"application/json","user-agent":"phemex-live-scanner/1.0"}});if(!r.ok)throw new Error(`Phemex HTTP ${r.status}: ${await r.text()}`);return r.json()}
export const fetchProducts=()=>getJson("/public/products");
export const fetchTicker24h=s=>getJson("/md/v3/ticker/24hr?"+new URLSearchParams({symbol:s}));
export const fetchAllTickers24h=()=>getJson("/md/v3/ticker/24hr/all");
export const fetchOrderBook=s=>getJson("/md/v2/orderbook?"+new URLSearchParams({symbol:s}));
export const fetchTrades=s=>getJson("/md/v2/trade?"+new URLSearchParams({symbol:s}));
export const fetchKlines=(s,resolution=60,limit=10)=>getJson("/exchange/public/md/v2/kline?"+new URLSearchParams({symbol:s,resolution:String(resolution),limit:String(limit)}));
export {BASE_URL};