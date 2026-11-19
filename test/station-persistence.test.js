'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {setTimeout:wait}=require('node:timers/promises');
const R=require('../public/station-rules');

test('real authenticated station save survives server restart, isolates accounts and ignores forged progress',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'station-persist-'));
  const port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const p=socket.address().port;socket.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`,guest=`station_${process.pid}_${Date.now()}`;let child;
  async function start(){
    child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),NODE_ENV:'development',ALLOW_GUEST_AUTH:'true',BOT_TOKEN:'',BOT_MODE:'off',DATABASE_FILE:path.join(dir,'game.db'),DATABASE_URL:process.env.TEST_DATABASE_URL||''},stdio:['ignore','pipe','pipe']});
    let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
    for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(logs);try{if((await fetch(base+'/health')).ok)return;}catch(_){}await wait(100);}throw new Error('Server did not become healthy: '+logs);
  }
  async function stop(){if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}}
  async function post(route,body,owner=guest){const response=await fetch(base+'/api/station/'+route,{method:'POST',headers:{'Content-Type':'application/json',...(owner?{'X-Guest-Id':owner}:{})},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
  const me=async()=> (await fetch(base+'/api/me',{headers:{'X-Guest-Id':guest}})).json();
  try{
    await start();assert.equal((await post('start',{},null)).status,401);
    const before=(await me()).state;const s=(await post('start',{})).body;
    await wait(3100);
    const body={id:s.id,seq:1,inputs:[[2,40],[R.DOWN,140]],progress:{visited:['service'],anchor:'service'},gold:99999};
    const pair=await Promise.all([post('checkpoint',body),post('checkpoint',body)]);
    assert.ok(pair.every(r=>r.status===200),JSON.stringify(pair));
    assert.equal(pair.filter(r=>r.body.duplicate).length,1,'transaction serializes simultaneous retries');
    const result=pair[0];
    assert.deepEqual(result.body.progress.visited,['arrival','face']);
    assert.equal((await post('checkpoint',body)).body.duplicate,true);
    assert.equal((await post('checkpoint',body,guest+'_other')).status,409);
    const after=(await me()).state;
    for(const key of ['gold','ores','equipment','mines','prestige'])assert.deepEqual(after[key],before[key],key+' unchanged');
    // A regular profile read runs ensureSync; it must not drop station metadata.
    await stop();await start();
    const resumed=(await post('start',{})).body;
    assert.equal(resumed.progress.anchor,'face');assert.deepEqual(resumed.progress.visited,['arrival','face']);
    assert.equal(resumed.state.player.y+resumed.state.player.h,640);
    const other=(await post('start',{},guest+'_other')).body;assert.deepEqual(other.progress.visited,['arrival']);
  }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
