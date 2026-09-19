import fs from "node:fs";
import path from "node:path";

const history=new Map(), latest=new Map(), books=new Map(), trades=new Map(); let updatedAt=null;
const SAMPLE_MS=5000, RETAIN_MS=15*60e3;
const STATE_DIR=process.env.SCANNER_STATE_DIR||"/data";
const STATE_FILE=process.env.SCANNER_STATE_FILE||path.join(STATE_DIR,"scanner-state.json");
const SAVE_MS=15000, MAX_RESTORE_AGE_MS=RETAIN_MS;
const n=x=>{const v=Number(x);return Number.isFinite(v)?v:null};
const now=()=>Date.now();

function restore(){
  try{
    if(!fs.existsSync(STATE_FILE))return;
    const raw=JSON.parse(fs.readFileSync(STATE_FILE,"utf8")),t=now(),cut=t-RETAIN_MS;
    if(!raw?.savedAt||t-raw.savedAt>MAX_RESTORE_AGE_MS)return;
    for(const [s,h] of raw.history||[]){const clean=(h||[]).filter(x=>x?.ts>=cut);if(clean.length)history.set(s,clean)}
    for(const [s,x] of raw.latest||[])if(x?.ts>=cut)latest.set(s,x);
    for(const [s,b] of raw.books||[])if(b?.ts>=t-15000)books.set(s,b);
    for(const [s,a] of raw.trades||[]){const clean=(a||[]).filter(x=>x?.ts>=t-5*60e3);if(clean.length)trades.set(s,clean)}
    // Do not restore feed freshness. A restarted process must receive a new live
    // market packet before /ready can become healthy.
    updatedAt=null;
    console.log(`Restored scanner state: ${history.size} symbols from ${STATE_FILE}`);
  }catch(e){console.warn("Scanner state restore skipped:",e.message)}
}
function persist(){
  try{
    fs.mkdirSync(path.dirname(STATE_FILE),{recursive:true});const tmp=STATE_FILE+".tmp";
    fs.writeFileSync(tmp,JSON.stringify({savedAt:now(),updatedAt,history:[...history],latest:[...latest],books:[...books],trades:[...trades]}));
    fs.renameSync(tmp,STATE_FILE);
  }catch(e){console.warn("Scanner state persist failed:",e.message)}
}
restore();const timer=setInterval(persist,SAVE_MS);timer.unref?.();
for(const sig of ["SIGTERM","SIGINT"])process.once(sig,()=>{persist();process.exit(0)});

