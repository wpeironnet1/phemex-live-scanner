import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const cfg={mode:(process.env.TRADING_MODE||"paper").toLowerCase(),riskPct:Number(process.env.RISK_PER_TRADE_PCT||0.25),paperEquity:Number(process.env.PAPER_EQUITY_USD||1000),maxPositions:Number(process.env.MAX_OPEN_POSITIONS||2),dailyLossPct:Number(process.env.MAX_DAILY_LOSS_PCT||2),cooldownMs:Number(process.env.TRADE_COOLDOWN_MINUTES||15)*60000,maxAgeMs:Number(process.env.MAX_MARKET_AGE_MS||10000)};
const dataDir=process.env.DATA_DIR||"./data", journalPath=path.join(dataDir,"trades.jsonl");
const positions=new Map(), cooldown=new Map(), seen=new Set(), setups=new Map(); let realized=0, kill=false, riskDay=new Date().toISOString().slice(0,10),recovered=false;
try{fs.mkdirSync(dataDir,{recursive:true});}catch{}
const write=x=>{try{fs.appendFileSync(journalPath,JSON.stringify({...x,at:new Date().toISOString()})+"\n")}catch{}};
const dayOf=x=>String(x||"").slice(0,10);
function rollDay(){const d=new Date().toISOString().slice(0,10);if(d!==riskDay){riskDay=d;realized=0;write({type:"risk_day_reset",riskDay:d});}}
function recover(){if(recovered)return;recovered=true;if(!fs.existsSync(journalPath))return;try{const lines=fs.readFileSync(journalPath,"utf8").split(/\r?\n/).filter(Boolean);const open=new Map();let dayPnl=0,lastKill=false;for(const line of lines){let e;try{e=JSON.parse(line)}catch{continue}if(e.type==="paper_entry"&&e.id)open.set(e.id,e);if(e.type==="paper_exit"&&e.id){open.delete(e.id);if(dayOf(e.at)===riskDay)dayPnl+=Number(e.pnl)||0;}if(e.type==="kill_switch")lastKill=Boolean(e.enabled);}for(const [id,p] of open){positions.set(id,{id:p.id,symbol:p.symbol,side:p.side||"Buy",entry:Number(p.entry),stop:Number(p.stop),tp:Number(p.tp),qty:Number(p.qty),riskUsd:Number(p.riskUsd),openedAt:Number(p.openedAt)||Date.parse(p.at)||Date.now(),status:"OPEN"});cooldown.set(p.symbol,Math.max(Date.now(),(Number(p.openedAt)||0)+cfg.cooldownMs));}realized=dayPnl;kill=lastKill;write({type:"startup_recovery",positions:positions.size,realizedPnl:+realized.toFixed(4),killSwitch:kill,riskDay});}catch(e){write({type:"startup_recovery_error",message:String(e?.message||e)});}}
recover();

// Stricter long filter after repeated momentum stop-outs.  The scanner now
// favors sustained participation rather than buying the first late spike.
export function classify(x){
  const reasons=[], t=Date.now(), s=x?.symbol;
  if(!x?.ready1m||!x?.ready5m)reasons.push("history");
  if((x?.marketAgeMs??Infinity)>cfg.maxAgeMs)reasons.push("stale");
  if(x?.p1==null||x?.p5==null)reasons.push("momentum_data");
  if(x?.volumeAcceleration==null)reasons.push("volume_data");
  if(x?.orderBookImbalance==null)reasons.push("book_data");
  if(x?.tradeFlow1m==null)reasons.push("trade_data");
  if((x?.p1??0)>0.75||(x?.p5??0)>1.75)reasons.push("chase");
  if((x?.p1??0)<0.10||(x?.p5??0)<0.30)reasons.push("weak");
  if(x?.volumeAcceleration!=null&&x.volumeAcceleration<1.25)reasons.push("volume");
  if(x?.oiDelta1m==null)reasons.push("oi_data"); else if(x.oiDelta1m<0)reasons.push("oi");
  if(x?.orderBookImbalance!=null&&x.orderBookImbalance<0.15)reasons.push("book");
  if(x?.tradeFlow1m!=null&&x.tradeFlow1m<0.15)reasons.push("flow");
  if(reasons.length){if(s&&setups.has(s)&&t-setups.get(s).createdAt>5*60e3)setups.delete(s);return {class:"NO_TRADE",eligible:false,reasons};}

  // Stateful entry: first qualifying impulse only arms a setup. We then wait
  // for a controlled 0.20%-0.90% pullback from its post-arm high, followed by
  // a recovery with positive tape/book and sustained 5m momentum.
  let q=setups.get(s);
  if(!q){setups.set(s,{createdAt:t,armedPrice:x.last,high:x.last,pulledBack:false,pullbackLow:x.last});return {class:"ARMED_PULLBACK",eligible:false,reasons:["await_pullback"]};}
  if(t-q.createdAt>5*60e3){setups.set(s,{createdAt:t,armedPrice:x.last,high:x.last,pulledBack:false,pullbackLow:x.last});return {class:"ARMED_PULLBACK",eligible:false,reasons:["setup_expired_rearmed"]};}
  q.high=Math.max(q.high,x.last);
  const dd=(q.high-x.last)/q.high*100;
  if(!q.pulledBack){
    if(dd>=0.20&&dd<=0.90){q.pulledBack=true;q.pullbackLow=x.last;setups.set(s,q);return {class:"PULLBACK_SEEN",eligible:false,reasons:["await_reacceleration"]};}
    if(dd>0.90){setups.delete(s);return {class:"NO_TRADE",eligible:false,reasons:["pullback_too_deep"]};}
    setups.set(s,q);return {class:"ARMED_PULLBACK",eligible:false,reasons:["await_pullback"]};
  }
  q.pullbackLow=Math.min(q.pullbackLow,x.last);
  const rebound=(x.last/q.pullbackLow-1)*100;
  if(dd>0.90){setups.delete(s);return {class:"NO_TRADE",eligible:false,reasons:["pullback_failed"]};}
  if(rebound<0.12){setups.set(s,q);return {class:"PULLBACK_SEEN",eligible:false,reasons:["await_reacceleration"]};}
  if((x.orderBookImbalance??0)<0.20||(x.tradeFlow1m??0)<0.20||(x.volumeAcceleration??0)<1.35){setups.set(s,q);return {class:"PULLBACK_SEEN",eligible:false,reasons:["reacceleration_quality"]};}
  setups.delete(s);
  return {class:"CONFIRMED_LONG",eligible:true,reasons:[],setup:{armedPrice:q.armedPrice,high:q.high,pullbackLow:q.pullbackLow,reboundPct:+rebound.toFixed(4)}};
}
