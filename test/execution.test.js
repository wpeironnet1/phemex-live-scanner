import test from "node:test";import assert from "node:assert/strict";
import {liveReadiness,protectionPlan,protectionCoverage,validateIntent,submitLiveIntent} from "../src/execution.js";

test("live execution is not armed by default",()=>{assert.equal(liveReadiness().canSubmitLive,false)});
test("protection is symmetric and reduce-only",()=>{const p=protectionPlan({side:"Buy",entry:100,qty:1});assert.equal(p.stop,98.8);assert.equal(p.takeProfit,102.4);assert.equal(p.trigger,"MarkPrice");assert.equal(p.reduceOnly,true)});
test("risk envelope rejects excessive leverage and notional",()=>{const v=validateIntent({symbol:"BTCUSDT",side:"Buy",qty:1,referencePrice:1000,leverage:20,marketAgeMs:1,spreadBps:1});assert.equal(v.ok,false);assert.ok(v.errors.includes("leverage_limit"));assert.ok(v.errors.includes("notional_limit"))});
test("submission cannot bypass arming gate",async()=>{await assert.rejects(()=>submitLiveIntent({symbol:"BTCUSDT",side:"Buy",qty:.01,referencePrice:100,leverage:1,marketAgeMs:1,spreadBps:1}),/not armed/)});
test("protection coverage detects missing target",()=>{const c=protectionCoverage([{symbol:"BTCUSDT",ordType:"Stop",reduceOnly:true,ordStatus:"New"}],"BTCUSDT");assert.equal(c.stop,true);assert.equal(c.takeProfit,false)});
test("protection coverage ignores dead orders and other symbols",()=>{const c=protectionCoverage([{symbol:"ETHUSDT",ordType:"Stop",reduceOnly:true,ordStatus:"New"},{symbol:"BTCUSDT",ordType:"MarketIfTouched",reduceOnly:true,ordStatus:"Canceled"}],"BTCUSDT");assert.deepEqual(c,{stop:false,takeProfit:false,activeCount:0})});
