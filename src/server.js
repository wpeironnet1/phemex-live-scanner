import express from "express";import {fetchProducts,fetchTicker24h,fetchOrderBook,fetchTrades,fetchKlines,BASE_URL,WS_URL} from "./phemex.js";import {rows,status} from "./state.js";import {startFeed} from "./ws.js";
const app=express();app.use(express.json());startFeed();
app.get("/",(_q,r)=>r.json({service:"phemex-live-scanner",version:"1.0.0",mode:"public-read-only",rest:BASE_URL,ws:WS_URL,endpoints:["/health","/scan","/market/:symbol","/products"]}));
app.get("/health",(_q,r)=>r.json({ok:true,ts:new Date().toISOString(),...status()}));
app.get("/products",async(_q,r)=>{try{r.json(await fetchProducts())}catch(e){r.status(502).json({error:e.message})}});
app.get("/scan",(q,r)=>{const limit=Math.max(1,Math.min(50,Number(q.query.limit)||20));const minTurnover=Number(q.query.minTurnover)||0;r.json({ts:new Date().toISOString(),source:"Phemex WebSocket",...status(),ranked:rows().filter(x=>(x.turnover||0)>=minTurnover).slice(0,limit)})});
app.get("/market/:symbol",async(q,r)=>{try{const s=q.params.symbol.toUpperCase();const [ticker,book,trades,k1,k5]=await Promise.all([fetchTicker24h(s),fetchOrderBook(s),fetchTrades(s),fetchKlines(s,60,10),fetchKlines(s,300,10)]);r.json({ts:new Date().toISOString(),symbol:s,ticker,book,trades,kline1m:k1,kline5m:k5})}catch(e){r.status(502).json({error:e.message})}});
app.use((e,_q,r,_n)=>r.status(500).json({error:e.message}));
app.listen(Number(process.env.PORT||3000),()=>console.log("Phemex scanner ready"));