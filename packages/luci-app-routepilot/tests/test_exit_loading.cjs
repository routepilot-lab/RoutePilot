// Exercise the real load chain against the synchronous exception seen on target LuCI.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const menu=JSON.parse(fs.readFileSync(path.join(root,'root/usr/share/luci/menu.d/luci-app-routepilot.json')));
const source=fs.readFileSync(path.join(root,'htdocs/luci-static/resources/view',Object.values(menu)[0].action.path+'.js'),'utf8');
const location={pathname:'/admin/services/routepilot/advanced'};
let hintsCalls=0,probeCalls=0,featuresReady=false,throwHints=false,exitCalls=0;
const network={getHostHints(){hintsCalls++;assert.ok(featuresReady,'features must be ready before network initialization');if(throwHints)throw new TypeError("Cannot read properties of null (reading 'wifi')");return Promise.resolve({host:'hint'});}};
const view=new Function('window','view','uci','fs','ui','network','rpc','L',source)(
 {location},{extend:x=>x},{load:()=>Promise.resolve()},
 {read(){return Promise.resolve(JSON.stringify({product:'test',package:'test-1'}));},exec(file){if(file.endsWith('routepilot-exits')){exitCalls++;return Promise.resolve({code:0,stdout:JSON.stringify({available:true,networks:[{name:'Example',id:'11111111-1111-4111-8111-111111111111'}]})});}return Promise.resolve({code:0,stdout:'[]'});}},
 {menu:{load:()=>Promise.resolve({})}},network,{declare:()=>()=>{}},
 {probeSystemFeatures(){probeCalls++;featuresReady=true;return Promise.resolve({wifi:true});}}
);
(async()=>{
 for(const leaf of ['routepilot','overview','basic','advanced']){
  location.pathname='/admin/services/'+(leaf==='routepilot'?'routepilot':'routepilot/'+leaf);
  const data=await view.load();assert.equal(data[3].networks.length,1);assert.equal(hintsCalls,0);assert.equal(probeCalls,0);
 }
 assert.equal(exitCalls,4);
 location.pathname='/admin/services/routepilot/devices';
 let data=await view.load();assert.equal(data[1].host,'hint');assert.equal(probeCalls,1);
 throwHints=true;data=await view.load();assert.equal(data[1],null,'optional synchronous host-hint failure must not abort view');
 assert.equal(exitCalls,4,'device page must not query account directory');
 console.log('Real view load: optional hints isolated; synchronous exceptions caught; feature probe awaited');
})().catch(e=>{console.error(e);process.exitCode=1;});
