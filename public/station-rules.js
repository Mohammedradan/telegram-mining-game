/* Old Echo Station — movement and passenger lift greybox. Shared platform motion, no economy. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./platform-rules'),require('./station-lift'));
  else root.StationRules = factory(root.PlatformRules,root.StationLift);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(R,Lift) {
  'use strict';
  const VERSION = 2, DOWN = 2048, RUN = 4096;
  const MASK = R.INPUT.LEFT | R.INPUT.RIGHT | R.INPUT.JUMP | R.INPUT.UP | DOWN | RUN | Lift.ACTION;
  const rooms = Object.freeze([
    {id:'arrival',name:'محطة العودة',x:120,y:320}, {id:'balcony',name:'شرفة المصعد',x:1320,y:320},
    {id:'face',name:'واجهة التعدين — مرحلة الحركة',x:120,y:640}, {id:'transfer',name:'محطة النقل — قيد التطوير',x:1320,y:640},
    {id:'survey',name:'موقع المسح — الصدى لاحقاً',x:120,y:960}, {id:'service',name:'ردهة الصيانة',x:1320,y:960},
  ].map(Object.freeze));
  const level = Object.freeze({width:2400,height:1120,downMask:DOWN,walkableRoutes:true,
    platforms:Object.freeze([
      {x:0,y:320,w:700,h:24,route:'upper'}, {x:780,y:320,w:1620,h:24,route:'upper'},
      {x:0,y:640,w:2400,h:24,route:'upper'}, {x:0,y:960,w:2400,h:24,route:'upper'},
      {x:520,y:256,w:48,h:64}, {x:1800,y:576,w:48,h:64},
    ].flatMap(box=>box.route&&box.x<Lift.SPEC.x&&box.x+box.w>Lift.SPEC.x+Lift.SPEC.w ? [
      {...box,w:Lift.SPEC.x-box.x},
      {...box,x:Lift.SPEC.x+Lift.SPEC.w,w:box.x+box.w-Lift.SPEC.x-Lift.SPEC.w},
    ] : [box]).map(Object.freeze)),
    ladders:Object.freeze([{x:186,y:320,bottom:640},{x:1266,y:640,bottom:960}].map(Object.freeze)),
  });
  function create(progress = {}) {
    const visited = rooms.filter(r => Array.isArray(progress.visited) && progress.visited.includes(r.id)).map(r => r.id);
    const anchor = rooms.find(r => r.id === progress.anchor && visited.includes(r.id)) || rooms[0];
    const player = R.create('miner',1).player;
    Object.assign(player,{x:anchor.x,y:anchor.y-player.h,vx:0,vy:0,grounded:true,upperRouteY:anchor.y,speed:220,climbing:false});
    return {version:VERSION,tick:0,lastMask:0,player,rocks:[],events:[],visited,anchor:anchor.id,lift:Lift.create(progress.lift)};
  }
  function step(s,mask) {
    if (!Number.isInteger(mask) || mask<0 || mask>MASK || (mask & ~MASK)) throw new Error('invalid station input');
    s.events=[]; s.tick++;
    const p=s.player;
    const ride=Lift.step(s,mask,R.INPUT.UP,DOWN);
    const physicsMask=ride.locked?0:mask;
    R.motion.updateJumpWindow(s,physicsMask);
    const direction=Number(!!(mask&R.INPUT.RIGHT))-Number(!!(mask&R.INPUT.LEFT));
    p.vx=direction*p.speed*((mask&RUN)?1:.55);
    if(direction) p.facing=direction;
    if(ride.locked){p.vx=0;p.jumpBuffer=0;}
    else R.motion.applyJump(s);
    R.motion.moveActor(s,physicsMask,{...level,platforms:level.platforms.concat(Lift.platforms(s.lift))});
    if(p.y>level.height || p.y < -200) {
      const anchor=rooms.find(r=>r.id===s.anchor)||rooms[0];
      Object.assign(p,{x:anchor.x,y:anchor.y-p.h,vx:0,vy:0,grounded:true,upperRouteY:anchor.y});
      s.events.push({type:'return_safe'});
    }
    discover(s);
    p.pose=p.climbing?'climb':!p.grounded?(p.vy<0?'jump':'fall'):Math.abs(p.vx)>0?'run':'idle';
    s.lastMask=mask;
    return s;
  }
  function discover(s) {
    const p=s.player;
    for(const room of rooms) if(p.grounded && Math.abs(p.x-room.x)<80 && Math.abs(p.y+p.h-room.y)<1) {
      if(!s.visited.includes(room.id)) {s.visited.push(room.id);s.events.push({type:'discovery',id:room.id});}
      s.anchor=room.id;
    }
  }
  function replay(state,inputs) {
    if(!Array.isArray(inputs)||!inputs.length||inputs.length>600) return {ok:false};
    let ticks=0;
    for(const entry of inputs) {
      if(!Array.isArray(entry)||entry.length!==2||!Number.isInteger(entry[0])||entry[0]<0||entry[0]>MASK||(entry[0]&~MASK)||!Number.isInteger(entry[1])||entry[1]<1||entry[1]>600) return {ok:false};
      ticks+=entry[1]; if(ticks>600) return {ok:false};
    }
    const next=JSON.parse(JSON.stringify(state));
    for(const [mask,n] of inputs) for(let i=0;i<n;i++) step(next,mask);
    return {ok:true,state:next,ticks};
  }
  function progress(s) {return {visited:[...s.visited],anchor:s.anchor,lift:{...s.lift}};}
  function camera(s,width,height) {
    return {x:Math.max(0,Math.min(level.width-width,s.player.x+s.player.w/2-width*.45)),
      y:Math.max(0,Math.min(level.height-height,s.player.y+s.player.h/2-height*.48))};
  }
  return Object.freeze({Lift,VERSION,DOWN,RUN,MASK,INPUT:R.INPUT,level,rooms,create,step,discover,replay,progress,camera});
});
