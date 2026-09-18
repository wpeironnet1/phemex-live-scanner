const startedAt=Date.now();
const counters={requests:0,errors:0,reconnects:0,wsMessages:0};
export function count(name,n=1){if(name in counters)counters[name]+=n}
export function metrics(feed={}){const age=feed.updatedAt?Date.now()-feed.updatedAt:null;return {uptimeSeconds:Math.floor((Date.now()-startedAt)/1000),...counters,feedAgeMs:age,feedFresh:age!=null&&age<15000}}
export function requestMetrics(req,res,next){count("requests");res.on("finish",()=>{if(res.statusCode>=500)count("errors")});next()}
