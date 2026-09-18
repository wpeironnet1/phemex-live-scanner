import test from "node:test";import assert from "node:assert/strict";import {classify,riskState} from "../src/trading.js";
test("rejects stale data",()=>assert.equal(classify({ready1m:true,ready5m:true,marketAgeMs:20000,p1:.2,p5:.4}).eligible,false));
test("rejects chased move",()=>assert.ok(classify({ready1m:true,ready5m:true,marketAgeMs:1,p1:2,p5:4}).reasons.includes("chase")));
test("accepts balanced early momentum",()=>assert.equal(classify({ready1m:true,ready5m:true,marketAgeMs:1,p1:.2,p5:.45,volumeAcceleration:1.3,oiDelta1m:.05,orderBookImbalance:.1,tradeFlow1m:.1}).class,"EARLY_MOMENTUM"));
test("defaults to paper",()=>assert.equal(riskState().mode,"paper"));
