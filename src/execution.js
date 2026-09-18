import crypto from "node:crypto";
import {privateRequest,authStatus} from "./auth.js";

const mode=()=>String(process.env.TRADING_MODE||"paper").toLowerCase();
const armed=()=>process.env.LIVE_TRADING_ARMED==="YES_I_ACCEPT_LIVE_ORDER_RISK";
const maxLev=()=>Math.max(1,Number(process.env.MAX_LEVERAGE||3));
const maxNotional=()=>Math.max(1,Number(process.env.MAX_NOTIONAL_USD||100));

export function liveReadiness(){const a=authStatus();return {...a,armed:armed(),maxLeverage:maxLev(),maxNotionalUsd:maxNotional(),canSubmitLive:mode()==="live"&&armed()&&a.credentialsPresent};}
export function protectionPlan({side,entry,qty,stopPct=1.2,rewardR=2}){entry=Number(entry);qty=Number(qty);if(![entry,qty,stopPct,rewardR].every(Number.isFinite)||entry<=0||qty<=0)throw new Error("invalid protection inputs");const d=entry*stopPct/100;const long=side==="Buy";return {stop:+(entry+(long?-d:d)).toFixed(8),takeProfit:+(entry+(long?d*rewardR:-d*rewardR)).toFixed(8),trigger:"MarkPrice",reduceOnly:true};}
export function validateIntent(i){const errors=[];if(!i?.symbol)errors.push("symbol");if(!["Buy","Sell"].includes(i?.side))errors.push("side");if(!(Number(i?.qty)>0))errors.push("qty");if(!(Number(i?.referencePrice)>0))errors.push("referencePrice");const lev=Number(i?.leverage||1),notional=Number(i?.qty)*Number(i?.referencePrice);if(lev>maxLev())errors.push("leverage_limit");if(notional>maxNotional())errors.push("notional_limit");if(Number(i?.marketAgeMs)>Number(process.env.MAX_MARKET_AGE_MS||10000))errors.push("stale_market");if(Number(i?.spreadBps||0)>Number(process.env.MAX_SPREAD_BPS||25))errors.push("spread");return {ok:errors.length===0,errors,notional:+notional.toFixed(2),leverage:lev};}
export async function submitLiveIntent(intent){const v=validateIntent(intent);if(!v.ok)throw new Error(`live intent rejected: ${v.errors.join(",")}`);if(!liveReadiness().canSubmitLive)throw new Error("live execution is not armed");const clOrdID=intent.clientOrderId||`pls-${crypto.randomUUID()}`;const protection=protectionPlan(intent);const body={symbol:intent.symbol,side:intent.side,ordType:"Market",orderQty:Number(intent.qty),clOrdID,reduceOnly:false,takeProfitRp:String(protection.takeProfit),stopLossRp:String(protection.stop)};const result=await privateRequest("POST","/g-orders",{body});return {ok:true,clientOrderId:clOrdID,protection,result};}
