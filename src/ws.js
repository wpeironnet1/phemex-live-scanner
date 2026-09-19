import WebSocket from "ws";
import {WS_URL} from "./phemex.js";
import {ingestPack,ingestBook,ingestTrades,rows,sampleHistory} from "./state.js";
import {count} from "./monitor.js";

let ws,timer,retry=1000,focused=[];
const FOCUS_COUNT=Math.max(30,Math.min(150,Number(process.env.MICROSTRUCTURE_SYMBOLS||100)));
const ROTATE_COUNT=Math.max(5,Math.min(50,Number(process.env.MICROSTRUCTURE_ROTATE_SYMBOLS||20)));
const ROTATE_MS=Math.max(5000,Number(process.env.MICROSTRUCTURE_ROTATE_MS||15000));
let rotateOffset=0,lastRotate=0;
const send=(method,params=[])=>ws?.readyState===1&&ws.send(JSON.stringify({id:Date.now()+Math.random(),method,params}));

// Rank the whole ticker universe first. Microstructure is deliberately excluded
// from this discovery score so a symbol can be promoted even when its book/trades
// are not subscribed yet.
function discoveryScore(x){
  const p1=x?.p1??0,p5=x?.p5??0,va=x?.volumeAcceleration,oi=x?.oiDelta1m??0;
  const momentum=p5*4+p1*2;
  const volume=va==null?0:Math.log10(Math.max(1,va))*1.5;
  return momentum+volume+oi*1.2;
}
function focus(){
  const all=rows().filter(x=>x.turnover>0);
  const ranked=[...all].sort((a,b)=>discoveryScore(b)-discoveryScore(a));
  const liquid=[...all].sort((a,b)=>(b.turnover||0)-(a.turnover||0));

  // Most slots continuously follow the strongest ticker/momentum candidates.
  const candidateCount=Math.max(1,Math.floor(FOCUS_COUNT*.70));
  const liquidCount=Math.max(1,Math.floor(FOCUS_COUNT*.20));
  const base=[...new Set([
    ...ranked.slice(0,candidateCount).map(x=>x.symbol),
    ...liquid.slice(0,liquidCount).map(x=>x.symbol)
  ])];

  // Reserve rotating slots so the rest of the universe is periodically sampled.
  // This prevents a symbol from being permanently starved of book/trade data.
  const baseSet=new Set(base);
  const pool=ranked.map(x=>x.symbol).filter(s=>!baseSet.has(s));
  const rotateSlots=Math.min(ROTATE_COUNT,Math.max(0,FOCUS_COUNT-base.length),pool.length);
  const rotating=[];
  if(rotateSlots&&pool.length){
    const t=Date.now();
    if(t-lastRotate>=ROTATE_MS){rotateOffset=(rotateOffset+rotateSlots)%pool.length;lastRotate=t}
    for(let i=0;i<rotateSlots;i++)rotating.push(pool[(rotateOffset+i)%pool.length]);
  }
  const next=[...new Set([...base,...rotating])].slice(0,FOCUS_COUNT);
  if(next.join()==focused.join())return;

  for(const s of focused.filter(s=>!next.includes(s))){
    send("orderbook_p.unsubscribe",[s]);
    send("trade_p.unsubscribe",[s]);
  }
  for(const s of next.filter(s=>!focused.includes(s))){
    send("orderbook_p.subscribe",[s]);
    send("trade_p.subscribe",[s]);
  }
  focused=next;
}
function handle(m){
  if(m?.fields&&Array.isArray(m?.data))ingestPack(m);
  if(m?.type==="snapshot"&&m?.fields&&Array.isArray(m?.data))ingestPack(m);
  if(m?.orderbook_p)ingestBook(m);
  if(m?.trades_p)ingestTrades(m);
}
export function startFeed(){
  ws=new WebSocket(WS_URL);
  ws.on("open",()=>{
    retry=1000;
    focused=[];
    rotateOffset=0;
    lastRotate=0;
    send("perp_market24h_pack_p.subscribe");
    timer=setInterval(()=>{
      send("perp_market24h_pack_p.subscribe");
      sampleHistory();
      send("server.ping");
      focus();
    },5000);
  });
  ws.on("message",b=>{
    count("wsMessages");
    try{
      const m=JSON.parse(b.toString());
      if(Array.isArray(m)){for(const x of m)handle(x)}else handle(m);
    }catch(e){console.error("WS parse/ingest error",e?.message)}
  });
  const reconnect=()=>{
    count("reconnects");
    clearInterval(timer);
    setTimeout(startFeed,retry);
    retry=Math.min(30000,retry*2);
  };
  ws.on("close",reconnect);
  ws.on("error",()=>ws.close());
}
