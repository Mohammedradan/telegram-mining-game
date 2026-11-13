/* Phase 1 greybox inside the mining window. No reward or economy writes. */
(() => {
  'use strict';
  const R=window.StationRules, bridge=window.PlatformBridge, tab=document.getElementById('tab-mining');
  if(!R||!bridge||!tab) return;
  const entry=document.createElement('button');
  entry.id='station-enter';entry.type='button';entry.className='station-entry';
  entry.setAttribute('aria-label','محطة الصدى — تجربة الحركة');entry.title='محطة الصدى — تجربة الحركة';
  entry.innerHTML='<svg class="ui-icon" aria-hidden="true"><use href="#i-rope"></use></svg>';
  (document.querySelector('.ck-hud')||tab).append(entry);
  const root=document.createElement('section');root.id='station-view';root.hidden=true;
  root.setAttribute('aria-label','محطة الصدى القديمة — عالم الحركة التجريبي');
  root.innerHTML=`<header><b>محطة الصدى · الحركة فقط</b><button type="button" id="station-close">حفظ وعودة</button></header>
    <p id="station-status" role="status" aria-live="polite"></p>
    <p class="station-hint">استكشف الطبقات الثلاث. الأسهم أو A/D، مسافة للقفز، W/S للسلم، Shift للجري. المصعد والعربة والصدى لاحقاً.</p>
    <div class="station-field"><canvas id="station-canvas" tabindex="0" aria-label="عالم حركة جانبي؛ استخدم أزرار الحركة أو لوحة المفاتيح"></canvas></div>
    <div class="station-controls" role="group" aria-label="تحكم العامل">
    <button type="button" data-station="1" aria-label="يسار">يسار</button><button type="button" data-station="2" aria-label="يمين">يمين</button>
    <button type="button" data-station="1024" aria-label="تسلق لأعلى">أعلى</button><button type="button" data-station="2048" aria-label="تسلق لأسفل">أسفل</button>
    <button type="button" data-station="4" aria-label="قفز">قفز</button><button type="button" id="station-run" aria-pressed="false">جري</button></div>
    <button type="button" id="station-retry" hidden>إعادة محاولة الحفظ</button><button type="button" id="station-restore" hidden>استعادة آخر حفظ</button>`;
  tab.append(root);
  const canvas=root.querySelector('canvas');
  if(!canvas||typeof canvas.getContext!=='function') {root.remove?.();entry.remove?.();return;}
  const ctx=canvas.getContext('2d'),status=root.querySelector('#station-status');
  if(!ctx) {root.remove?.();entry.remove?.();return;}
  let suspended=false;
  let sim=null,id=null,seq=0,open=false,starting=false,closing=false,raf=0,last=0,acc=0,pending=[],ticks=0,packet=null,busy=null,error=false,running=false,sessionOwner=null;
  const keys=new Set(),pointers=new Map(),pulses=new Set();
  const keyMap={ArrowLeft:1,KeyA:1,ArrowRight:2,KeyD:2,ArrowUp:1024,KeyW:1024,ArrowDown:2048,KeyS:2048,Space:4,ShiftLeft:4096,ShiftRight:4096};
  function reset() {keys.clear();pointers.clear();pulses.clear();last=0;acc=0;root.querySelectorAll('[data-station]').forEach(b=>b.removeAttribute('data-down'));}
  function visible() {return open&&!suspended&&!document.hidden&&tab.classList.contains('active');}
  function message(text) {status.textContent=text;}
  const request=(path,body)=>bridge.request('/api/station/'+path,{method:'POST',body:JSON.stringify(body)});
  function fail(e) {
    error=true;reset();message((e?.message||'تعذر الحفظ')+' — التقدم غير المؤكد لم يُحفظ.');
    root.querySelector('#station-retry').hidden=false;root.querySelector('#station-restore').hidden=false;
  }
  async function flush() {
    if(busy) return busy;
    if(!id||(!packet&&!ticks)) return true;
    if(bridge.user()!==sessionOwner) {fail(new Error('تغير الحساب؛ أغلق التجربة وأعد فتحها'));return false;}
    if(!packet) {packet={id,seq:seq+1,inputs:pending};pending=[];ticks=0;}
    const sent=packet;
    busy=(async()=>{
      try {
        const receipt=await request('checkpoint',sent);
        if(receipt.id!==id||receipt.seq!==sent.seq) throw new Error('إيصال حفظ غير مطابق');
        seq=receipt.seq;packet=null;error=false;
        root.querySelector('#station-retry').hidden=true;root.querySelector('#station-restore').hidden=true;
        message(`محفوظ على الحساب · ${receipt.progress.visited.length}/6 مواقع · ${R.rooms.find(r=>r.id===receipt.progress.anchor)?.name||''}`);
        return true;
      } catch(e) {fail(e);return false;}
      finally {busy=null;}
    })();
    return busy;
  }
  async function start() {
    if(starting||busy||closing) return;
    starting=true;entry.disabled=true;
    try {
      await bridge.ready();if(!bridge.user()) throw new Error('يلزم حساب خادمي لحفظ الاستكشاف');
      await bridge.flush();
      const receipt=await request('start',{});
      sim=receipt.state;id=receipt.id;seq=receipt.seq;sessionOwner=bridge.user();pending=[];ticks=0;packet=null;error=false;
      root.querySelector('#station-retry').hidden=true;root.querySelector('#station-restore').hidden=true;
      reset();open=true;root.hidden=false;document.body.classList.add('station-open');
      window.DigSite?.onTab?.('station');
      message(`محفوظ على الحساب · ${receipt.progress.visited.length}/6 مواقع`);
      canvas.focus();wake();
    } catch(e) {if(open) fail(e);else window.alert(e.message||'تعذر فتح المحطة');}
    finally {starting=false;entry.disabled=false;}
  }
  async function close() {
    if(closing) return;closing=true;reset();
    try {
      if(busy&&!await busy) return;
      while(packet||ticks) if(!await flush()) return;
      open=false;root.hidden=true;document.body.classList.remove('station-open');cancelAnimationFrame(raf);raf=0;
      window.DigSite?.onTab?.('mining');entry.focus();
    } finally {closing=false;}
  }
  function mask() {let result=running?R.RUN:0;for(const k of keys) result|=keyMap[k]||0;for(const value of pointers.values()) result|=value;for(const value of pulses)result|=value;pulses.clear();return result;}
  function record(value) {const tail=pending[pending.length-1];if(tail&&tail[0]===value)tail[1]++;else pending.push([value,1]);ticks++;}
  function draw() {
    const box=canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,box.width),h=Math.max(1,box.height);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    const scale=Math.min(1.2,Math.max(.6,h/520)),vw=w/scale,vh=h/scale,camera=R.camera(sim,vw,vh);
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#09131f';ctx.fillRect(0,0,w,h);ctx.scale(scale,scale);ctx.translate(-camera.x,-camera.y);
    ctx.strokeStyle='#142b3c';ctx.lineWidth=1;
    for(let x=0;x<R.level.width;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,R.level.height);ctx.stroke();}
    for(const r of R.rooms){ctx.fillStyle=sim.visited.includes(r.id)?'#72e7ba':'#a5b8ca';ctx.font='16px sans-serif';ctx.textAlign='left';ctx.fillText(r.name,r.x-60,r.y-100);ctx.fillRect(r.x,r.y-12,6,12);}
    for(const b of R.level.platforms){ctx.fillStyle=b.route?'#46738b':'#ad8054';ctx.fillRect(b.x,b.y,b.w,b.h);}
    ctx.strokeStyle='#e5c879';ctx.lineWidth=4;
    for(const l of R.level.ladders){for(const x of [l.x,l.x+28]){ctx.beginPath();ctx.moveTo(x,l.y);ctx.lineTo(x,l.bottom);ctx.stroke();}for(let y=l.y;y<l.bottom;y+=20){ctx.beginPath();ctx.moveTo(l.x,y);ctx.lineTo(l.x+28,y);ctx.stroke();}}
    const p=sim.player;ctx.fillStyle='#edb35a';ctx.fillRect(p.x,p.y,p.w,p.h);ctx.fillStyle='#f0f8ff';ctx.fillRect(p.x+(p.facing>0?p.w-10:2),p.y+10,8,8);
  }
  function frame(time) {
    raf=0;if(!visible()||!sim){reset();void flush();return;}
    if(bridge.user()!==sessionOwner){fail(new Error('تغير الحساب؛ أعد فتح المحطة'));draw();return;}
    const dt=last?Math.min(.1,(time-last)/1000):0;last=time;acc+=dt;
    while(acc>=1/60){acc-=1/60;if(!error&&!closing&&ticks<600){const value=mask();R.step(sim,value);record(value);}}
    if(ticks>=120&&!busy&&!error) void flush();
    draw();wake();
  }
  function wake(){if(visible()&&!raf)raf=requestAnimationFrame(frame);}
  entry.addEventListener('click',()=>void start());root.querySelector('#station-close').addEventListener('click',()=>void close());
  root.querySelector('#station-retry').addEventListener('click',()=>void flush());
  root.querySelector('#station-restore').addEventListener('click',()=>{if(window.confirm('استعادة آخر نقطة مؤكدة وإلغاء الحركة غير المحفوظة؟'))void start();});
  root.querySelector('#station-run').addEventListener('click',e=>{running=!running;e.currentTarget.setAttribute('aria-pressed',String(running));});
  for(const b of root.querySelectorAll('[data-station]')){
    b.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;const value=Number(b.dataset.station);pointers.set(e.pointerId,value);if(value===4)pulses.add(value);b.setPointerCapture(e.pointerId);b.dataset.down='true';e.preventDefault();});
    const release=e=>{pointers.delete(e.pointerId);if(e.type==='pointercancel')pulses.delete(Number(b.dataset.station));delete b.dataset.down;};
    for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,release);
  }
  document.addEventListener('keydown',e=>{
    if(!visible())return;
    if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();void close();return;}
    if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,button,[contenteditable="true"]'))return;
    if(keyMap[e.code]){e.preventDefault();keys.add(e.code);if(e.code==='Space'&&!e.repeat)pulses.add(4);}
  },true);
  document.addEventListener('keyup',e=>{keys.delete(e.code);if(visible()&&keyMap[e.code])e.preventDefault();},true);
  window.addEventListener('blur',()=>{suspended=true;reset();if(open)void flush();});
  window.addEventListener('focus',()=>{suspended=false;reset();wake();});
  document.addEventListener('visibilitychange',()=>{reset();if(document.hidden&&open)void flush();else wake();});
  new MutationObserver(()=>{reset();if(!visible()&&open)void flush();else wake();}).observe(tab,{attributes:true,attributeFilter:['class']});
  window.StationUI=Object.freeze({inspect:()=>({open,seq,error,dirty:!!(ticks||packet),state:sim?JSON.parse(JSON.stringify(sim)):null}),save:flush});
})();
