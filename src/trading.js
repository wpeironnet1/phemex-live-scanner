import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const cfg={mode:(process.env.TRADING_MODE||"paper").toLowerCase(),riskPct:Number(process.env.RISK_PER_TRADE_PCT||0.25),paperEquity:Number(process.env.PAPER_EQUITY_USD||1000),maxPositions:Number(process.env.MAX_OPEN_POSITIONS||2),dailyLossPct:Number(process.env.MAX_DAILY_LOSS_PCT||2),cooldownMs:Number(process.env.TRADE_COOLDOWN_MINUTES||15)*60000,maxAgeMs:Number(process.env.MAX_MARKET_AGE_MS||10000)};
const dataDir=process.env.DATA_DIR||"./data", journalPath=path.join(dataDir,"trades.jsonl");
const positions=new Map(), cooldown=new Map(), seen=new Set(); let realized=0, kill=false, riskDay=new Date().toISOString().slice(0,10),recovered=false;
try{fs.mkdirSync(dataDir,{recursive:true});}catch{}
const write=x=>{try{fs.appendFileSync(journalPath,JSON.stringify({...x,at:new Date().toISOString()})+"\n")}catch{}};
const dayOf=x=>String(x||"").slice(0,10);
function rollDay(){const d=new Date().toISOString().slice(0,10);if(d!==riskDay){riskDay=d;realized=0;write({type:"risk_day_reset",riskDay:d});}}
function recover(){if(recovered)return;recovered=true;if(!fs.existsSync(journalPath))return;try{const lines=fs.readFileSync(journalPath,"utf8").split(/\r?\n/).filter(Boolean);const open=new Map();let dayPnl=0,lastKill=false;for(const line of lines){let e;try{e=JSON.parse(line)}catch{continue}if(e.type==="paper_entry"&&e.id)open.set(e.id,e);if(e.type==="paper_exit"&&e.id){open.delete(e.id);if(dayOf(e.at)===riskDay)dayPnl+=Number(e.pnl)||0;}if(e.type==="kill_switch")lastKill=Boolean(e.enabled);}for(const [id,p] of open){positions.set(id,{id:p.id,symbol:p.symbol,side:p.side||"Buy",entry:Number(p.entry),stop:Number(p.stop),tp:Number(p.tp),qty:Number(p.qty),riskUsd:Number(p.riskUsd),openedAt:Number(p.openedAt)||Date.parse(p.at)||Date.now(),status:"OPEN"});cooldown.set(p.symbol,Math.max(Date.now(),(Number(p.openedAt)||0)+cfg.cooldownMs));}realized=dayPnl;kill=lastKill;write({type:"startup_recovery",positions:positions.size,realizedPnl:+realized.toFixed(4),killSwitch:kill,riskDay});}catch(e){write({type:"startup_recovery_error",message:String(e?.message||e)});}}
recover();

export function classify(x){
  const reasons=[];
  if(!x?.ready1m||!x?.ready5m)reasons.push("history");
  if((x?.marketAgeMs??Infinity)>cfg.maxAgeMs)reasons.push("stale");
  if(x?.p1==null||x?.p5==null)reasons.push("momentum_data");
  if(x?.volumeAcceleration==null)reasons.push("volume_data");
  if(x?.orderBookImbalance==null)reasons.push("book_data");
  if(x?.tradeFlow1m==null)reasons.push("trade_data");
  if((x?.p5??0)>3.5||(x?.p1??0)>1.5)reasons.push("chase");
  if((x?.p1??0)<0.08||(x?.p5??0)<0.18)reasons.push("weak");
  if(x?.volumeAcceleration!=null&&x.volumeAcceleration<0.8)reasons.push("volume");
  if((x?.oiDelta1m??0)<-0.2)reasons.push("oi");
  if(x?.orderBookImbalance!=null&&x.orderBookImbalance<=-0.65)reasons.push("book");
  if(x?.tradeFlow1m!=null&&x.tradeFlow1m<=-0.65)reasons.push("flow");
  return {class:reasons.length?"NO_TRADE":"EARLY_MOMENTUM",eligible:!reasons.length,reasons};
}
export function riskState(){rollDay();return {mode:cfg.mode,killSwitch:kill,openPositions:positions.size,maxPositions:cfg.maxPositions,realizedPnl:+realized.toFixed(2),paperEquity:cfg.paperEquity,riskDay,recovered,credentialsPresent:Boolean(process.env.PHEMEX_API_KEY&&process.env.PHEMEX_API_SECRET)};}
export function setKill(v=true){kill=Boolean(v);write({type:"kill_switch",enabled:kill});return riskState()}
export function paperEnter(x){rollDay();const c=classify(x);if(cfg.mode!=="paper")return {ok:false,error:"paper endpoint disabled outside paper mode"};if(kill)return {ok:false,error:"kill switch enabled"};if(!c.eligible)return {ok:false,error:"signal rejected",classification:c};if(positions.size>=cfg.maxPositions)return {ok:false,error:"max positions"};if((cooldown.get(x.symbol)||0)>Date.now())return {ok:false,error:"cooldown"};const dailyLimit=cfg.paperEquity*cfg.dailyLossPct/100;if(realized<=-dailyLimit)return {ok:false,error:"daily loss limit"};const id=crypto.randomUUID(),entry=Number(x.last),stop=entry*(1-0.012),riskUsd=cfg.paperEquity*cfg.riskPct/100,qty=riskUsd/(entry-stop),tp=entry+(entry-stop)*2;if(!Number.isFinite(qty)||qty<=0)return {ok:false,error:"invalid sizing"};const p={id,symbol:x.symbol,side:"Buy",entry,stop,tp,qty:+qty.toFixed(8),riskUsd:+riskUsd.toFixed(2),openedAt:Date.now(),status:"OPEN"};positions.set(id,p);cooldown.set(x.symbol,Date.now()+cfg.cooldownMs);write({type:"paper_entry",...p,classification:c});return {ok:true,position:p};}
export function paperMark(rows){rollDay();for(const p of [...positions.values()]){const x=rows.find(r=>r.symbol===p.symbol);if(!x?.last)continue;let exit=null,why=null;if(x.last<=p.stop){exit=p.stop;why="STOP"}else if(x.last>=p.tp){exit=p.tp;why="TP"}if(exit!=null){const pnl=(exit-p.entry)*p.qty;realized+=pnl;positions.delete(p.id);write({type:"paper_exit",...p,exit,reason:why,pnl:+pnl.toFixed(4)});}}}
export function openPositions(){return [...positions.values()]}
export function idempotent(key){if(!key)return false;if(seen.has(key))return false;seen.add(key);if(seen.size>5000)seen.delete(seen.values().next().value);return true}
