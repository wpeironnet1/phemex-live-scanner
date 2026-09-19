import WebSocket from "ws";
import {WS_URL} from "./phemex.js";
import {ingestPack,ingestBook,ingestTrades,rows,sampleHistory} from "./state.js";
import {count} from "./monitor.js";

let marketWs,microWs,timer,retry=1000,focused=[];
let marketGeneration=0,microGeneration=0,marketReconnectTimer=null,microReconnectTimer=null;
const FOCUS_COUNT=Math.max(30,Math.min(150,Number(process.env.MICROSTRUCTURE_SYMBOLS||100)));
const ROTATE_COUNT=Math.max(5,Math.min(50,Number(process.env.MICROSTRUCTURE_ROTATE_SYMBOLS||20)));
const ROTATE_MS=Math.max(5000,Number(process.env.MICROSTRUCTURE_ROTATE_MS||15000));
const STALE_MS=Math.max(10000,Number(process.env.FEED_STALE_RECONNECT_MS||12000));
const CONNECT_TIMEOUT_MS=Math.max(5000,Number(process.env.FEED_CONNECT_TIMEOUT_MS||10000));
let rotateOffset=0,lastRotate=0,lastTickerAt=0;

const send=(socket,method,params=[])=>socket?.readyState===WebSocket.OPEN&&socket.send(JSON.stringify({id:Date.now()+Math.random(),method,params}));

function discoveryScore(x){
  const p1=x?.p1??0,p5=x?.p5??0,va=x?.volumeAcceleration,oi=x?.oiDelta1m??0;
  return p5*4+p1*2+(va==null?0:Math.log10(Math.max(1,va))*1.5)+oi*1.2;
}
function focus(){
  if(microWs?.readyState!==WebSocket.OPEN)return;
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
  for(const s of focused.filter(s=>!next.includes(s))){send(microWs,"orderbook_p.unsubscribe",[s]);send(microWs,"trade_p.unsubscribe",[s])}
  for(const s of next.filter(s=>!focused.includes(s))){send(microWs,"orderbook_p.subscribe",[s]);send(microWs,"trade_p.subscribe",[s])}
  focused=next;
}
function handleMarket(m){
  if(m?.fields&&Array.isArray(m?.data)){ingestPack(m);lastTickerAt=Date.now()}
}
function handleMicro(m){
  if(m?.orderbook_p)ingestBook(m);
  if(m?.trades_p)ingestTrades(m);
}
function scheduleMarketReconnect(reason,gen){
  if(gen!==marketGeneration||marketReconnectTimer)return;
  count("reconnects");
  console.warn("Phemex market WS reconnect:",reason);
  const old=marketWs; marketWs=null;
  try{old?.terminate()}catch{}
  const delay=retry;retry=Math.min(10000,retry*2);
  marketReconnectTimer=setTimeout(()=>{
    marketReconnectTimer=null;
    if(gen===marketGeneration)connectMarket();
  },delay);
}
function connectMarket(){
  const gen=++marketGeneration;
  lastTickerAt=0;
  const socket=new WebSocket(WS_URL); marketWs=socket;
  const connectTimeout=setTimeout(()=>scheduleMarketReconnect("market connect/first-packet timeout",gen),CONNECT_TIMEOUT_MS);
  socket.on("open",()=>{
    retry=1000;
    send(socket,"perp_market24h_pack_p.subscribe");
  });
  socket.on("message",b=>{
    if(gen!==marketGeneration)return;
    count("wsMessages");
    try{
      const m=JSON.parse(b.toString());
      if(Array.isArray(m))for(const x of m)handleMarket(x);else handleMarket(m);
      if(lastTickerAt)clearTimeout(connectTimeout);
    }catch(e){console.error("Market WS parse/ingest error",e?.message)}
  });
  socket.on("close",()=>{clearTimeout(connectTimeout);scheduleMarketReconnect("market socket closed",gen)});
  socket.on("error",e=>{clearTimeout(connectTimeout);scheduleMarketReconnect(e?.message||"market socket error",gen)});
}
function scheduleMicroReconnect(reason,gen){
  if(gen!==microGeneration||microReconnectTimer)return;
  console.warn("Phemex microstructure WS reconnect:",reason);
  const old=microWs; microWs=null; focused=[];
  try{old?.terminate()}catch{}
  microReconnectTimer=setTimeout(()=>{
    microReconnectTimer=null;
    if(gen===microGeneration)connectMicro();
  },1000);
}
function connectMicro(){
  const gen=++microGeneration;
  const socket=new WebSocket(WS_URL); microWs=socket;
  const connectTimeout=setTimeout(()=>scheduleMicroReconnect("microstructure connect timeout",gen),CONNECT_TIMEOUT_MS);
  socket.on("open",()=>{
    clearTimeout(connectTimeout);
    focused=[];rotateOffset=0;lastRotate=0;
    focus();
  });
  socket.on("message",b=>{
    if(gen!==microGeneration)return;
    count("wsMessages");
    try{const m=JSON.parse(b.toString());if(Array.isArray(m))for(const x of m)handleMicro(x);else handleMicro(m)}
    catch(e){console.error("Microstructure WS parse/ingest error",e?.message)}
  });
  socket.on("close",()=>{clearTimeout(connectTimeout);scheduleMicroReconnect("microstructure socket closed",gen)});
  socket.on("error",e=>{clearTimeout(connectTimeout);scheduleMicroReconnect(e?.message||"microstructure socket error",gen)});
}
export function startFeed(){
  clearInterval(timer);
  if(marketReconnectTimer){clearTimeout(marketReconnectTimer);marketReconnectTimer=null}
  if(microReconnectTimer){clearTimeout(microReconnectTimer);microReconnectTimer=null}
  try{marketWs?.terminate()}catch{}
  try{microWs?.terminate()}catch{}
  marketWs=null;microWs=null;focused=[];lastTickerAt=0;
  connectMarket();
  connectMicro();
  timer=setInterval(()=>{
    sampleHistory();
    send(marketWs,"server.ping");
    send(microWs,"server.ping");
    focus();
    if(lastTickerAt&&Date.now()-lastTickerAt>STALE_MS){
      scheduleMarketReconnect(`ticker packet stream stale for ${Date.now()-lastTickerAt}ms`,marketGeneration);
    }
  },1000);
}
