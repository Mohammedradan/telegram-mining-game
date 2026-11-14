/* Connected mining world: six themed caves with real ladder/elevator traversal.
   Pure deterministic rules; no economy or persistence writes. */
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
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function create(initial=0) {
    const index=clamp(Math.floor(Number(initial)||0),0,MINES.length-1);
    return { index, breaks:0, floor:'lower', transitions:0, unlocked:index, climbing:false, lastExit:null };
  }
  function recordBreak(state) {
    if (!state || typeof state!=='object') return false;
    state.breaks=Math.min(999,state.breaks+1);
    return state.breaks>=3;
  }
  // A visited cave stays open; this is exploration state, never an economy entitlement.
  function canAdvance(state) {
    return !!state && state.index < MINES.length - 1 &&
      (state.breaks >= 3 || state.index < state.unlocked);
  }
  function step(state, miner, input, dt, aspect, band, speed=0.6, depthSpeed=0.55) {
    if (!state || !miner || !input || !Number.isFinite(dt) || !(dt>0)) return { moved:0, transition:null, climbing:false };
    const x=clamp(Number(input.x)||0,-1,1), y=clamp(Number(input.y)||0,-1,1);
    const len=Math.hypot(x,y), k=len>1?1/len:1, a=Math.max(.2,Number(aspect)||1);
    const ladder=Math.abs(miner.x-.14)<=.105, lift=Math.abs(miner.x-.84)<=.09;
    const vertical=!!(ladder||lift) && Math.abs(y)>.05;
    const ox=miner.x, oy=miner.y;
    miner.x=clamp(miner.x+x*k*speed*dt,band.x0,band.x1);
    // The y axis is ordinary 2.5D depth movement on either work lane.
    // A shaft is required only to change floors; otherwise the miner can still
    // walk toward/away from the camera to approach rocks at different depths.
    miner.y=clamp(miner.y+y*k*speed*depthSpeed*dt*a,band.y0,band.y1);
    if (vertical) state.floor=miner.y<.56?'upper':'lower';
    state.climbing=vertical;
    if (Math.abs(x)>.2) miner.face=x>0?1:-1;
    // A locked rockslide is a physical barrier in the upper exit tunnel, not just a label.
    // Previously unlocked caves remain passable; the final mine is a safe dead end.
    const atUpperTunnel = state.floor==='upper' && miner.y<.56;
    if (atUpperTunnel && x>.05 && state.index<MINES.length-1 && !canAdvance(state)) {
      miner.x=Math.min(miner.x,Math.max(band.x0,band.x1-.06));
    }
    let transition=null;
    // Use measured body-safe bounds, not .91: mobile sprites can cap x at .80.
    // The upper-floor flag alone is insufficient after walking away from a shaft.
    if (atUpperTunnel && x>.05 && miner.x>=band.x1-.005 && canAdvance(state)) {
      state.index++; state.unlocked=Math.max(state.unlocked,state.index); state.breaks=0;
      miner.x=band.x0+.04; miner.y=Math.min(band.y1,.8); state.floor='lower';
      state.transitions++; state.lastExit='forward'; transition='next';
    } else if (atUpperTunnel && x<-.05 && miner.x<=band.x0+.005 && state.index>0) {
      state.index--; state.breaks=0; miner.x=band.x1-.04; miner.y=Math.min(band.y1,.8);
      state.transitions++; state.lastExit='back'; transition='previous';
    }
    const moved=Math.hypot(miner.x-ox,(miner.y-oy)/a);
    return { moved, transition, climbing:vertical, ladder, lift, floor:state.floor };
  }
  return Object.freeze({ MINES, create, recordBreak, canAdvance, step });
});