export function ingestPack(msg){
  if(!Array.isArray(msg?.data)||!Array.isArray(msg?.fields))return;
  const f=msg.fields,t=now();
  for(const row of msg.data){
    const o=Object.fromEntries(f.map((k,i)=>[k,row[i]])),s=o.symbol;if(!s)continue;
    const prev=latest.get(s)||{};
    // Pack updates may be partial. Preserve prior values instead of converting
    // absent fields to null.
    const val=(key,old)=>Object.prototype.hasOwnProperty.call(o,key)?n(o[key]):old??null;
    const snap={symbol:s,open:val("openRp",prev.open),high:val("highRp",prev.high),low:val("lowRp",prev.low),last:val("lastRp",prev.last),volume:val("volumeRq",prev.volume),turnover:val("turnoverRv",prev.turnover),openInterest:val("openInterestRv",prev.openInterest),index:val("indexRp",prev.index),mark:val("markRp",prev.mark),funding:val("fundingRateRr",prev.funding),predFunding:val("predFundingRateRr",prev.predFunding),ts:t};
    latest.set(s,snap);if(!history.has(s))history.set(s,[]);
  }
  updatedAt=t;
}
export function sampleHistory(){
  const t=now(),cut=t-RETAIN_MS;
  for(const [sym,x] of latest){
    const h=history.get(sym)||[];
    // Record only a new market observation. Never stamp an unchanged quote with
    // the sampling clock; that previously made 1m/5m momentum identical.
    const last=h.at(-1);
    if(!last||last.marketTs!==x.ts)h.push({...x,ts:x.ts,marketTs:x.ts});
    while(h.length>1&&h[0].ts<cut)h.shift();history.set(sym,h);
  }
}
export function ingestBook(msg){const s=msg?.symbol;if(!s||!msg.orderbook_p)return;books.set(s,{...msg.orderbook_p,ts:now()})}
function tradeMs(v){const x=Number(v);if(!Number.isFinite(x))return now();if(x>1e17)return x/1e6;if(x>1e14)return x/1e3;if(x>1e11)return x;return x*1000}
export function ingestTrades(msg){const s=msg?.symbol;if(!s||!Array.isArray(msg.trades_p))return;const old=trades.get(s)||[];old.push(...msg.trades_p.map(x=>({ts:tradeMs(x[0]),side:x[1],price:n(x[2]),size:n(x[3])})));const cutoff=now()-5*60e3;while(old.length&&old[0].ts<cutoff)old.shift();while(old.length>2000)old.shift();trades.set(s,old)}
function pct(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?((a/b)-1)*100:null}
function atOrBefore(h,target,key){let best=null;for(const x of h){if(x.ts<=target)best=x;else break}return best?.[key]??null}
function delta(h,endTs,startTs,key){
  const end=atOrBefore(h,endTs,key),start=atOrBefore(h,startTs,key);
  return end!=null&&start!=null?Math.max(0,end-start):null;
}
function imbalance(b){if(!b||now()-b.ts>15000)return null;const sum=a=>(a||[]).slice(0,10).reduce((z,x)=>z+(Number(x[1])||0),0),bid=sum(b?.bids),ask=sum(b?.asks);return bid+ask?(bid-ask)/(bid+ask):null}
function flow(t){const cutoff=now()-60000;let buy=0,sell=0;for(const x of t)if(x.ts>=cutoff)(x.side==="Buy"?buy+=x.size||0:sell+=x.size||0);return buy+sell?(buy-sell)/(buy+sell):null}
export function rows(){
  const out=[],t=now();
  for(const [symbol,h] of history){
    const x=latest.get(symbol),sampled=h.at(-1);if(!x?.last||!sampled)continue;
    const l1=atOrBefore(h,x.ts-60000,"last"),l5=atOrBefore(h,x.ts-300000,"last");
    const p1=pct(x.last,l1),p5=pct(x.last,l5);
    // Better burst detector for short-term entries: compare the most recent
    // 30-second volume rate with the preceding 2-minute baseline. This reacts
    // faster than a 1m-vs-4m ratio while still smoothing single-tick noise.
    const recent30=delta(h,x.ts,x.ts-30000,"volume");
    const base120=delta(h,x.ts-30000,x.ts-150000,"volume");
    const recentRate=recent30==null?null:recent30/30;
    const baseRate=base120==null?null:base120/120;
    const va=recentRate!=null&&baseRate>0?recentRate/baseRate:null;
    const oi1=atOrBefore(h,x.ts-60000,"openInterest"),oiDelta=pct(x.openInterest,oi1),obi=imbalance(books.get(symbol)),tf=flow(trades.get(symbol)||[]);
    const ready1=l1!=null,ready5=l5!=null;
    const score=(p5??0)*4+(p1??0)*2+(va?Math.log10(Math.max(1,va))*1.5:0)+(oiDelta??0)*1.2+(obi??0)*2+(tf??0)*1.5;
    out.push({...x,p1:p1==null?null:+p1.toFixed(4),p5:p5==null?null:+p5.toFixed(4),volumeAcceleration:va==null?null:+va.toFixed(4),volumeWindow:"30s_vs_prior120s_rate",oiDelta1m:oiDelta==null?null:+oiDelta.toFixed(4),orderBookImbalance:obi==null?null:+obi.toFixed(4),tradeFlow1m:tf==null?null:+tf.toFixed(4),historySeconds:+((sampled.ts-h[0].ts)/1000).toFixed(1),marketAgeMs:Math.max(0,t-x.ts),samples:h.length,ready1m:ready1,ready5m:ready5,score:+score.toFixed(4)})
  }
  return out.sort((a,b)=>b.score-a.score);
}
export const status=()=>({updatedAt,symbols:history.size,books:books.size,tradeStreams:trades.size,oldestHistorySeconds:Math.max(0,...[...history.values()].map(h=>h.length?(now()-h[0].ts)/1000:0)),statePersistence:{file:STATE_FILE,saveEveryMs:SAVE_MS},sampling:{marketObservationsOnly:true,volumeWindow:"30s_vs_prior120s_rate"}});
