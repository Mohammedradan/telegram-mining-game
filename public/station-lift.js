/* Deterministic passenger transport. Collision/gravity remain in PlatformRules.motion. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.StationLift=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const ACTION=8192;
  const SPEC=Object.freeze({x:1400,w:120,h:16,speed:160,stops:Object.freeze([320,640,960]),gateHeight:100});
  function create(saved={}){
    const y=Number.isFinite(saved?.y)&&saved.y>=320&&saved.y<=960?saved.y:640;
    const target=SPEC.stops.includes(saved?.target)?saved.target:640;
    return {y,target,direction:saved?.direction===1?1:-1};
  }
  const moving=lift=>lift.y!==lift.target;
  const aboard=(p,lift)=>p.grounded&&p.x>=SPEC.x&&p.x+p.w<=SPEC.x+SPEC.w&&Math.abs(p.y+p.h-lift.y)<.001;
  function nearby(p){
    return p.grounded&&p.x+p.w>=SPEC.x-90&&p.x<=SPEC.x+SPEC.w+90&&SPEC.stops.some(y=>Math.abs(p.y+p.h-y)<.001);
  }
  function hint(state){
    if(moving(state.lift))return aboard(state.player,state.lift)?'المصعد يتحرك — انتظر الوصول':'المصعد في الطريق';
    if(aboard(state.player,state.lift))return 'داخل المصعد: تفاعل أو E للانطلاق، أعلى/أسفل لاختيار الاتجاه';
    return nearby(state.player)?'تفاعل أو E لنداء المصعد، ثم امشِ إلى المنصة':'المصعد عند الطرف الأيمن للممر — الحركة التجريبية متاحة';
  }
  function step(state,mask,up,down){
    const lift=state.lift,p=state.player,rider=aboard(p,lift);
    if(!moving(lift)){
      const pressed=mask&~state.lastMask;
      if(rider){
        const direction=(pressed&up)?-1:(pressed&down)?1:lift.direction;
        if(pressed&(ACTION|up|down)){
          const index=SPEC.stops.indexOf(lift.y),next=SPEC.stops[index+direction];
          if(next!==undefined){lift.target=next;lift.direction=direction;}
        }
      }else if((pressed&ACTION)&&nearby(p)){
        lift.target=SPEC.stops.find(y=>Math.abs(p.y+p.h-y)<.001);
      }
    }
    const previous=lift.y;
    const delta=Math.sign(lift.target-lift.y)*Math.min(SPEC.speed/60,Math.abs(lift.target-lift.y));
    lift.y+=delta;
    if(rider&&delta){p.y+=delta;p.vy=0;p.grounded=true;p.upperRouteY=lift.y;}
    if(previous!==lift.y&&!moving(lift)){
      if(lift.y===320)lift.direction=1;
      if(lift.y===960)lift.direction=-1;
      state.events.push({type:'lift_arrive',y:lift.y});
    }
    return {rider,locked:rider&&(delta!==0||moving(lift))};
  }
  function platforms(lift){
    const boxes=[{x:SPEC.x,y:lift.y,w:SPEC.w,h:SPEC.h,route:'upper',lift:true}];
    // Closed landing gates prevent entering an empty shaft. They are taller than
    // the jump arc, and retract only when the cabin is fully docked at that stop.
    for(const y of SPEC.stops)if(moving(lift)||lift.y!==y){
      boxes.push({x:SPEC.x-8,y:y-SPEC.gateHeight,w:8,h:SPEC.gateHeight,gate:true});
      boxes.push({x:SPEC.x+SPEC.w,y:y-SPEC.gateHeight,w:8,h:SPEC.gateHeight,gate:true});
    }
    return boxes;
  }
  return Object.freeze({ACTION,SPEC,create,moving,aboard,nearby,hint,step,platforms});
});
