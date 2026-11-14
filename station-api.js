'use strict';
const crypto = require('node:crypto');
const Rules = require('./public/station-rules');
const LIFETIME = 30 * 60 * 1000;

// Same authenticated user, transaction and ledger as the rest of the game.
// Discovery/checkpoint and lift metadata only. No rewards/resources.
function mountStation({app,store,requireAuth,rateLimit,asyncRoute,prepare,now=Date.now}) {
  app.post('/api/station/start',requireAuth,rateLimit('station-start',12),asyncRoute(async(req,res)=>{
    const response=await store.withUsers([req.player.id],async()=>{
      const user=await prepare(req.player);
      const saved=user.sync.station;
      const state=Rules.create([1,Rules.VERSION].includes(saved?.version)?saved.progress:{});
      Rules.discover(state);
      const session={id:crypto.randomUUID(),seq:0,startedAt:now(),state,lastDigest:null};
      user.sync.station={version:Rules.VERSION,progress:Rules.progress(state),session};
      user.revision++; user.updatedAt=now(); await store.putUser(user);
      return {id:session.id,seq:0,state,progress:Rules.progress(state)};
    });
    res.json(response);
  }));
  app.post('/api/station/checkpoint',requireAuth,rateLimit('station-checkpoint',90),asyncRoute(async(req,res)=>{
    const {id,seq,inputs}=req.body||{};
    if(typeof id!=='string'||id.length>64||!Number.isSafeInteger(seq)||seq<1) return res.status(400).json({error:'طلب حفظ غير صالح'});
    const response=await store.withUsers([req.player.id],async()=>{
      const user=await prepare(req.player), saved=user.sync.station, session=saved?.session;
      if(!session||saved.version!==Rules.VERSION||session.id!==id||now()-session.startedAt>LIFETIME) return {status:409,error:'انتهت جلسة القطاع؛ أعد فتح المحطة'};
      const digest=crypto.createHash('sha256').update(JSON.stringify(inputs) || '').digest('hex');
      const receipt=()=>({id:session.id,seq:session.seq,state:session.state,progress:saved.progress});
      if(seq===session.seq&&digest===session.lastDigest) return {...receipt(),duplicate:true};
      if(seq!==session.seq+1) return {status:409,error:'تعارض حفظ؛ أعد فتح المحطة لاستعادة آخر نقطة آمنة'};
      const replay=Rules.replay(session.state,inputs);
      if(!replay.ok) return {status:400,error:'مدخلات حركة غير صالحة'};
      if(replay.state.tick>Math.floor(Math.max(0,now()-session.startedAt)*.06)+120) return {status:400,error:'زمن حركة غير صالح'};
      const old=saved.progress.visited;
      session.state=replay.state;session.seq=seq;session.lastDigest=digest;
      saved.progress=Rules.progress(replay.state);
      const discovered=saved.progress.visited.filter(id=>!old.includes(id));
      if(discovered.length) await store.appendLedger(user.id,[{session:`station:${session.id}`,seq,kind:'station_discovery',goldDelta:0,at:now(),detail:{rooms:discovered,version:Rules.VERSION}}]);
      user.revision++;user.updatedAt=now();await store.putUser(user);
      return receipt();
    });
    if(response.status) return res.status(response.status).json(response);
    res.json(response);
  }));
}
module.exports={mountStation,LIFETIME};
