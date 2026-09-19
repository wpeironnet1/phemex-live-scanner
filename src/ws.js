import WebSocket from "ws";import {WS_URL} from "./phemex.js";import {ingestPack,ingestBook,ingestTrades,rows,sampleHistory} from "./state.js";import {count} from "./monitor.js";
let ws,timer,retry=1000,focused=[];
const FOCUS_COUNT=Math.max(30,Math.min(150,Number(process.env.MICROSTRUCTURE_SYMBOLS||100)));
const send=(method,params=[])=>ws?.readyState===1&&ws.send(JSON.stringify({id:Date.now()+Math.random(),method,params}));
function focus(){
  const ranked=rows().filter(x=>x.turnover>0).sort((a,b)=>(b.score||0)-(a.score||0));
  const liquid=rows().filter(x=>x.turnover>0).sort((a,b)=>(b.turnover||0)-(a.turnover||0));
  const next=[...new Set([...ranked.slice(0,Math.ceil(FOCUS_COUNT*.7)),...liquid.slice(0,Math.floor(FOCUS_COUNT*.3))].map(x=>x.symbol))].slice(0,FOCUS_COUNT);
  if(next.join()==focused.join())return;
  for(const s of focused.filter(s=>!next.includes(s))){send("orderbook_p.unsubscribe",[s]);send("trade_p.unsubscribe",[s])}
  for(const s of next.filter(s=>!focused.includes(s))){send("orderbook_p.subscribe",[s]);send("trade_p.subscribe",[s])}
  focused=next;
}
function handle(m){if(m?.fields&&Array.isArray(m?.data))ingestPack(m);if(m?.type==="snapshot"&&m?.fields&&Array.isArray(m?.data))ingestPack(m);if(m?.orderbook_p)ingestBook(m);if(m?.trades_p)ingestTrades(m)}
export function startFeed(){ws=new WebSocket(WS_URL);ws.on("open",()=>{retry=1000;send("perp_market24h_pack_p.subscribe");timer=setInterval(()=>{send("perp_market24h_pack_p.subscribe");sampleHistory();send("server.ping");focus()},5000)});ws.on("message",b=>{count("wsMessages");try{const m=JSON.parse(b.toString());if(Array.isArray(m)){for(const x of m)handle(x)}else handle(m)}catch(e){console.error("WS parse/ingest error",e?.message)}});const reconnect=()=>{count("reconnects");clearInterval(timer);setTimeout(startFeed,retry);retry=Math.min(30000,retry*2)};ws.on("close",reconnect);ws.on("error",()=>ws.close())}
