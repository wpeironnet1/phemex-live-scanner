import WebSocket from "ws";import {WS_URL} from "./phemex.js";import {ingestPack,ingestBook,ingestTrades,rows,sampleHistory} from "./state.js";import {count} from "./monitor.js";
let ws,timer,retry=1000,focused=[];
const FOCUS_COUNT=Math.max(6,Math.min(60,Number(process.env.MICROSTRUCTURE_SYMBOLS||30)));
const send=(method,params=[])=>ws?.readyState===1&&ws.send(JSON.stringify({id:Date.now()+Math.random(),method,params}));
function focus(){
  const next=rows().filter(x=>x.turnover>0).sort((a,b)=>(b.turnover||0)-(a.turnover||0)).slice(0,FOCUS_COUNT).map(x=>x.symbol);
  if(next.join()==focused.join())return;
  for(const s of focused.filter(s=>!next.includes(s))){send("orderbook_p.unsubscribe",[s]);send("trade_p.unsubscribe",[s])}
  for(const s of next.filter(s=>!focused.includes(s))){send("orderbook_p.subscribe",[s]);send("trade_p.subscribe",[s])}
  focused=next;
}
function handle(m){if(m?.fields&&Array.isArray(m?.data))ingestPack(m);if(m?.type==="snapshot"&&m?.fields&&Array.isArray(m?.data))ingestPack(m);if(m?.orderbook_p)ingestBook(m);if(m?.trades_p)ingestTrades(m)}
export function startFeed(){ws=new WebSocket(WS_URL);ws.on("open",()=>{retry=1000;send("perp_market24h_pack_p.subscribe");timer=setInterval(()=>{send("perp_market24h_pack_p.subscribe");sampleHistory();send("server.ping");focus()},5000)});ws.on("message",b=>{count("wsMessages");try{const m=JSON.parse(b.toString());if(Array.isArray(m)){for(const x of m)handle(x)}else handle(m)}catch(e){console.error("WS parse/ingest error",e?.message)}});const reconnect=()=>{count("reconnects");clearInterval(timer);setTimeout(startFeed,retry);retry=Math.min(30000,retry*2)};ws.on("close",reconnect);ws.on("error",()=>ws.close())}
