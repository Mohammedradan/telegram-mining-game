/* Connected mine caves and playable overland routes. Pure rules: no economy or persistence writes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MineWorld = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MINES = Object.freeze([
    Object.freeze({ id:'stone', name:'المنجم الحجري', ore:'حجر ونحاس', depth:'120 م' }),
    Object.freeze({ id:'iron', name:'منجم الحديد', ore:'حديد', depth:'260 م' }),
    Object.freeze({ id:'gold', name:'منجم الذهب', ore:'ذهب', depth:'480 م' }),
    Object.freeze({ id:'crystal', name:'كهوف البلور', ore:'بلورات', depth:'720 م' }),
    Object.freeze({ id:'lava', name:'منجم الحمم', ore:'خام ناري', depth:'980 م' }),
    Object.freeze({ id:'legendary', name:'المنجم الأسطوري', ore:'خام أسطوري', depth:'1500 م' }),
  ]);
  const ROAD_OBSTACLES = Object.freeze([
    Object.freeze({ id:'boulder', x:.38, y:.78, radius:.09 }),
    Object.freeze({ id:'steam', x:.67, y:.48, radius:.09 }),
  ]);
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function create(initial=0) {
    const index=clamp(Math.floor(Number(initial)||0),0,MINES.length-1);
    return { index, breaks:0, floor:'lower', transitions:0, unlocked:index, climbing:false, lastExit:null,
      mode:'mine', travelDirection:1, routeProgress:0, lastObstacle:null };
  }
  function recordBreak(state) {
    if (!state || typeof state!=='object') return false;
    state.breaks=Math.min(999,state.breaks+1);
    return state.breaks>=3;
  }
  // A visited cave stays open; route progress is exploration only, never an economy entitlement.
  function canAdvance(state) {
    return !!state && state.index < MINES.length - 1 &&
      (state.breaks >= 3 || state.index < state.unlocked);
  }
  function moveOverland(state, miner, x, y, dt, aspect, band, speed, depthSpeed, oldX, oldY) {
    const direction=state.travelDirection < 0 ? -1 : 1;
    let nextX=clamp(miner.x+x*speed*dt,band.x0,band.x1);
    let nextY=clamp(miner.y+y*speed*depthSpeed*dt*Math.max(.2,aspect),band.y0,band.y1);
    let obstacle=null;
    for (const item of ROAD_OBSTACLES) {
      const d=Math.hypot(nextX-item.x,(nextY-item.y)/Math.max(.2,aspect));
      if (d < item.radius && Math.abs(nextX-oldX)>1e-8) {
        nextX=oldX;
        obstacle=item.id;
        break;
      }
    }
    miner.x=nextX; miner.y=nextY;
    state.lastObstacle=obstacle;
    if (Math.abs(x)>.05) miner.face=x>0?1:-1;
    const span=Math.max(.01,band.x1-band.x0);
    state.routeProgress=direction>0 ? clamp((miner.x-band.x0)/span,0,1) : clamp((band.x1-miner.x)/span,0,1);
    let transition=null;
    const atLeft=miner.x<=band.x0+.005, atRight=miner.x>=band.x1-.005;
    if (direction<0 && atLeft) {
      state.index=Math.min(MINES.length-1,state.index+1);
      state.unlocked=Math.max(state.unlocked,state.index);
      state.breaks=0; state.mode='mine'; state.floor='lower'; state.routeProgress=0;
      state.lastExit='arrive-forward'; miner.x=band.x0; miner.y=Math.min(band.y1,.8);
      state.transitions++; transition='arrive';
    } else if (direction>0 && atRight) {
      state.index=Math.max(0,state.index-1);
      state.unlocked=Math.max(state.unlocked,state.index);
      state.breaks=0; state.mode='mine'; state.floor='lower'; state.routeProgress=0;
      state.lastExit='arrive-back'; miner.x=band.x1; miner.y=Math.min(band.y1,.8);
      state.transitions++; transition='arrive';
    } else if ((direction<0 && atRight && x>.05) || (direction>0 && atLeft && x<-.05)) {
      // Turning around at the starting cave returns through the same physical opening.
      state.mode='mine'; state.floor='upper'; state.routeProgress=0; state.lastObstacle=null;
      state.lastExit='return'; miner.x=direction<0 ? band.x1 : band.x0; miner.y=.4;
      transition='return';
    }
    const moved=transition ? 0 : Math.hypot(miner.x-oldX,(miner.y-oldY)/Math.max(.2,aspect));
    return { moved, transition, climbing:false, floor:state.floor, overland:true, obstacle };
  }
  function step(state, miner, input, dt, aspect, band, speed=.6, depthSpeed=.55) {
    if (!state || !miner || !input || !Number.isFinite(dt) || !(dt>0)) return { moved:0, transition:null, climbing:false };
    const x=clamp(Number(input.x)||0,-1,1), y=clamp(Number(input.y)||0,-1,1);
    const len=Math.hypot(x,y), k=len>1?1/len:1, a=Math.max(.2,Number(aspect)||1);
    const ox=miner.x, oy=miner.y;
    if (state.mode==='overland') return moveOverland(state,miner,x*k,y*k,dt,a,band,speed,depthSpeed,ox,oy);
    const ladder=Math.abs(miner.x-.14)<=.105, lift=Math.abs(miner.x-.84)<=.09;
    const vertical=!!(ladder||lift) && Math.abs(y)>.05;
    miner.x=clamp(miner.x+x*k*speed*dt,band.x0,band.x1);
    // The y axis is depth in a cave and a cross-track lane outdoors.
    miner.y=clamp(miner.y+y*k*speed*depthSpeed*dt*a,band.y0,band.y1);
    if (vertical) state.floor=miner.y<.56?'upper':'lower';
    state.climbing=vertical;
    if (Math.abs(x)>.2) miner.face=x>0?1:-1;
    const atUpperTunnel=state.floor==='upper' && miner.y<.56;
    // A locked rockslide physically blocks the upper exit, not just its label.
    if (atUpperTunnel && x>.05 && state.index<MINES.length-1 && !canAdvance(state))
      miner.x=Math.min(miner.x,Math.max(band.x0,band.x1-.06));
    let transition=null;
    if (atUpperTunnel && x>.05 && miner.x>=band.x1-.005 && canAdvance(state)) {
      state.mode='overland'; state.travelDirection=-1; state.routeProgress=0; state.lastObstacle=null;
      state.floor='lower'; state.climbing=false; state.lastExit='forward';
      miner.x=band.x1; miner.y=Math.min(band.y1,.8); miner.face=-1;
      state.transitions++; transition='depart';
    } else if (atUpperTunnel && x<-.05 && miner.x<=band.x0+.005 && state.index>0) {
      state.mode='overland'; state.travelDirection=1; state.routeProgress=0; state.lastObstacle=null;
      state.floor='lower'; state.climbing=false; state.lastExit='back';
      miner.x=band.x0; miner.y=Math.min(band.y1,.8); miner.face=1;
      state.transitions++; transition='depart';
    }
    const moved=transition ? 0 : Math.hypot(miner.x-ox,(miner.y-oy)/a);
    return { moved, transition, climbing:vertical, ladder, lift, floor:state.floor, overland:false };
  }
  return Object.freeze({ MINES, ROAD_OBSTACLES, create, recordBreak, canAdvance, step });
});
