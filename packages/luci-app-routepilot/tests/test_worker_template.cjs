// Public template wrapper contract; no live Cloudflare deployment.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
if(!vm.SourceTextModule){const r=require('node:child_process').spawnSync(process.execPath,['--experimental-vm-modules',__filename],{stdio:'inherit'});process.exit(r.status==null?1:r.status);}
(async()=>{
 const file=path.join(__dirname,'../root/usr/share/routepilot/workers/worker.mjs');
 let connectImpl=()=>{throw Error('Network disabled in test');};
 const context=vm.createContext({Response,Request,URL,URLSearchParams,crypto:require('node:crypto').webcrypto,console:{log(){},error(){}},TextEncoder,TextDecoder,ReadableStream,WritableStream,TransformStream,WebSocket:{OPEN:1},atob,btoa,setTimeout,clearTimeout});
 // Export internal helpers only in the test VM; the shipped module exposes default only.
 const module=new vm.SourceTextModule(fs.readFileSync(file,'utf8')+'\nexport { rpRelayList,rpRelayHealth,rpDialOrdered,创建请求TCP连接器,forwardataTCP };',{context});
 await module.link(async(specifier)=>{assert.equal(specifier,'cloudflare:sockets');return new vm.SyntheticModule(['connect'],function(){this.setExport('connect',(...args)=>connectImpl(...args));},{context});});
 await module.evaluate();const handler=module.namespace.default;
 const health=await handler.fetch(new Request('https://worker.example.com/health'),{},{});assert.equal(health.status,200);assert.equal((await health.json()).service,'routepilot-worker');
 for(const route of ['/admin','/sub','/login','/','/tunnel'])assert.equal((await handler.fetch(new Request('https://worker.example.com'+route),{},{})).status,404);
 assert.equal((await handler.fetch(new Request('https://worker.example.com/tunnel',{headers:{Upgrade:'websocket'}}),{},{})).status,503);
 const {rpRelayList:list,rpRelayHealth:healthMap,rpDialOrdered:ordered,创建请求TCP连接器:connector,forwardataTCP:forward}=module.namespace;
 assert.equal(Array.from(list('a.example.com:443\nb.example.com:443')).length,2);
 for(const value of ['127.0.0.1:443','192.168.1.1:443','https://example.com','a.example.com:0'])assert.throws(()=>list(value));
 let closed=0;const sock=()=>({opened:Promise.resolve(),closed:new Promise(()=>{}),close(){closed++;},writable:new WritableStream({write(){}})});
 let calls=[],clock=1000;
 const pool=['a.example.com:443','b.example.com:443'];
 const resolve=async key=>[[key.split(':')[0],443]];
 const dial=async host=>{calls.push(host);if(host==='a.example.com')throw Error('primary down');return sock();};
 await ordered(pool,resolve,dial,async()=>{},()=>clock);assert.deepEqual(calls,['a.example.com','b.example.com']);
 calls=[];await ordered(pool,resolve,dial,async()=>{},()=>clock);assert.deepEqual(calls,['b.example.com']);
 clock+=31000;calls=[];await ordered(pool,resolve,dial,async()=>{},()=>clock);assert.deepEqual(calls,['a.example.com','b.example.com']);
 healthMap.clear();calls=[];
 await assert.rejects(ordered(pool,resolve,async host=>{calls.push(host);return sock();},async()=>{throw Error('partial payload');}));
 assert.deepEqual(calls,['a.example.com']);assert.ok(closed>0);
 healthMap.clear();calls=[];
 await assert.rejects(ordered(pool,resolve,async host=>{calls.push(host);return sock();},()=>new Promise(()=>{})),/deadline/);
 assert.deepEqual(calls,['a.example.com']); // A stalled payload write cannot trigger replay to backup.
 healthMap.clear();calls=[];
 await assert.rejects(ordered(pool,resolve,async host=>{calls.push(host);throw Error('closed');},async()=>{}),/all configured/);assert.deepEqual(calls,['a.example.com','b.example.com']);
 // Both cooling still retries the configured pool instead of permanently disabling it.
 calls=[];await assert.rejects(ordered(pool,resolve,async host=>{calls.push(host);throw Error('closed');},async()=>{}));assert.deepEqual(calls,['a.example.com','b.example.com']);
 healthMap.clear();
 connectImpl=(address)=>{calls.push(address.hostname);return sock();};calls=[];
 connector(null)({hostname:'native.example.com',port:443});assert.deepEqual(calls,['native.example.com']);
 // Exercise actual upstream wiring, not just an isolated helper: force must never dial target.
 const req=new Request('https://worker.example.com/tunnel');Object.defineProperty(req,'routepilotProxy',{value:{pool:['8.8.8.8:443'],force:true}});
 calls=[];let sent=0;connectImpl=address=>{calls.push(address.hostname);return {...sock(),writable:new WritableStream({write(v){sent+=v.length;}})};};
 await forward('target.example.com',443,new Uint8Array([1,2,3]),{readyState:1,close(){}},null,{},'11111111-1111-4111-8111-111111111111',req,{},false,null,true);
 assert.deepEqual(calls,['8.8.8.8']);assert.equal(sent,3);
 healthMap.clear();calls=[];connectImpl=address=>{calls.push(address.hostname);throw Error('forced relay unavailable');};
 await assert.rejects(forward('target.example.com',443,new Uint8Array([1]),{readyState:1,close(){}},null,{},'11111111-1111-4111-8111-111111111111',req,{},false,null,true));assert.deepEqual(calls,['8.8.8.8']);
 const token='11111111-1111-4111-8111-111111111111';
 assert.equal((await handler.fetch(new Request('https://worker.example.com/relay-status'),{UUID:token},{})).status,401);
 const stats=await handler.fetch(new Request('https://worker.example.com/relay-status',{headers:{Authorization:'Bearer '+token}}),{UUID:token},{});assert.equal(stats.status,200);assert.ok(!JSON.stringify(await stats.json()).includes(token));
 console.log('Worker template: native TCP adapter, forced upstream wiring, ordered failover/cooldown, all-failed closure, no payload replay and protected status passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
