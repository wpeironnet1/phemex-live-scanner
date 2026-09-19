import WebSocket from "ws";
import {WS_URL} from "./phemex.js";
import {ingestPack,ingestBook,ingestTrades,rows,sampleHistory,status} from "./state.js";
import {count} from "./monitor.js";

let ws,timer,retry=1000,focused=[];
const FOCUS_COUNT=Math.max(30,Math.min(150,Number(process.env.MICROSTRUCTURE_SYMBOLS||100)));
const ROTATE_COUNT=Math.max(5,Math.min(50,Number(process.env.MICROSTRUCTURE_ROTATE_SYMBOLS||20)));
const ROTATE_MS=Math.max(5000,Number(process.env.MICROSTRUCTURE_ROTATE_MS||15000));
const STALE_MS=Math.max(15000,Number(process.env.FEED_STALE_RECONNECT_MS||20000));
let rotateOffset=0,lastRotate=0,reconnecting=false;
const send=(method,params=[])=>ws?.readyState===WebSocket.OPEN&&ws.send(JSON.stringify({id:Date.now()+Math.random(),method,params}));

function discoveryScore(x){
  const p1=x?.p1??0,p5=x?.p5??0,va=x?.volumeAcceleration,oi=x?.oiDelta1m??0;
  return p5*4+p1*2+(va==null?0:Math.log10(Math.max(1,va))*1.5)+oi*1.2;
}
function focus(){
  const all=rows().filter(x=>x.turnover>0);
  const ranked=[...all].sort((a,b)=>discoveryScore(b)-discoveryScore(a));
  const liquid=[...all].sort((a,b)=>(b.turnover||0)-(a.turnover||0));
  const candidateCount=Math.max(1,Math.floor(FOCUS_COUNT*.70));
  const liquidCount=Math.max(1,Math.floor(FOCUS_COUNT*.20));
  const base=[...new Set([...ranked.slice(0,candidateCount).map(x=>x.symbol),...liquid.slice(0,liquidCount).map(x=>x.symbol)])];
  const baseSet=new Set(base),pool=ranked.map(x=>x.symbol).filter(s=>!baseSet.has(s));
  const rotateSlots=Math.min(ROTATE_COUNT,Math.max(0,FOCUS_COUNT-base.length),pool.length),rotating=[];
  if(rotateSlots&&pool.length){
    const t=Date.now();
    if(t-lastRotate>=ROTATE_MS){rotateOffset=(rotateOffset+rotateSlots)%pool.length;lastRotate=t}
    for(let i=0;i<rotateSlots;i++)rotating.push(pool[(rotateOffset+i)%pool.length]);
  }
  const next=[...new Set([...base,...rotating])].slice(0,FOCUS_COUNT);
  if(next.join()==focused.join())return;
  for(const s of focused.filter(s=>!next.includes(s))){send("orderbook_p.unsubscribe",[s]);send("trade_p.unsubscribe",[s])}
  for(const s of next.filter(s=>!focused.includes(s))){send("orderbook_p.subscribe",[s]);send("trade_p.subscribe",[s])}
  focused=next;
}
function handle(m){
  // Market24h pack messages are incremental updates; ingest every fields/data payload.
  if(m?.fields&&Array.isArray(m?.data))ingestPack(m);
  if(m?.orderbook_p)ingestBook(m);
  if(m?.trades_p)ingestTrades(m);
}
function reconnect(reason){
  if(reconnecting)return;
  reconnecting=true;count("reconnects");clearInterval(timer);
  console.warn("Phemex WS reconnect:",reason);
  try{ws?.terminate()}catch{}
  const delay=retry;retry=Math.min(30000,retry*2);
  setTimeout(()=>{reconnecting=false;startFeed()},delay);
}
export function startFeed(){
  if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))try{ws.terminate()}catch{}
  ws=new WebSocket(WS_URL);
  ws.on("open",()=>{
    retry=1000;focused=[];rotateOffset=0;lastRotate=0;
    // Subscribe once. Re-sending subscribe every five seconds can cause the server
    // to stop delivering incremental pack updates on long-lived connections.
    send("perp_market24h_pack_p.subscribe");
    timer=setInterval(()=>{
      sampleHistory();send("server.ping");focus();
      const updatedAt=status().updatedAt;
      if(updatedAt&&Date.now()-updatedAt>STALE_MS)reconnect(`ticker feed stale for ${Date.now()-updatedAt}ms`);
    },5000);
  });
  ws.on("message",b=>{
    count("wsMessages");
    try{const m=JSON.parse(b.toString());if(Array.isArray(m)){for(const x of m)handle(x)}else handle(m)}
    catch(e){console.error("WS parse/ingest error",e?.message)}
  });
  ws.on("close",()=>reconnect("socket closed"));
  ws.on("error",e=>reconnect(e?.message||"socket error"));
}
