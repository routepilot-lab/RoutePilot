'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require ui';
'require poll';
'require network';
'require rpc';
'require dom';
'require routepilot.feedback_e3960a59b39e as feedback';
var commitConfig = rpc.declare({object:'uci',method:'commit',params:['config'],expect:{'':{}}});

function refreshMenuIndex(){return ui.menu.load().then(function(tree){var node=tree;['admin','services','routepilot'].forEach(function(k){node=node&&node.children&&node.children[k];});if(node&&node.children&&(!node.children.cloudflare||['basic','devices','dns','advanced','workers'].some(function(k){return node.children[k]&&node.children[k].title;})))ui.menu.flushCache();}).catch(function(){});}
function readExitDirectory() { return fs.exec('/usr/libexec/routepilot-exits',[]).then(function(r){if(r.code)throw Error('directory');var v=JSON.parse(r.stdout);if(!v.available||!Array.isArray(v.networks))throw Error('directory');v.read_at=Date.now();v.last_success_at=v.read_at;return v;}).catch(function(){return {available:false,networks:[],read_at:Date.now()};}); }
function normalizedID(value){return String(value||'').toLowerCase();}
function configuredExit(){var value=uci.get('routepilot','main','exit');return value==null?'seoul':value;}
function savedExitID(key){return ['default','seoul','usa'].indexOf(key)>=0?normalizedID(uci.get('routepilot','main','vnet_'+key)):normalizedID(key);}
function directoryLabel(key,catalog){if(key==null)key=configuredExit();var id=savedExitID(key),item=(catalog.networks||[]).filter(function(n){return n.id===id;})[0];return item?item.name+(item.is_default?' · 账户默认网络':''):(['default','seoul','usa'].indexOf(key)>=0?({default:'旧默认',seoul:'旧首尔',usa:'旧美国'}[key])+'（兼容配置）':String(key||'未选择'));}
return view.extend({
 exitOptions: function(current,mapping,catalog) {
  var id=['default','seoul','usa'].indexOf(current)>=0?normalizedID(mapping[current]):normalizedID(current),found=false;
  var networks=catalog.available?catalog.networks:[],names={};networks.forEach(function(n){names[n.name]=(names[n.name]||0)+1;});
  var options=networks.map(function(n){var same=n.id===id;found=found||same;return {value:same&&current?current:n.id,label:n.name+(n.is_default?' · 账户默认网络':'')+(names[n.name]>1?' · '+n.id.slice(0,8):'')};});
  if(!found)options.unshift({value:current||'',label:current?'保留当前选择：'+String(current)+'（'+(catalog.filtered?'不属于本次地区筛选':catalog.available?'未在本次目录中':'目录读取失败，保留原值')+'）':'请选择账户出口（不会自动选择）'});
  return options;
 },
 load: function() { var legacyLeaf=window.location.pathname.split('/').filter(Boolean).pop(),legacyGroup={basic:'basic',devices:'devices',dns:'dns',diagnostics:'dns',advanced:'advanced',workers:'workers'}[legacyLeaf];if(legacyGroup&&typeof window.location.replace==='function')window.location.replace(L.url('admin/services/routepilot/cloudflare')+'#rp-center-'+legacyGroup);var leaf=window.location.pathname.split('/').filter(Boolean).pop(),needsDirectory=['routepilot','overview','basic','advanced','cloudflare'].indexOf(leaf)>=0;return Promise.all([uci.load('routepilot'), ['devices','cloudflare'].indexOf(leaf)>=0?Promise.resolve().then(function(){return typeof L.probeSystemFeatures==='function'?L.probeSystemFeatures():null;}).then(function(){return network.getHostHints();}).catch(function(){return null;}):Promise.resolve(null), fs.exec('/usr/libexec/routepilot',['interfaces']).then(function(r){return r.code?[]:JSON.parse(r.stdout);}).catch(function(){return [];}), needsDirectory?readExitDirectory():Promise.resolve({available:false,networks:[],skipped:true}), refreshMenuIndex(),['workers','cloudflare'].indexOf(leaf)>=0?fs.exec('/usr/libexec/routepilot-backup-list',[]).then(function(r){return r.code?{nodes:[]}:JSON.parse(r.stdout);}).catch(function(){return {nodes:[]};}):Promise.resolve({nodes:[]}),leaf==='cloudflare'?fs.exec('/usr/libexec/routepilot',['warp-info']).then(function(r){return r.code?null:JSON.parse(r.stdout);}).catch(function(){return null;}):Promise.resolve(null),fs.read('/usr/share/routepilot/version.json').then(JSON.parse).catch(function(){return null;})]); },
 render: function(data) {
  var pages=[['cloudflare','Cloudflare 配置中心','主线路、出口地区、设备分流、DNS 与 Workers 备用'],['overview','总览','开关与当前运行状态'],['basic','分流设置','选择出口与接管范围'],['devices','设备管理','只在按设备模式下使用'],['dns','DNS与联网检测','设置解析、检测 DNS 与网页连通性'],['rules','规则与更新','名单、自定义规则与更新反馈'],['advanced','连接向导','首次登录和出口配置'],['workers','Cloudflare备用','独立检测与手动切换'],['backup','备份迁移','导入或导出本插件配置']];
  var leaf=window.location.pathname.split('/').filter(Boolean).pop(),page=leaf==='diagnostics'?'dns':pages.some(function(p){return p[0]===leaf;})?leaf:'overview';
  var pageInfo=pages.filter(function(p){return p[0]===page;})[0],base=L.url('admin/services/routepilot');
  var center=page==='cloudflare',centerDeviceNode=null,centerFields={basic:[],dns:[]},warpState=data[6]||null,exitObservation=null,saveInFlight=null,organizationOption=null,centerComposed=null,centerOpen={},workerStages={},workerBadges={},workerPinned=false,workerStageOpen={},workerFlow={},buildInfo=data[7]||{};
  var workerActions={},workerDisplays={},workerPanels={},workerMessages={},workerActivity=E('div',{class:'rp-worker-activity',role:'status','aria-live':'polite'}),workerProjectRows=(data[5]&&data[5].cloud&&data[5].cloud.projects)||[],workerProjectsAt=Number(data[5]&&data[5].cloud&&data[5].cloud.projects_read_at||0),cloudDirectoryJob=null,workerInventory=null;
  var formPage=center||['basic','devices','dns','rules','advanced'].indexOf(page)>=0;
  if(!formPage){this.handleSaveApply=null;this.handleSave=null;}
  var m = this.map = new form.Map('routepilot', '', '');
  var s, o, self=this, hints=data[1],catalog=data[3]||{available:false,networks:[]};
  function notify(msg,err) { ui.addNotification(null,E('p',{},msg),err?'error':'info'); }
  function command(action) { return fs.exec('/usr/libexec/routepilot',[action]).then(function(r){ if(r.code)throw new Error(r.stderr || _('操作未完成')); return r.stdout; }); }
  function save(){return (center?saveOrganizationOnly():self.applySettings()).then(function(ok){if(ok===false)throw Error(_('配置未保存，后续操作未执行'));return ok;});}
  var wizardActions={},wizardCards={},wizardBadges={},wizardActive=null,wizardPinned=false,wizardInitialized=false,wizardAdvance=null;
  var wizardStatus=null,wizardTest=null,exitOption=null,liveDNS=null,updateWizard=function(){},wizardSummary=E('p',{role:'status','aria-live':'polite'});
  var committedOrganization=uci.get('routepilot','main','organization')||'';
  function wizardConfig(){return {organization:committedOrganization,exit:configuredExit(),exit_id:savedExitID(configuredExit()),nonce:uci.get('routepilot','main','apply_nonce'),scope:uci.get('routepilot','main','scope'),lans:(uci.get('routepilot','main','lan_interfaces')||uci.get('routepilot','main','lan_interface')||'').length,devices:uci.sections('routepilot','policy').filter(function(p){return p.enabled==='1'&&p.mode!=='direct';}).length};}
  function openWizardStep(id){if(!wizardCards[id])return;Object.keys(wizardCards).forEach(function(key){wizardCards[key].open=key===id;});wizardActive=id;}
  function beginWizardStep(id){wizardPinned=false;wizardActive=id;wizardAdvance=id;wizardActions[id]={state:'busy',started:Date.now(),baseline:id==='verify'?feedback.wizardTestToken(wizardTest):null};updateWizard();}
  function failWizardStep(id){var previous=wizardActions[id];wizardActions[id]={state:'error',started:Date.now(),baseline:previous&&previous.baseline};updateWizard();}

  var directoryStatus=E('p',{role:'status','aria-live':'polite'}),directoryRows=E('tbody'),directoryPending=null,directoryGeneration=0,registeredHere=false,lastDirectoryRows=null;
  function renderDirectory(){
   var age=Date.now()-Number(catalog.read_at),recent=catalog.available&&age>=-5000&&age<=60000;
   directoryStatus.textContent=directoryPending?_('正在读取账户出口，请稍候（客户端查询最长约 8 秒）…'):catalog.available?(!recent?_('上次读取时间已失效，请刷新确认；'): '')+_('已读取 ')+catalog.networks.length+_(' 个账户网络；未切换出口，也未验证连通性。'):!catalog.read_at?_('尚未读取账户目录；可点击下方刷新按钮。'):(registeredHere?_('已注册，目录暂未就绪，请稍后刷新；当前出口与配置未改动。'):_('读取失败，请重试；当前出口与配置未改动。若持续失败，请检查登录环境。'));
   var renderKey=[catalog.read_at,catalog.available,recent,wizardStatus&&wizardStatus.state,wizardStatus&&wizardStatus.runtime_id,feedback.wizardTestToken(wizardTest)].join('|');
   if(renderKey===lastDirectoryRows){updateWizard();return;}lastDirectoryRows=renderKey;
   var rows=(catalog.available?catalog.networks:[]).map(function(n){return E('tr',{},[E('td',{},n.name+(n.is_default?' · 账户默认网络':'')),E('td',{},exitHealth(n.id))]);});
   if(!rows.length)rows.push(E('tr',{},E('td',{colspan:2},catalog.available?_('账户目录中没有可选虚拟网络。'):_('本次未取得出口目录；不代表账户没有其他出口。'))));
   directoryRows.replaceChildren.apply(directoryRows,rows);
   updateWizard();
  }
  function refreshDirectory(force){
   if(force){directoryGeneration++;catalog={available:false,networks:[],last_success_at:catalog.last_success_at};}
   if(directoryPending)return force?directoryPending.then(function(){return refreshDirectory();}):directoryPending;
   directoryStatus.textContent=_('正在读取账户出口，请稍候（客户端查询最长约 8 秒）…');
   var generation=directoryGeneration;
   directoryPending=Promise.resolve().then(readExitDirectory).catch(function(){return {available:false,networks:[],read_at:Date.now()};}).then(function(next){if(generation!==directoryGeneration)return next;next.last_success_at=next.available?next.read_at:catalog.last_success_at;catalog=next;if(center&&regionFilter)updateRegions();return updateExitChoices().then(function(){return next;});}).finally(function(){directoryPending=null;renderDirectory();});
   return directoryPending;
  }
  function updateExitChoices(){
   if((page!=='basic'&&!center)||!exitOption)return Promise.resolve();
   var frame=document.getElementById('cbi-routepilot-main-exit'),field=frame&&frame.querySelector('.cbi-value-field');
   if(!field)return Promise.resolve();
   var current=exitOption.formvalue('main');if(current==null)current=configuredExit();
   exitOption.keylist=[];exitOption.vallist=[];
   self.exitOptions(current,{default:uci.get('routepilot','main','vnet_default'),seoul:uci.get('routepilot','main','vnet_seoul'),usa:uci.get('routepilot','main','vnet_usa')},activeCatalog()).forEach(function(item){exitOption.value(item.value,item.label);});
   var description=field.querySelector('.cbi-value-description');
   return Promise.resolve(exitOption.renderWidget('main',0,current)).then(function(widget){if(description)field.replaceChildren(widget,description);else field.replaceChildren(widget);if(typeof exitOption.triggerValidation==='function')exitOption.triggerValidation('main');});
  }
  function exitHealth(id){
   var action=wizardActions.verify;if(action&&action.state==='error')return _('本次检测未完成，请重试');if(action&&action.state==='busy'&&action.baseline===feedback.wizardTestToken(wizardTest))return _('正在请求检测，等待新结果');
   var result=feedback.wizardProxyVerification(wizardTest,wizardStatus,wizardConfig(),Date.now());
   if(!wizardStatus||wizardStatus.exit!==configuredExit()||id!==savedExitID(wizardStatus.exit))return _('未检测');
   return ({success:_('✓ 当前连接检测通过'),error:_('✕ 当前连接检测失败'),warning:_('! 当前连接访问受限'),busy:_('… 当前连接检测中')})[result]||_('未检测 / 旧结果已过期');
  }
  if(center||page==='advanced'||page==='basic')renderDirectory();
  s=m.section(form.NamedSection,'main','main',pageInfo[1]);
  var mainSection=s;
  function pageOption(tab){var option=s.option.apply(s,Array.prototype.slice.call(arguments,1));option.routepilotPage=tab;if(center)option.retain=true;if(centerFields[tab])centerFields[tab].push(option);return option;}
  // The top-level switch commits only its own power state, never unsaved form edits.
  o=pageOption('advanced',form.ListValue,'warp_protocol',_('主线路连接协议'),_('默认跟随现有客户端设置。选择 MASQUE / WireGuard 后仅管理本路由器客户端，应用时重连；不自动换出口、不改其他设备或缓冲。WireGuard 尚未在本机切换验收。'));
  o.value('auto',_('保持现状 / 跟随当前设置'));o.value('MASQUE','MASQUE');o.value('WireGuard','WireGuard');o.cfgvalue=function(){return uci.get('routepilot','main','warp_protocol')||'auto';};o.write=function(id,value){if(value==='auto'&&uci.get('routepilot',id,'warp_protocol')==null)return;uci.set('routepilot',id,'warp_protocol',value);};o.rmempty=false;
  o=pageOption('basic',form.ListValue,'scope',_('接管范围'));o.value('devices',_('按设备选择'));o.value('lan',_('所选局域网（无需绑定设备）'));o.default='devices';
  o=pageOption('basic',form.MultiValue,'lan_interfaces',_('接管的 LAN 接口（可多选）'),_('勾选设备所在的主网络、访客网络或 VLAN，可同时选择。Wi-Fi 与网线共用网桥时只勾选该网桥。每个接口需要一个独立 IPv4 私网网段；不会创建网络，也不会开放主网络与访客网络之间的互访。标记未启用的网络需先在路由器网络设置中开启，再启用本插件。'));o.rmempty=false;
  var interfaces=data[2]||[],currentLAN=uci.get('routepilot','main','lan_interfaces')||[uci.get('routepilot','main','lan_interface')||'br-lan'];if(typeof currentLAN==='string')currentLAN=currentLAN.split(/\s+/);o.cfgvalue=function(){return uci.get('routepilot','main','lan_interfaces')||currentLAN;};interfaces.forEach(function(i){o.value(i.name,i.name+' · '+i.network+(i.up?'':' · 尚未启用，请先在路由器启用'));});currentLAN.forEach(function(name){if(!interfaces.some(function(i){return i.name===name;}))o.value(name,name+' · 未检测到有效网段，请核对');});o.validate=function(id,v){return v&&v.length&&v.length<=8?true:_('请选择 1–8 个 LAN 接口');};
  o=pageOption('basic',form.ListValue,'lan_mode',_('局域网分流模式'));o.depends('scope','lan');[['bypass_cn',_('国内 IP 直连，其余代理')],['global',_('全部代理')],['gfw',_('仅代理名单内域名')],['whitelist',_('仅直连名单内域名')]].forEach(function(v){o.value(v[0],v[1]);});o.default='bypass_cn';
  o=pageOption('basic',form.Flag,'bypass_clients',_('Cloudflare 客户端连接直连'),_('避免电脑尚未关闭 Cloudflare One 时叠加隧道；关闭电脑客户端后，普通网页仍按本插件分流。'));o.depends('scope','lan');o.default='1';o.rmempty=false;
  o=pageOption('basic',form.ListValue,'ipv6_mode',_('IPv6 处理方式（所选网络 / 设备默认）'),_('阻断：禁止受管设备 IPv6 转发并过滤本插件 DNS 的 AAAA。允许直连：IPv6 不经过代理隧道，也不遵循本插件代理或域名规则，可能使用宽带真实出口；不创建 IPv6 网络，不覆盖其他防火墙。LAN 模式统一作用于所有勾选接口，忽略设备表覆盖；按设备模式可单独选择。未接管设备不受此选项影响。'));o.value('block',_('阻断 IPv6（默认）'));o.value('direct',_('允许 IPv6 直连（绕过代理规则）'));o.default='block';o.rmempty=false;
  exitOption=o=pageOption('basic',form.ListValue,'exit',_('主线路代理出口'),_('这是 WARP 主线路的出口；启用下方备用线路时暂不使用此出口。按设备分流不会改变主线路出口。列表来自当前账户，已列出不代表可用，读取不会切换。'));
  self.exitOptions(configuredExit(),{default:uci.get('routepilot','main','vnet_default'),seoul:uci.get('routepilot','main','vnet_seoul'),usa:uci.get('routepilot','main','vnet_usa')},catalog).forEach(function(item){o.value(item.value,item.label);});o.cfgvalue=function(){return configuredExit();};o.rmempty=false;o.validate=function(id,value){return value?true:_('请明确选择一个账户出口');};
  o=pageOption('basic',form.Button,'_discover',_('账户出口'));o.inputtitle=_('刷新账户出口（只读）');o.onclick=function(){return refreshDirectory();};
  o=pageOption('basic',form.DummyValue,'_exit_directory',_('目录读取与检测状态'));
  o.renderWidget=function(){return E('div',{},[directoryStatus,E('details',{},[E('summary',{},_('查看账户出口列表')),E('table',{class:'table'},[E('thead',{},E('tr',{},[E('th',{},_('账户可选网络')),E('th',{},_('最近连通检测（仅所测网站）'))])),directoryRows])])]);};
  o=pageOption('basic',form.DummyValue,'_device_mode',_('按设备的分流模式'));o.depends('scope','devices');o.cfgvalue=function(){return (center?_('到本页“设备分流”分组，'):_('到顶部“设备管理”，'))+_('为每台设备分别选择分流模式：国内 IP 直连、全部代理、代理名单、直连名单或保持原样。不接管未启用的设备；局域网模式不覆盖设备表。');};
  o=pageOption('basic',form.DummyValue,'_info',_('使用说明')); o.rawhtml=false; o.cfgvalue=function(){return _('国内直连流量使用本地宽带 IP；只有代理流量使用所选出口。关闭后撤回本插件的接管规则；其他软件按其自身配置运行。');};
  o=pageOption('dns',form.Value,'dns_domestic',_('国内 DNS'),_('中国域名与自定义直连域名使用本地宽带解析。')); o.datatype='ip4addr'; o.default='223.5.5.5';
  o=pageOption('dns',form.Value,'dns_foreign',_('代理 DNS'),_('主线路的其他普通 DNS 经 WARP 隧道发送。应用自带的 DoH/DoT 不能按普通 DNS 域名规则分类。')); o.datatype='ip4addr'; o.default='1.1.1.1';
  o=pageOption('dns',form.ListValue,'dns_transport',_('上游 DNS 传输')); o.value('tcp','TCP');o.value('udp','UDP');o.default='tcp';
  o=pageOption('dns',form.Flag,'dns_cache',_('启用独立 DNS 缓存'));o.default='1';o.rmempty=false;
  o=pageOption('dns',form.DummyValue,'_ipv6_info',_('IPv6 与 AAAA'));o.cfgvalue=function(){return center?_('AAAA 过滤由本页接管范围 / 设备分流的 IPv6 处理方式决定。本插件只代理 IPv4；允许 IPv6 直连会绕过代理规则。'):_('AAAA 是否过滤由“分流设置 / 设备管理”的 IPv6 处理方式决定；本插件仅代理 IPv4，允许 IPv6 直连会绕过所有代理规则。');};
  [['custom_direct_domains',_('始终直连域名'),'hostname'],['custom_proxy_domains',_('始终代理域名'),'hostname'],['custom_direct_ips',_('始终直连 IPv4/CIDR'),'or(ip4addr,cidr4)'],['custom_proxy_ips',_('始终代理 IPv4/CIDR'),'or(ip4addr,cidr4)']].forEach(function(v){o=pageOption('rules',form.DynamicList,v[0],v[1]);o.datatype=v[2];});
  [['china_url',_('中国 IP 规则')],['china_domains_url',_('中国域名规则')],['gfw_url',_('代理域名名单')],['whitelist_url',_('直连域名名单')]].forEach(function(v){o=pageOption('rules',form.Value,v[0],v[1],_('可信 HTTPS 名单；支持普通域名、domain:、full:。regexp 条目跳过并记录，不执行脚本或编码订阅。'));o.validate=function(id,v){return !v || /^https:\/\/[^\s]+$/.test(v) ? true:_('必须使用 HTTPS');};});
  o=pageOption('rules',form.Value,'update_hours',_('自动更新间隔（小时）'));o.datatype='range(1,720)';o.default='168';
  o=pageOption('rules',form.Button,'_update',_('手动更新'));o.inputtitle=_('立即更新规则');o.onclick=function(){return self.requestRulesUpdate();};
  o=pageOption('advanced',form.Value,'organization',_('组织名称（只在首次登录时填写）'),_('这是你在 Cloudflare Zero Trust 创建的团队名称，例如 myteam；对应 myteam.cloudflareaccess.com。不是个人网站域名，也不是邮箱。不知道名称时，在 Cloudflare One 客户端的账户页面或 Zero Trust 设置中查看。'));o.datatype='hostname';organizationOption=o;
  o=pageOption('advanced',form.Button,'_prepare',_('启动独立登录环境'));o.inputtitle=_('准备登录环境（不接管设备）');o.onclick=function(){if(uci.get('routepilot','main','enabled')==='1'){notify(_('请先到“总览”关闭总开关；已有连接无需重新登录。'),true);return;}beginWizardStep('prepare');return save().then(function(result){if(!result||!result.nonce)throw Error(_('缺少本次保存确认，未启动登录环境'));wizardActions.prepare.nonce=result.nonce;return command('prepare');}).then(function(msg){uci.set('routepilot','main','preparing','1');notify(msg);}).catch(function(e){failWizardStep('prepare');notify(e.message,true);});};
  o=pageOption('advanced',form.Button,'_account_check',_('已有账户'));o.inputtitle=_('重新检查账户（只读）');o.onclick=function(){beginWizardStep('auth');return refreshDirectory().finally(function(){delete wizardActions.auth;updateWizard();});};
  o=pageOption('advanced',form.Button,'_login',_('验证账户'));o.inputtitle=_('邮箱登录');o.onclick=function(){
   if(uci.get('routepilot','main','enabled')==='1'){notify(_('请先到“总览”关闭总开关；已有连接无需重新登录。'),true);return;}
   function alreadyAccessible(){return catalog.available&&Date.now()-catalog.read_at<=60000;}
   function skipLogin(){openWizardStep('auth');notify(_('账户目录已可访问，无需重复邮箱注册。'));}
   if(alreadyAccessible()){skipLogin();return;}
   return save().then(function(){return fs.read('/var/run/routepilot/status.json').then(JSON.parse);}).then(function(st){
    if(!feedback.fresh(st,Date.now())||st.state!=='preparing')throw Error(_('登录环境尚未确认就绪，请先完成第 2 步并等待状态更新。'));
    if(alreadyAccessible()){skipLogin();return;}
    directoryGeneration++;beginWizardStep('auth');
    return command('login').then(function(url){
     var token=E('input',{type:'password',class:'cbi-input-text',autocomplete:'off',placeholder:'com.cloudflare.warp://…','aria-label':_('登录成功页的完整登录链接')}),registrationPending=false;
     var closeButton=E('button',{class:'btn',click:function(){if(registrationPending)return;delete wizardActions.auth;ui.hideModal();updateWizard();}},_('关闭'));
     var registerButton=E('button',{class:'btn',click:function(){
      if(registrationPending)return;
      beginWizardStep('auth');registrationPending=true;registerButton.disabled=true;closeButton.disabled=true;
      return fs.write('/var/run/routepilot/auth-input',token.value,384).then(function(){token.value='';return command('register');}).then(function(msg){
       registeredHere=true;delete wizardActions.auth;ui.hideModal();notify(msg);return refreshDirectory(true);
      }).catch(function(e){failWizardStep('auth');notify(e.message,true);}).finally(function(){registrationPending=false;registerButton.disabled=false;closeButton.disabled=false;});
     }},_('注册此路由器'));
     ui.showModal(_('登录独立路由器客户端'),[E('p',{},_('打开下方地址，用组织允许的邮箱完成验证。浏览器提示打开本机 Cloudflare 应用时取消；复制成功页的 com.cloudflare.warp:// 登录链接，粘贴到此处。')),E('a',{href:url.trim(),target:'_blank',rel:'noopener'},url.trim()),token,registerButton,closeButton]);
    }).catch(function(e){failWizardStep('auth');notify(e.message,true);});
   }).catch(function(e){notify(_('准备或状态读取未完成：')+e.message,true);});
  };
  s=m.section(form.GridSection,'policy',_('按设备设置（仅按设备模式生效）'),_('局域网模式无需修改此表，原设置会保留。按设备模式可逐台选择分流模式，仅启用需要接管的设备；所有设备共用“分流设置”中选择的代理出口。域名名单通过普通 DNS 的解析结果分类，共用 CDN IP 可能影响同 IP 的其他域名；纯加密 DNS 应用优先使用国内 IP 直连模式。'));
  s.addremove=true;s.anonymous=true;s.nodescriptions=true;
  o=s.option(form.Flag,'enabled',_('启用'));o.default='0';o.rmempty=false;
  o=s.option(form.Value,'name',_('设备名称'));
  var devices={};o=s.option(form.ListValue,'_device',_('在线设备'));o.value('',_('手动填写'));
  if(hints)hints.getMACHints().forEach(function(pair){var mac=pair[0],ip=hints.getIPAddrByMACAddr(mac);if(ip){devices[mac]=ip;o.value(mac,(hints.getHostnameByMACAddr(mac)||mac)+' · '+ip);}});
  o.write=function(){};o.cfgvalue=function(){return '';};var ps=s;
  o.onchange=function(ev,id,value){if(!devices[value])return;ps.children.filter(function(f){return f.option==='mac';})[0].getUIElement(id).setValue(value);ps.children.filter(function(f){return f.option==='ip';})[0].getUIElement(id).setValue(devices[value]);};
  o=s.option(form.Value,'mac',_('MAC'));o.datatype='macaddr';o.rmempty=false;
  o=s.option(form.Value,'ip',_('固定 IPv4'));o.datatype='ip4addr';o.rmempty=false;
  o=s.option(form.ListValue,'mode',_('分流模式'));
  [['bypass_cn',_('国内 IP 直连，其余代理')],['global',_('全部代理')],['gfw',_('仅代理名单内域名')],['whitelist',_('仅直连名单内域名')],['direct',_('保持原样，不接管')]].forEach(function(v){o.value(v[0],v[1]);});o.default='bypass_cn';
  o=s.option(form.ListValue,'ipv6_mode',_('IPv6 处理方式'),_('仅按设备模式生效。允许直连会绕过代理隧道 和全部代理规则，可能使用宽带真实出口；不创建 IPv6。分流模式为“保持原样”时 IPv6 本就不受管理，此项不生效。'));o.value('inherit',_('跟随默认'));o.value('block',_('阻断 IPv6'));o.value('direct',_('允许 IPv6 直连'));o.default='inherit';o.rmempty=false;['global','bypass_cn','gfw','whitelist'].forEach(function(mode){o.depends('mode',mode);});o.retain=true;
  if(page==='advanced'||center){
   var originalSectionRender=mainSection.render.bind(mainSection);
   mainSection.render=function(){return originalSectionRender.apply(null,arguments).then(function(node){
    var steps=[];
    function para(text){return E('p',{},text);}
    function link(text,url){return E('a',{href:url,target:'_blank',rel:'noopener'},text);}
    function step(id,title,items,fields){
     var box=E('div',{class:'rp-guide-body'},items),badge=E('span',{class:'rp-step-badge'},id==='intro'?_('说明'):_('○ 未执行'));
     (fields||[]).forEach(function(key){var field=node.querySelector('[id="cbi-routepilot-main-'+key+'"]');if(field)box.appendChild(field);});
     var summary=E('summary',{},[badge,E('span',{},title)]),card=E('details',{class:'rp-guide-step','data-step':id},[summary,box]);
     wizardCards[id]=card;wizardBadges[id]=badge;steps.push(card);
     summary.addEventListener('click',function(){wizardPinned=true;wizardActive=card.open?null:id;});
     card.addEventListener('toggle',function(){if(card.open)steps.forEach(function(other){if(other!==card)other.open=false;});});
     return card;
    }
    step('intro',_('开始前：新路由器需要准备什么？'),[
     para(_('下载 ZIP 不会自动安装。完整安装包包含 IPK 插件、WARP 运行环境压缩包、安装脚本和校验文件。将 ZIP 解压后的整个文件夹复制到兼容路由器，在该文件夹内以管理员运行 sh install-router.sh；脚本会校验文件、解压运行环境并安装插件。仅在网页上传 IPK，只安装管理插件，不会自动安装配套环境。')),
     para(_('支持条件：目前只验证 GL-MT6000 / ARM64 OpenWrt 24.10，至少 500 MB 可用存储。不是在 Mac 或 Windows 上运行脚本。运行环境已存在时，安装脚本会停止以保护注册信息；更新已有插件只需安装新版 IPK，不要删除运行环境。安装结束默认关闭，之后再完成本向导登录。')),
     para(_('换路由器但继续用同一 Cloudflare 账户：组织名称、现有虚拟网络及 VPS 出口可以沿用，不用重新创建；新路由器必须独立登录。先保持总览里的总开关关闭。')),
     para(_('快捷迁移：在旧路由器“备份迁移”导出配置，到新路由器导入。导入后保持关闭；可以跳过第 1 步填写，仍需完成第 2、3 步登录。备份不包含登录凭据。')),
     E('a',{href:base+'/backup'},_('打开备份迁移 →'))
    ]);
    step('org',_('第 1 步：找到组织名称并保存'),[
     para(_('到 Cloudflare 控制台进入 Zero Trust → Settings（设置），查看 Team name / Team domain（团队名称 / 团队域名）。也可查看已登录的 Cloudflare One 客户端账户页面。')),
     para(_('例如显示 myteam.cloudflareaccess.com，这里只填 myteam；不填 https://，不填 .cloudflareaccess.com 后缀，也不填邮箱、个人域名或 Cloudflare 账户 ID。')),
     link(_('查看官方团队名称说明'), 'https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/'),
     para(_('如果是全新 Cloudflare 账户，需要先创建 Zero Trust 团队并允许你的邮箱注册设备。沿用现有账户则不要再创建。'))
    ],['organization']);
    wizardCards.org.querySelector('.rp-guide-body').appendChild(E('button',{class:'btn',click:function(){beginWizardStep('org');return save().catch(function(e){failWizardStep('org');notify(e.message,true);});}},_('保存组织名称')));
    step('prepare',_('第 2 步：准备路由器登录环境'),[
     para(_('点击下方按钮。它只启动独立登录环境，不接管局域网，不需要先打开总开关。')),
     para(_('成功标志：本页上方实际状态显示“登录环境已就绪”。首次启动可能稍慢；未就绪先不要点击邮箱登录。若提示缺少运行环境，请先按安装包说明安装配套运行环境。'))
    ],['_prepare']);
    step('auth',_('第 3 步：邮箱验证并注册这台路由器'),[
     para(_('点击“邮箱登录”，在弹窗打开团队登录地址。使用组织允许的邮箱收验证码，或按组织要求完成登录。')),
     para(_('若浏览器询问是否打开电脑上的 Cloudflare 应用，选择取消。你要注册的是新路由器，不是这台电脑。')),
     para(_('复制登录成功页面里的完整 com.cloudflare.warp://… 登录链接，粘贴回插件弹窗，点击“注册此路由器”。这是临时登录凭据，不要分享或发到 GitHub。')),
     para(_('成功标志：提示路由器已注册。若邮箱无权限，在 Cloudflare 的设备注册权限中允许该邮箱；链接失效则重新登录获取，不要反复粘贴旧链接。'))
    ],['_login','_account_check']);
    var wizardNext=E('div',{class:'cbi-section'},[E('h3',{},_('连接准备已完成')),para(_('账户目录已可访问。请在本页“出口与接管范围”明确选择并保存；DNS 与网页检查在“DNS 与联网检测”分组。')),E('a',{href:base+'/cloudflare#rp-center-basic',class:'btn cbi-button-action'},_('继续设置分流 →'))]);
    wizardNext.hidden=true;
    var guide=E('div',{class:'rp-guide'},[
     para(_('绿色 ✓ 表示该步已有成功证据；红色 ✕ 表示实际失败；蓝色 … 表示处理中；灰色 ○ 表示未执行或待确认。成功后自动展开下一步，不自动执行登录、注册、保存或启用。手动回看时保留你的展开位置。')),
     wizardSummary
    ].concat(steps,[wizardNext]));
    updateWizard=function(){
     var now=Date.now(),config=wizardConfig();
     
     ['org','prepare'].forEach(function(id){var a=wizardActions[id];if(a&&a.state==='busy'&&now-a.started>45000)wizardActions[id]={state:'error',started:now,baseline:a.baseline};});
     var prep=wizardActions.prepare;if(prep&&prep.state==='busy'&&prep.nonce&&feedback.fresh(wizardStatus,now)&&wizardStatus.state==='error'&&wizardStatus.attempted_nonce===prep.nonce){prep.state='error';}
     if(prep&&prep.state==='busy'&&prep.nonce&&feedback.fresh(wizardStatus,now)&&['preparing','running'].indexOf(wizardStatus.state)>=0&&wizardStatus.applied_nonce===prep.nonce){delete wizardActions.prepare;prep=null;}
     var states=feedback.wizardSteps(config,catalog,wizardStatus,wizardTest,wizardActions,now);
     if(prep&&prep.state==='busy'&&(!prep.nonce||!wizardStatus||wizardStatus.applied_nonce!==prep.nonce)){var ps=states.filter(function(x){return x.id==='prepare';})[0];ps.state='busy';}
     var descriptions={org:committedOrganization?_('组织名称已保存'):_('可沿用已可访问的账户，无需重填'),prepare:_('登录环境已就绪'),auth:_('账户目录可访问；无需重复注册'),dir:_('目录已读取（未验证联网）'),select:_('选择已保存（未验证运行）'),verify:_('当前连接所测网站通过')};
     var names={pending:'○ '+_('待确认'),busy:'… '+_('处理中'),success:'✓ '+_('已完成'),error:'✕ '+_('失败'),warning:'! '+_('访问受限'),stale:'○ '+_('未检测 / 已过期')};
     states.forEach(function(st){var a=wizardActions[st.id];if(st.state==='success'&&a&&a.state==='busy')delete wizardActions[st.id];var pendingText=st.reason==='access_previous'?_('○ 账户检查结果较旧，可重新检查'):st.reason==='directory_old'?_('○ 上次已读取，待刷新'):st.id==='select'&&st.reason==='saved'?_('○ 已保存，目录待确认'):names[st.state];wizardBadges[st.id].textContent=st.state==='success'?'✓ '+descriptions[st.id]:st.state==='pending'?pendingText:names[st.state];wizardCards[st.id].setAttribute('data-state',st.state);});
     if(!wizardInitialized){var first=states.filter(function(st){return st.state!=='success';})[0];if(first)openWizardStep(first.id);wizardNext.hidden=!states.every(function(st){return st.state==='success';});wizardInitialized=true;}
     var current=states.filter(function(st){return st.id===wizardActive;})[0];
     if(!wizardPinned&&current&&wizardAdvance===current.id&&current.state==='success'&&current.id!=='verify'){var index=states.indexOf(current),next=states.slice(index+1).filter(function(st){return st.state!=='success';})[0];if(next)openWizardStep(next.id);else{Object.keys(wizardCards).forEach(function(k){wizardCards[k].open=false;});wizardActive=null;}wizardAdvance=null;}
     wizardNext.hidden=!states.every(function(st){return st.state==='success';});
     wizardSummary.textContent=_('已完成 ')+states.filter(function(st){return st.state==='success';}).length+'/3 · '+(registeredHere&&!catalog.available?_('已注册，账户目录暂未就绪，请稍后重新检查。'):_('已有账户可沿用；出口与范围在“分流设置”统一选择。'))+(catalog.last_success_at?_(' · 上次账户检查：')+new Date(catalog.last_success_at).toLocaleString():'');
    };
    updateWizard();
    if(center)node.appendChild(guide);else{var protocol=node.querySelector('[id="cbi-routepilot-main-warp_protocol"]');node.replaceChildren(guide);if(protocol)node.appendChild(protocol);}return node;
   });};
  }
  mainSection.children=mainSection.children.filter(function(o){return center?['advanced','basic','dns'].indexOf(o.routepilotPage)>=0:o.routepilotPage===page;});
  if(center){var renderDevices=ps.render.bind(ps);ps.render=function(){return renderDevices.apply(null,arguments).then(function(node){centerDeviceNode=node;return node;});};}
  m.children=center?[mainSection,ps]:page==='devices'?[s]:formPage?[mainSection]:[];
  var status=E('p',{role:'status','aria-live':'polite'},_('正在读取实际运行状态…'));
  var rulesProgress=E('p',{},_('正在读取规则状态…')),rulesTime=E('p'),rulesCounts=E('div'),lastRule=null;
  var testsInfo=E('p',{},_('路由器侧 HTTPS 检测：代理网站在隧道环境测试，国内网站在主机环境测试；不代表受管设备 DNS 或 LAN 端到端验收。'));
  var testCells={},testNames={google:'Google',youtube:'YouTube',github:'GitHub',taobao:'淘宝',baidu:'百度'};
  var testRows=Object.keys(testNames).map(function(k){var result=E('td',{},_('未检测')),delay=E('td',{},'—');testCells[k]={result:result,delay:delay};return E('tr',{},[E('td',{},testNames[k]),E('td',{},k==='taobao'||k==='baidu'?_('国内直连'):_('当前代理出口')),result,delay]);});
  var testButton=E('button',{class:'btn cbi-button-action',click:function(){if((page==='dns'||center)&&(!feedback.fresh(wizardStatus,Date.now())||wizardStatus.state!=='running')){notify(_('请先在总览手动开启，并等待主线路已连接后再检测。'),true);return;}testButton.disabled=true;testsInfo.textContent=_('正在检测，最长约 10 秒…');Object.keys(testCells).forEach(function(k){testCells[k].result.textContent=_('检测中…');testCells[k].delay.textContent='—';});command('test').catch(function(e){testsInfo.textContent=e.message;testButton.disabled=false;});}},_('一键检测全部'));
  var switchEnabled=uci.get('routepilot','main','enabled')==='1',switchPending=null;
  var switchText=E('p',{},_('新安装默认关闭。开关立即生效，无需点击页面底部保存；不会提交尚未保存的其他设置。'));
  var switchFeedback=E('div',{hidden:true},switchText);
  var powerButton=E('button',{class:'btn cbi-button-action',click:function(){switchFeedback.hidden=false;var action=switchEnabled?'disable':'enable';powerButton.disabled=true;switchText.textContent=_('正在切换，等待后台确认…');command(action).then(function(msg){var result=JSON.parse(msg);switchEnabled=result.enabled;uci.set('routepilot','main','enabled',switchEnabled?'1':'0');uci.set('routepilot','main','preparing','0');switchPending={nonce:result.nonce,started:Date.now()};powerButton.textContent=switchEnabled?_('关闭 RoutePilot'):_('开启 RoutePilot');}).catch(function(e){switchText.textContent=e.message;powerButton.disabled=false;});}},switchEnabled?_('关闭 RoutePilot'):_('开启 RoutePilot'));
  var statusCard=E('div',{class:'cbi-section',style:'border-left:4px solid #2254d1'},[E('h3',{},_('实际运行状态')),status]);
  var backupNode=null,backupTest=null,backupBusy=false,backupRequested=0,backupSwitch=null;
  var backupInfo=E('p',{role:'status'},_('正在读取备用状态…')),backupResult=E('div'),backupProgress=E('p',{class:'rp-help'});
  var backupSource=E('select',{'aria-label':_('备用节点来源')},[E('option',{value:'current'},_('保留已配置备用，只调整入口')),E('option',{value:'saved'},_('从原有节点读取（不修改原配置）')),E('option',{value:'uri'},_('粘贴 VLESS＋WS＋TLS 链接'))]);
  var backupSaved=E('select',{'aria-label':_('已有备用节点')},[E('option',{value:''},_('请选择节点，不会自动选择'))].concat(((data[5]&&data[5].nodes)||[]).map(function(n){return E('option',{value:n.id},n.name+' · '+n.address+':'+n.port);}))); 
  var backupURI=E('input',{type:'password',autocomplete:'off',placeholder:'vless://…','aria-label':_('私人备用节点链接')});
  var backupEntry=E('select',{'aria-label':_('备用入口方式')},[E('option',{value:'saved'},_('保留原有入口地址与端口')),E('option',{value:'domain'},_('直接连接节点域名 · 443')),E('option',{value:'ip'},_('指定优选 IPv4（保持域名证书验证）'))]);
  var backupIP=E('input',{type:'text',placeholder:_('公网 IPv4 地址'),'aria-label':_('优选入口 IPv4')});
  var backupURIBox=E('div',{hidden:true},[E('p',{class:'rp-help'},_('链接只保存在路由器私有文件，不进入普通配置导出。')),backupURI]);
  var backupSavedBox=E('div',{hidden:true},backupSaved),backupIPBox=E('div',{hidden:true},backupIP);
  backupSource.addEventListener('change',function(){backupURIBox.hidden=backupSource.value!=='uri';backupSavedBox.hidden=backupSource.value!=='saved';});
  backupEntry.addEventListener('change',function(){backupIPBox.hidden=backupEntry.value!=='ip';});
  var backupImport=E('button',{class:'btn',click:function(){
   workerActionStage('use');startWorkerOperation('use',_('保存备用节点'),'backup',null,backupTest);backupBusy=true;updateBackup(backupNode,backupTest,wizardStatus);var input={source:backupSource.value,entry:backupEntry.value};if(input.source==='uri')input.uri=backupURI.value;else if(input.source==='saved')input.id=backupSaved.value;if(input.entry==='ip')input.ip=backupIP.value;
   return fs.write('/var/run/routepilot/backup-input',JSON.stringify(input),384).then(function(){backupURI.value='';return command('backup-import');}).then(function(){backupInfo.textContent=_('备用节点已保存；尚未切换，下一步请独立检测。');backupTest=null;acceptWorkerOperation('use',{message:_('✓ 节点已保存，尚未启用。可在本组顶部“当前保存的备用节点”查看。')},false);return refreshWorkerMetadata();}).catch(function(e){failWorkerOperation('use',e.message);notify(e.message,true);}).finally(function(){backupBusy=false;updateWorkerProgress();});
  }},_('保存备用节点（不切换）'));
  var backupProbe=E('button',{class:'btn',click:function(){workerActionStage('use');startWorkerOperation('use',_('独立检测与测速'),'backup',null,backupTest);backupBusy=true;backupRequested=Date.now();updateBackup(backupNode,backupTest,wizardStatus);return command('backup-test').then(function(raw){acceptWorkerOperation('use',JSON.parse(raw),true);}).catch(function(e){failWorkerOperation('use',e.message);notify(e.message,true);backupRequested=0;}).finally(function(){backupBusy=false;updateWorkerProgress();});}},_('独立检测与测速（约 1 MiB）'));
  function switchBackup(action){startWorkerOperation('use',action==='backup-enable'?_('手动启用备用'):_('切回主线路'),'switch',null,wizardStatus);backupBusy=true;updateBackup(backupNode,backupTest,wizardStatus);return command(action).then(function(raw){var r=JSON.parse(raw);uci.set('routepilot','main','backend',r.backend);uci.set('routepilot','main','apply_nonce',r.nonce);backupSwitch={nonce:r.nonce,backend:r.backend,started:Date.now()};backupProgress.textContent=_('已提交手动切换，等待实际状态确认…');acceptWorkerOperation('use',{message:backupProgress.textContent},false);workerActions.use.waitingSwitch=true;}).catch(function(e){failWorkerOperation('use',e.message);notify(e.message,true);}).finally(function(){backupBusy=false;updateWorkerProgress();});}
  var backupEnable=E('button',{class:'btn cbi-button-action',click:function(){return switchBackup('backup-enable');}},_('手动启用备用'));
  var backupDisable=E('button',{class:'btn',click:function(){return switchBackup('backup-disable');}},_('切回主线路'));
  var workerBackupCard=E('section',{class:'cbi-section rp-backup-card'},[E('h3',{},_('4. 备用节点与独立检测 / 手动使用')),E('p',{},_('保留原主线路，备用不会自动接管。不需要自有 VPS；优选 IP 只改变连接入口，最终出口可能变化。TLS 证书始终验证。')),E('div',{class:'rp-route-explainer'},[E('p',{},_('原主线路：路由器 → Cloudflare WARP → 账户所选出口 → 网站')),E('p',{},_('新备用：路由器 → Cloudflare 入口 → 自己的 Workers → 网站（部分目标使用公共转发）'))]),backupInfo,workerPanel('use'),
   E('details',{class:'rp-guide-step',open:true},[E('summary',{},_('备用节点设置（手动导入 / 调整入口）')),E('div',{class:'rp-guide-body'},[backupSource,backupSavedBox,backupURIBox,E('p',{class:'rp-help'},_('优选只改变连接入口，不决定最终出口或国家。')),backupEntry,backupIPBox,E('p',{},backupImport)])]),
   E('p',{class:'rp-help'},_('备用仅代理 TCP；需代理的 UDP 流量会阻断，不会偷偷走宽带。国内直连及已有 IPv6 选择继续按原规则。备用的代理 DNS 经该线路使用 dns.google 加密解析，主线路 DNS 配置不改。')),
   E('div',{class:'rp-backup-actions'},[backupProbe,backupEnable,backupDisable]),backupProgress,backupResult,
   E('p',{class:'rp-help'},_('独立检测不接管设备，约使用 1 MiB 流量，结果在本次开机 5 分钟内有效。重启后需重新检测再启用备用。下载测速仅供参考，站点限流或下载失败不会单独判定整条线路不可用。备用节点凭据独立保存，不随普通配置备份导出；换路由器后需重新导入。'))]);
  function updateBackup(node,test,st){
   var initialNode=(data[5]&&data[5].node)||null;node=node||initialNode;if(node&&initialNode&&node.fingerprint===initialNode.fingerprint)node=Object.assign({},initialNode,node);backupNode=node;backupTest=test;var active=st&&st.backend==='worker'&&feedback.fresh(st,Date.now())&&st.state==='running',chosen=uci.get('routepilot','main','backend')==='worker';
   var proof=test&&test.usable===true&&test.state==='done'&&node&&test.fingerprint===node.fingerprint&&Date.now()/1000-test.finished_at>=0&&Date.now()/1000-test.finished_at<=300&&Array.isArray(test.results)&&test.results.length===5;
   var newJob=test&&Number(test.started_at)*1000>=backupRequested-1000,remoteTest=test&&['queued','running'].indexOf(test.state)>=0&&Date.now()/1000-Number(test.started_at)<100,busyTest=remoteTest||backupRequested&&(Date.now()-backupRequested<100000)&&(!newJob||(test.state==='running'||test.state==='queued'));
   if(backupRequested&&newJob&&test.state!=='running'&&test.state!=='queued')backupRequested=0;
   if(backupSwitch){if(st&&feedback.fresh(st,Date.now())&&st.applied_nonce===backupSwitch.nonce&&st.state==='running'&&st.backend===backupSwitch.backend){backupProgress.textContent=_('手动切换已生效。');acceptWorkerOperation('use',{message:backupProgress.textContent},false);workerActions.use.waitingSwitch=false;backupSwitch=null;}else if(st&&st.state==='error'&&st.attempted_nonce===backupSwitch.nonce){backupProgress.textContent=_('切换失败：')+st.message;failWorkerOperation('use',backupProgress.textContent);backupSwitch=null;}else if(Date.now()-backupSwitch.started>90000){backupProgress.textContent=_('尚未收到切换确认，请查看总览；不会把已提交当作已成功。');failWorkerOperation('use',backupProgress.textContent,'unknown');backupSwitch=null;}}
   backupInfo.textContent=(active?_('当前使用备用线路。'):chosen?_('已选择备用，实际运行状态尚未确认。'):_('当前使用主线路，备用未接管。'))+(node&&node.configured?_(' 已保存：')+node.name+' · '+node.address+':'+node.port+' · '+_('验证域名：')+node.sni:_(' 尚未配置备用节点。'));
   backupImport.disabled=!!(backupBusy||workerOperationBusy('use')||backupSwitch||chosen);backupProbe.disabled=!!(backupBusy||workerOperationBusy('use')||backupSwitch||busyTest||!node||!node.configured);backupEnable.disabled=!!(backupBusy||workerOperationBusy('use')||backupSwitch||busyTest||active||!proof||!st||!feedback.fresh(st,Date.now())||(st.state!=='running'&&!(st.state==='error'&&st.fallback==='direct')));backupDisable.disabled=!!(backupBusy||backupSwitch||!chosen);
   workerFlow.tested=!!proof;workerFlow.testing=!!busyTest;backupProbe.setAttribute('class',!proof?'btn cbi-button-action':'btn');backupEnable.setAttribute('class',proof?'btn cbi-button-action':'btn');
   backupResult.replaceChildren();if(busyTest){backupResult.appendChild(E('p',{},_('正在独立检测，最长约 90 秒；主线路未切换…')));}
   if(!test)return;
   var expired=!proof;backupResult.appendChild(E('p',{class:'rp-help'},_('备用检测时间：')+when(test.finished_at)+(busyTest?_(' · 检测进行中，已完成 ')+(test.results||[]).length+'/5':expired?_(' · 未通过、已过期或节点已改变，请重新检测'):(test.results||[]).some(function(r){return r.state!=='ok';})?_(' · 基础连通可用，但部分项目未通过，请查看具体结果'):_(' · 本次检测全部通过，可手动启用'))+(test.entry_ip?_(' · 本次入口 IP：')+test.entry_ip:'')+(test.exit_ip?_(' · 本次观测出口：')+test.exit_ip+_('（可能随连接变化）'):'')));
   var names={trace:_('出口观测'),google:'Google',github:'GitHub',dns:_('备用加密 DNS'),download:_('1 MiB 下载')};(test.results||[]).forEach(function(r){backupResult.appendChild(E('p',{class:'rp-help'},names[r.id]+'：'+(r.state==='ok'?'✓ '+_('通过'):r.state==='restricted'?'! '+_('站点返回 HTTP ')+r.http+' · '+_('访问受限 / 限流'):'✕ '+_('未通过'))+(r.message?' · '+r.message:'')+(r.attempt_count>1?' · '+_('尝试次数：')+r.attempt_count:'')+(r.ms!=null?' · '+r.ms+' ms':'')+(r.id==='download'&&r.state==='ok'&&r.ms>0?' · '+(r.bytes*8/r.ms/1000).toFixed(2)+' Mbps（'+_('短测，非带宽上限')+'）':'')));});
  }
  var relayMeta=(data[5]&&data[5].relays)||{},savedRelayRows=relayMeta.candidates||[{address:'proxyip.cmliussss.net:443',source:'cmliu 上游文档示例；未作维护方背书',source_url:'https://github.com/cmliu/edgetunnel',enabled:true}],relaySavedHash=relayMeta.order_hash||null;
  var relayModels=[],relayDirty=false,relayBusy=false,relayTest=null,relayObserved=null;
  var relayInfo=E('p',{role:'status','aria-live':'polite'},_('候选配置与检测结果正在读取…')),relayRows=E('div'),relayRuntime=E('div');
  function markRelayDirty(){relayDirty=true;relayInfo.textContent=_('有尚未保存的候选修改；保存后才能逐项检测或应用。');refreshRelayButtons();}
  function relayModel(row){
   var m={address:E('input',{type:'text',value:row.address||'',placeholder:'proxy.example.com:443','aria-label':_('PROXYIP 地址')}),source:E('input',{type:'text',value:row.source||'用户提供','aria-label':_('PROXYIP 来源说明')}),link:E('input',{type:'url',value:row.source_url||'',placeholder:'https://…','aria-label':_('PROXYIP 公开来源链接')}),enabled:E('input',{type:'checkbox','aria-label':_('启用此候选参与主备')})};
   m.enabled.checked=row.enabled!==false;
   [m.address,m.source,m.link].forEach(function(input){input.addEventListener('input',markRelayDirty);});m.enabled.addEventListener('change',function(){markRelayDirty();renderRelayRows();});
   return m;
  }
  function relayValues(){return relayModels.map(function(m){return {address:String(m.address.value||'').trim(),source:String(m.source.value||'').trim(),source_url:String(m.link.value||'').trim(),enabled:!!m.enabled.checked};});}
  function relayRowProof(address){return relayTest&&Array.isArray(relayTest.results)?relayTest.results.filter(function(r){return r.address===address.toLowerCase();})[0]:null;}
  function relayCurrent(row){var node=backupNode||(data[5]&&data[5].node);return row&&row.profile==='cf-relay-v1'&&node&&row.fingerprint===node.relay_fingerprint&&Date.now()/1000-Number(row.finished_at)>=-5&&Date.now()/1000-Number(row.finished_at)<=300;}
  function relayTaskRunning(){return relayTest&&['queued','running'].indexOf(relayTest.state)>=0&&Date.now()/1000-Number(relayTest.started_at)<260;}
  function refreshRelayButtons(){
   var running=relayBusy||workerOperationBusy('relay')||relayTaskRunning(),chosen=uci.get('routepilot','main','backend')==='worker';
   relaySave.disabled=!!(running||chosen);relayAdd.disabled=!!(running||relayModels.length>=6);relayProbe.disabled=!!(running||relayDirty||!backupNode);relayStatus.disabled=!!running;
   var enabled=relayValues().filter(function(r){return r.enabled;});
   relayApply.disabled=!!(running||relayDirty||chosen||!relayTest||relayTest.state!=='done'||!enabled.length||enabled.some(function(r){var proof=relayRowProof(r.address);return !relayCurrent(proof)||proof.state!=='ok'||proof.forced!==true;}));
   var primary=relayDirty?relaySave:relayApply.disabled?relayProbe:relayApply;[relaySave,relayProbe,relayApply].forEach(function(button){button.setAttribute('class',button===primary?'btn cbi-button-action':'btn');});
  }
  function renderRelayRows(){
   relayRows.replaceChildren();var enabledRank=0;
   relayModels.forEach(function(m,index){
    var rank=m.enabled.checked?++enabledRank:0,proof=relayRowProof(String(m.address.value||'').trim()),fresh=relayCurrent(proof),info=E('p',{class:'rp-help'});
    info.textContent=!proof?_('尚未强制检测此候选'):!fresh?_('历史检测已过期或节点改变，请重新检测'):proof.state==='ok'?_('✓ 强制转发两个 Cloudflare 目标通过'):_('✕ 未通过，不会用直连或其他候选掩盖');
    if(proof){info.textContent+=' · '+_('检测时间：')+when(proof.finished_at);(proof.checks||[]).forEach(function(check,n){info.textContent+=' · '+(n===0?'Cloudflare 官网':'Cloudflare 测速服务')+': HTTP '+check.http+' / '+check.ms+' ms'+(check.curl_code?' / curl '+check.curl_code:'');});if(proof.download)info.textContent+=' · '+(proof.download.ok?_('64 KiB 下载完整'):proof.download.http===429?_('测速站点限流'):_('下载未通过'));}
    function move(delta){var next=index+delta;if(next<0||next>=relayModels.length)return;relayModels.splice(index,1);relayModels.splice(next,0,m);markRelayDirty();renderRelayRows();}
    var up=E('button',{class:'btn',disabled:index===0,click:function(){move(-1);}},_('上移')),down=E('button',{class:'btn',disabled:index===relayModels.length-1,click:function(){move(1);}},_('下移'));
    var remove=E('button',{class:'btn',disabled:relayModels.length===1,click:function(){relayModels.splice(index,1);markRelayDirty();renderRelayRows();}},_('移除'));
    up.disabled=index===0;down.disabled=index===relayModels.length-1;remove.disabled=relayModels.length===1;
    var sourceLink=String(m.link.value||'').trim(),sourceNote=E('p',{class:'rp-help'},_('来源为填写者声明，检测通过不代表维护方背书或长期可靠。'));
    if(/^https:\/\//i.test(sourceLink))sourceNote.appendChild(E('a',{href:sourceLink,target:'_blank',rel:'noopener noreferrer'},_(' 查看公开来源 ↗')));
    relayRows.appendChild(E('section',{class:'rp-relay-row'},[E('h4',{},rank===1?_('主用'):rank>1?_('备用 ')+(rank-1):_('未启用')),
     E('label',{class:'rp-inline-check'},[m.enabled,_('启用，按此顺序参与主备')]),
     E('div',{class:'rp-cloud-grid'},[cloudField(_('转发主机:端口'),m.address),cloudField(_('来源说明'),m.source),cloudField(_('公开来源链接（可选）'),m.link,_('只填写公开资料链接，不填私人订阅、账户或口令。'))]),sourceNote,info,E('div',{class:'rp-backup-actions'},[up,down,remove]) ]));
   });refreshRelayButtons();
  }
  function saveRelayRows(){var rows=relayValues();return fs.write('/var/run/routepilot/relay-input',JSON.stringify({candidates:rows}),384).then(function(){return command('relay-save');}).then(function(raw){var result=JSON.parse(raw);savedRelayRows=result.candidates;relaySavedHash=result.order_hash;relayDirty=false;cloudRelay.value=savedRelayRows.filter(function(r){return r.enabled;}).map(function(r){return r.address;}).join(',');relayInfo.textContent=result.message;return result;});}
  function relayAction(action){workerActionStage('relay');startWorkerOperation('relay',({save:_('保存候选与顺序'),test:_('逐项强制检测 PROXYIP'),apply:_('应用已通过的主备顺序'),status:_('读取实例切换记录')})[action],'relay',null,relayTest);relayBusy=true;refreshRelayButtons();return (action==='save'?saveRelayRows():command('relay-'+action)).then(function(raw){var r=typeof raw==='string'?JSON.parse(raw):raw;acceptWorkerOperation('relay',r,action==='test');if(action==='apply')return refreshWorkerMetadata();}).catch(function(e){failWorkerOperation('relay',e.message);notify(e.message,true);}).finally(function(){relayBusy=false;refreshRelayButtons();updateWorkerProgress();});}
  var relayAdd=E('button',{class:'btn',click:function(){relayModels.push(relayModel({enabled:true}));markRelayDirty();renderRelayRows();}},_('添加候选'));
  var relaySave=E('button',{class:'btn',click:function(){return relayAction('save');}},_('保存候选与顺序（不切换）'));
  var relayProbe=E('button',{class:'btn',click:function(){return relayAction('test');}},_('逐项强制检测 PROXYIP'));
  var relayApply=E('button',{class:'btn',click:function(){return relayAction('apply');}},_('应用已通过的主备顺序（不启用）'));
  var relayStatus=E('button',{class:'btn',click:function(){return relayAction('status');}},_('查询 Worker 实例切换记录'));
  var relayCard=E('section',{class:'cbi-section rp-backup-card'},[E('h3',{},_('2. 公共转发 PROXYIP · 主用与备用')),
   E('p',{},_('最多 6 项。启用项从上到下依次为主用、备用 1、备用 2。每项强制转发两个 Cloudflare 目标并验证 HTTPS，不允许直连或其他候选代替通过。Google / GitHub 由下方整条备用线路独立检测。保存后再检测，所有启用项通过后才能应用顺序。')),relayInfo,workerPanel('relay'),relayRows,
   E('div',{class:'rp-backup-actions'},[relayAdd,relaySave,relayProbe,relayApply,relayStatus]),relayRuntime,
   E('p',{class:'rp-help'},_('应用只修改 Workers 备用节点的连接参数，不启用备用、不改原主线路与分流。连接失败时按顺序尝试后续候选，失败项在当前 Worker 实例暂避 30 秒；所有候选都暂避时仍会尝试。已建立会话中断需重新连接，不能保证无缝续传。检测 5 分钟有效，域名背后的实际服务器也可能变化。公共 PROXYIP 不是通用 VPS 出口；普通网站通常由 Worker 直接连接，此候选主要负责需要公共转发的目标。'))]);
  relayModels=savedRelayRows.map(relayModel);
  function updateRelays(test,observed){
   relayTest=test;relayObserved=observed;
   if(!relayDirty&&!relayBusy){var node=backupNode||(data[5]&&data[5].node),applied=node&&relaySavedHash&&node.relay_order_hash===relaySavedHash;
    relayInfo.textContent=relayTaskRunning()?_('正在强制逐项检测，已完成 ')+(test.results||[]).length+'/'+(test.total||savedRelayRows.length):test&&test.state==='failed'?test.message:applied?_('已在当前备用节点固定此主备顺序；主线路未改变。'):_('候选已列出；尚未在当前备用节点应用此顺序。');}
   if(!relayDirty&&!(relayRows.contains&&relayRows.contains(document.activeElement)))renderRelayRows();else refreshRelayButtons();relayRuntime.replaceChildren();
   if(observed){relayRuntime.appendChild(E('p',{class:'rp-help'},(Date.now()/1000-observed.time>60?_('历史：'):'')+observed.message+' · '+when(observed.time)));Object.keys(observed.observed||{}).forEach(function(key){var h=observed.observed[key];relayRuntime.appendChild(E('p',{class:'rp-help'},key+' · '+_('连接成功 ')+(h.successes||0)+' / '+_('失败 ')+(h.failures||0)+' · '+({connected:_('最近连接成功'),connect_failed:_('最近连接失败'),stream_failed:_('传输中断')}[h.last]||_('未知'))));});}
  }

  var cloudMeta=(data[5]&&data[5].cloud)||{},cloudBusy=false,cloudState=null,cloudDirectory=cloudMeta.directory||null,cloudDirectoryAuto=false,cloudZones=[],cloudZonesFor='',cloudAccountKey='',cloudZoneKey='',scanState=null,scanBusy=false;
  var cloudInfo=E('p',{role:'status','aria-live':'polite'}),cloudSummary=E('p',{class:'rp-help'}),cloudResult=workerPanel('deploy');
  function cloudField(label,control,help){return E('label',{class:'rp-cloud-field'},[E('span',{},label),control,help?E('small',{class:'rp-help'},help):null].filter(function(item){return item!=null;}));}
  var cloudToken=E('input',{type:'password',autocomplete:'new-password','aria-label':_('Cloudflare API 令牌'),placeholder:cloudMeta.token_saved?_('已保存；留空保留原令牌'):_('仅填写受限 API 令牌，不使用 Global API Key')});
  var cloudAccount=E('input',{type:'text',value:cloudMeta.account_id||'','aria-label':_('Cloudflare 账户 ID'),placeholder:_('32 位账户 ID')});
  var cloudAccountChoice=E('select',{'aria-label':_('选择已授权的 Cloudflare 账户')},[E('option',{value:cloudMeta.account_id||''},cloudMeta.account_id?_('已保存账户 · ')+cloudMeta.account_id.slice(0,8):_('先读取已授权账户，或手工填写账户 ID'))]);
  var cloudName=E('input',{type:'text',value:cloudMeta.script||'routepilot-backup','aria-label':_('Worker 名称')});
  var cloudHost=E('input',{type:'text',readonly:true,value:cloudMeta.hostname||'','aria-label':_('绑定的子域名'),placeholder:_('选择根域名后自动组成')}),cloudPrefix=E('input',{type:'text',value:cloudMeta.hostname?cloudMeta.hostname.split('.')[0]:'backup','aria-label':_('子域名前缀'),placeholder:'backup'}),prefixInitialized=!cloudMeta.hostname;
  var cloudZone=E('select',{'aria-label':_('选择账户下可用的根域名')},[E('option',{value:cloudMeta.zone_id||''},cloudMeta.zone_id?_('已保存区域 · ')+cloudMeta.zone_id.slice(0,8):_('请先读取账户下可用域名'))]);
  var cloudRelay=E('input',{type:'text',value:savedRelayRows.filter(function(r){return r.enabled;}).map(function(r){return r.address;}).join(','),'aria-label':_('公共转发 PROXYIP')});
  function saveCloud(){
   var input={token:cloudToken.value,account_id:cloudAccount.value.trim(),script:cloudName.value.trim(),hostname:cloudHost.value.trim(),zone_id:cloudZone.value,proxyip:savedRelayRows.filter(function(r){return r.enabled;}).map(function(r){return r.address;}).join(',')};
   return fs.write('/var/run/routepilot/cloud-input',JSON.stringify(input),384).then(function(){cloudToken.value='';return command('cloud-save');});
  }
  function cloudAction(action,saveFirst){
   var title={verify:saveFirst?_('保存授权并读取账户 / 域名'):_('只读刷新账户 / 根域名'),target:_('检查名称与域名占用'),deploy:_('创建 Workers 与绑定域名'),check:_('只读核验部署与证书'),promote:_('将部署保存为备用节点'),forget:_('清除本机 API 授权')}[action]||action;
   if(action!=='verify')workerActionStage('deploy');
   var async=['verify','target','deploy','check'].indexOf(action)>=0;startWorkerOperation('deploy',title,action==='verify'?'directory':'cloud',async?action:null,action==='verify'?cloudDirectoryJob:cloudState);
   cloudBusy=true;updateCloud(cloudState);
   return Promise.resolve().then(function(){return saveFirst?saveCloud():null;}).then(function(){return command('cloud-'+action);}).then(function(raw){var result=JSON.parse(raw);acceptWorkerOperation('deploy',result,async);if(!async&&result.saved)return refreshWorkerMetadata();}).catch(function(e){failWorkerOperation('deploy',e.message);notify(e.message,true);}).finally(function(){cloudBusy=false;updateCloud(cloudState);updateWorkerProgress();});
  }
  var cloudSave=E('button',{class:'btn',click:function(){return cloudAction('verify',true);}},_('保存令牌并读取账户 / 域名'));
  var cloudTarget=E('button',{class:'btn',click:function(){return cloudAction('target',true);}},_('检查名称和子域名是否占用'));
  var cloudDeploy=E('button',{class:'btn cbi-button-action',click:function(){return cloudAction('deploy',true);}},_('一键创建 Workers 并绑定域名'));
  var cloudCheck=E('button',{class:'btn',click:function(){return cloudAction('check',false);}},_('检查部署与证书状态'));
  var cloudPromote=E('button',{class:'btn',click:function(){return cloudAction('promote',false);}},_('将新部署设为备用节点（不启用）'));
  var cloudForget=E('button',{class:'btn',click:function(){return cloudAction('forget',false);}},_('清除本机 API 令牌'));
  var tokenGuide=E('details',{class:'rp-guide-step'},[E('summary',{},_('没有 API 令牌？按这里创建（新手指引）')),E('div',{class:'rp-guide-body'},[
   E('ol',{},[E('li',{},[E('a',{href:'https://dash.cloudflare.com/profile/api-tokens',target:'_blank',rel:'noopener noreferrer'},_('打开 Cloudflare → 我的个人资料 → API 令牌')),_('，选择创建令牌 → 创建自定义令牌。')]),
    E('li',{},_('权限添加：账户 → Workers Scripts → 编辑；区域 → Zone → 读取；区域 → DNS → 读取；区域 → Workers Routes → 编辑。不要使用 Global API Key。')),
    E('li',{},_('账户资源仅选择自己的目标账户；区域资源仅选择要绑定域名所属的区域。绑定使用 Workers Custom Domains 接口，由 Cloudflare 创建记录和证书；本插件不直接改写其他 DNS 记录。')),
    E('li',{},_('设置合适的到期时间。创建后复制令牌，仅粘贴到本页私密输入框，不发聊天、不放普通备份。')),
    E('li',{},_('无需先复制账户 ID：留空后读取账户。有需要时也可在高级项手工填写 32 位账户 ID。子域名请用尚未使用的名称，例如 backup.你的域名。点击保存并读取可用域名，选择根域名，再填一个未使用的子域名前缀并部署。'))]),
   E('p',{class:'rp-help'},_('令牌保存在路由器私有文件，页面不会回显。清除本机令牌不会撤销 Cloudflare 令牌；需要撤销时回到 Cloudflare API 令牌页面。不会自动订购或升级付费计划。'))])]);
  var cloudDirectoryInfo=E('p',{class:'rp-help',role:'status','aria-live':'polite'});
  var cloudDirectoryRefresh=E('button',{class:'btn',click:function(){cloudDirectoryAuto=true;return cloudAction('verify',false);}},_('刷新账户与根域名（只读）'));
  function updateDirectory(data){
   if(data&&data.state&&data.started_at)cloudDirectoryJob=data;
   if(data&&Array.isArray(data.accounts)&&(!cloudDirectory||Number(data.read_at||0)>=Number(cloudDirectory.read_at||0))){cloudDirectory=data;}
   var source=cloudDirectory;
   if(cloudToken.value){cloudDirectoryInfo.textContent=_('令牌尚未保存；保存后才能读取它授权的账户和域名。');cloudDirectoryRefresh.disabled=true;return;}
   var hasToken=cloudState&&cloudState.configured===false?false:cloudMeta.token_saved||cloudState&&cloudState.token_saved;
   cloudDirectoryRefresh.disabled=!!(cloudBusy||!hasToken||data&&['queued','running'].indexOf(data.state)>=0&&Date.now()/1000-Number(data.started_at)<300);
   if(!source){cloudDirectoryInfo.textContent=data&&data.state==='failed'?data.message||_('域名读取失败，请重试；不能据此认定账户没有域名。'):_('尚未读取可用根域名；已保存绑定保持不变。');return;}
   var account=cloudAccount.value||source.discovered_account_id||'',accounts=source.accounts||[];
   var accountKey=JSON.stringify(accounts)+'|'+account;
   if(accountKey!==cloudAccountKey){cloudAccountKey=accountKey;cloudAccountChoice.replaceChildren(E('option',{value:''},_('请选择已授权账户')));accounts.forEach(function(a){cloudAccountChoice.appendChild(E('option',{value:a.id},a.name+' · '+a.id.slice(0,8)));});if(account&&!accounts.some(function(a){return a.id===account;}))cloudAccountChoice.appendChild(E('option',{value:account},_('保留原账户（本次目录未确认）')));}
   cloudAccountChoice.value=account;if(!cloudAccount.value&&account)cloudAccount.value=account;
   var zones=Array.isArray(source.all_zones)?source.all_zones.filter(function(z){return z.account_id===account;}):source.discovered_account_id===account||source.account_id===account?source.zones||[]:[];
   cloudZones=zones;cloudZonesFor=account;
   var zoneKey=account+JSON.stringify(zones);
   if(zoneKey!==cloudZoneKey){cloudZoneKey=zoneKey;var value=cloudZone.value||((cloudMeta.account_id||'')===account?cloudMeta.zone_id:'')||'';cloudZone.replaceChildren(E('option',{value:''},_('请选择根域名')));zones.forEach(function(z){cloudZone.appendChild(E('option',{value:z.id},z.name));});if(!zones.some(function(z){return z.id===value;}))value='';if(!value&&zones.length===1)value=zones[0].id;cloudZone.value=value;var chosen=zones.filter(function(z){return z.id===value;})[0];if(!prefixInitialized&&chosen&&cloudMeta.hostname&&cloudMeta.hostname.endsWith('.'+chosen.name)){cloudPrefix.value=cloudMeta.hostname.slice(0,-chosen.name.length-1);prefixInitialized=true;}if(chosen)syncCloudHostname();}
   cloudDirectoryInfo.textContent=(data&&['queued','running'].indexOf(data.state)>=0?_('正在只读刷新；已保存绑定不变。 '):'')+_('当前账户可用根域名：')+zones.length+_(' 个；仅含此令牌授权范围。')+(source.read_at?_(' 读取时间：')+when(source.read_at):'')+(Date.now()/1000-Number(source.read_at)>900?_(' · 历史目录，请只读刷新'):'')+(data&&data.state==='failed'?' · '+(data.message||_('本次刷新失败'))+_('；保留上次目录'):'');
  }
  var cloudCard=E('section',{class:'cbi-section rp-backup-card'},[E('h3',{},_('1. 创建自己的 Workers 备用线路')),E('p',{},_('已有备用可以继续使用；下面用于另外创建可由路由器管理的 Worker 和子域名。创建和绑定不切换主线路。')),cloudInfo,cloudSummary,cloudResult,E('div',{class:'rp-directory-toolbar'},[cloudDirectoryRefresh,cloudDirectoryInfo]),tokenGuide,
   E('div',{class:'rp-cloud-grid'},[cloudField(_('私密 API 令牌'),cloudToken,_('首次填写；已保存时留空即可保留。')),cloudField(_('Cloudflare 账户'),cloudAccountChoice,_('从此令牌可读取、且有有效域名的账户中选择。')),E('details',{},[E('summary',{},_('手工填写账户 ID（可选）')),cloudField(_('账户 ID'),cloudAccount)]),cloudField(_('Worker 名称'),cloudName,_('以 routepilot- 开头；不会覆盖其他项目。')),cloudField(_('可用根域名'),cloudZone,_('显示此令牌可读取且已生效的根域名；绑定权限在占用检查和部署时另行确认。')),cloudField(_('子域名前缀'),cloudPrefix,_('例如 backup，不填写 https:// 或根域名。')),cloudField(_('最终绑定的子域名'),cloudHost,_('系统会检查占用；不用先到 Cloudflare 添加这条 DNS。'))]),
   E('p',{class:'rp-help'},_('公共转发 PROXYIP 在下面的候选池管理；部署采用已保存的启用顺序。修改候选不会立即改动云端或当前节点。')),
   E('div',{class:'rp-backup-actions'},[cloudSave,cloudTarget,cloudDeploy,cloudCheck,cloudPromote]),E('details',{class:'rp-danger-area'},[E('summary',{},_('危险操作：清除本机授权')),E('p',{},_('仅删除路由器保存的 API 令牌和域名目录；不会删除云端资源、撤销 Cloudflare 令牌或切换当前线路。')),cloudForget])]);
  function updateCloud(state){
   cloudState=state;if(state&&Array.isArray(state.projects)&&Number(state.projects_read_at||0)>=workerProjectsAt){workerProjectRows=state.projects;workerProjectsAt=Number(state.projects_read_at||0);}var busy=cloudBusy||workerOperationBusy('deploy')||(state&&['running','queued'].indexOf(state.state)>=0&&Date.now()/1000-Number(state.started_at)<300),configured=!!(cloudMeta.configured||(state&&state.configured));
   if(state&&state.configured===false){configured=false;cloudMeta={configured:false};cloudDirectory=null;cloudZones=[];cloudZonesFor='';cloudZoneKey='';cloudDirectoryInfo.textContent=_('本机 API 令牌已清除，需重新授权后读取域名。');}
   cloudInfo.textContent=state&&state.message?state.message:configured?_('已保存 Cloudflare 配置，云端部署状态尚未检查。'):_('尚未保存 API 令牌；可先展开下方创建指引。');
   var saved=(state&&state.configured)?state:cloudMeta,dirty=!!cloudToken.value||['account_id','script','hostname','zone_id'].some(function(k){var controls={account_id:cloudAccount,script:cloudName,hostname:cloudHost,zone_id:cloudZone,proxyip:cloudRelay};return String(controls[k].value||'').trim()!==String(saved[k]||'');});cloudSummary.textContent=(saved.hostname?_('当前保存目标：')+saved.script+' · '+saved.hostname+'。 ':'')+_('改动后先保存并读取区域 / 部署；HTTPS 就绪后仍需独立联网检测。')+(dirty?_(' 表单有尚未保存的改动。'):'');
   updateDirectory(state&&(Array.isArray(state.accounts)||state.directory)?state.directory||state:null);
   dirty=!!cloudToken.value||['account_id','script','hostname','zone_id'].some(function(k){var controls={account_id:cloudAccount,script:cloudName,hostname:cloudHost,zone_id:cloudZone,proxyip:cloudRelay};return String(controls[k].value||'').trim()!==String(saved[k]||'');});
   workerFlow.cloudDirty=dirty;workerFlow.deployed=!!(state&&state.state==='ready'&&!dirty);
   var alreadySaved=backupNode&&backupNode.configured&&workerProjectRows.some(function(row){return row.saved_as_backup&&row.script===cloudName.value.trim()&&row.hostname===cloudHost.value.trim();});if(alreadySaved)cloudSummary.textContent+=_(' 当前部署已保存为备用，无需重复保存；请继续②。');
   var primary=!configured||cloudToken.value?cloudSave:alreadySaved?cloudCheck:workerFlow.deployed?cloudPromote:cloudDeploy;[cloudSave,cloudDeploy,cloudPromote,cloudCheck].forEach(function(button){button.setAttribute('class',button===primary?'btn cbi-button-action':'btn');});
   cloudSave.disabled=!!busy;var validTarget=cloudZonesFor===cloudAccount.value.trim().toLowerCase()&&!cloudToken.value&&cloudZones.some(function(z){return z.id===cloudZone.value;})&&!!cloudHost.value;cloudDeploy.disabled=!!(busy||!validTarget||workerActions.deploy&&workerActions.deploy.result&&workerActions.deploy.result.state==='unknown');cloudTarget.disabled=!!(busy||!validTarget);cloudCheck.disabled=!!(busy||!configured||dirty);cloudForget.disabled=!!(busy||!configured);cloudPromote.disabled=!!(alreadySaved||busy||dirty||!state||state.state!=='ready'||uci.get('routepilot','main','backend')==='worker');
  }
  function syncCloudHostname(){var zone=cloudZones.filter(function(z){return z.id===cloudZone.value;})[0];var prefix=String(cloudPrefix.value||'').trim().toLowerCase();cloudHost.value=zone&&/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(prefix)?prefix+'.'+zone.name:'';}
  cloudPrefix.addEventListener('input',function(){prefixInitialized=true;syncCloudHostname();updateCloud(cloudState);});
  cloudAccountChoice.addEventListener('change',function(){cloudAccount.value=cloudAccountChoice.value;cloudZones=[];cloudZonesFor='';cloudZoneKey='';cloudZone.replaceChildren(E('option',{value:''},_('账户已变更，请重新读取域名')));cloudZone.value='';cloudHost.value='';updateDirectory(cloudDirectory);updateCloud(cloudState);});
  cloudToken.addEventListener('input',function(){cloudZones=[];cloudZonesFor='';cloudZoneKey='';if(!cloudToken.value)updateDirectory(cloudMeta.directory);else updateDirectory(null);updateCloud(cloudState);});cloudAccount.addEventListener('input',function(){cloudZoneKey='';cloudZone.value='';updateDirectory(cloudDirectory);updateCloud(cloudState);});
  [cloudName,cloudHost,cloudRelay].forEach(function(field){field.addEventListener('input',function(){updateCloud(cloudState);});});cloudZone.addEventListener('change',function(){syncCloudHostname();updateCloud(cloudState);});updateCloud(null);updateDirectory(cloudDirectory);
  var scanInfo=E('p',{role:'status','aria-live':'polite'},_('尚未优选；原备用入口保持不变。')),scanRows=E('div');
  function scanAction(action){workerActionStage('scan');startWorkerOperation('scan',action==='backup-scan'?_('优选 Cloudflare 入口'):_('保存推荐备用入口'),'scan',null,scanState);scanBusy=true;updateScan(scanState);return command(action).then(function(raw){var r=JSON.parse(raw);acceptWorkerOperation('scan',r,action==='backup-scan');if(action==='backup-scan-apply')return refreshWorkerMetadata();}).catch(function(e){failWorkerOperation('scan',e.message);notify(e.message,true);}).finally(function(){scanBusy=false;updateWorkerProgress();});}
  var scanStart=E('button',{class:'btn',click:function(){return scanAction('backup-scan');}},_('开始自动优选（约 1～4 分钟）'));
  var scanApply=E('button',{class:'btn',click:function(){return scanAction('backup-scan-apply');}},_('应用推荐入口（不切换）'));
  var scanCard=E('section',{class:'cbi-section rp-backup-card'},[E('h3',{},_('3. 自动优选 Cloudflare 入口 IP')),E('p',{},_('从 Cloudflare 公布的 IPv4 网段中，小范围测试最多 8 个入口。每个入口实际连接你的 Worker，验证 Google、GitHub 和小文件下载；不会扫描局域网或切换设备。')),scanInfo,workerPanel('scan'),E('div',{class:'rp-backup-actions'},[scanStart,scanApply]),scanRows,E('p',{class:'rp-help'},_('综合两站响应延迟排序，短测下载作为参考。只推荐两站均通过的入口；限流单独显示。不代表全网最快、固定国家或带宽上限；结果 5 分钟有效。应用仅改变备用入口，域名证书身份和主线设置保持不变，之后需重新独立检测。'))]);
  function updateScan(state){
   scanState=state;var busy=scanBusy||workerOperationBusy('scan')||(state&&['queued','running'].indexOf(state.state)>=0&&Date.now()/1000-Number(state.started_at)<300);
   scanStart.disabled=!!busy;scanApply.disabled=!!(busy||!state||state.state!=='done'||!state.best_ip||Date.now()/1000-Number(state.finished_at)>300||!backupNode||state.fingerprint!==backupNode.fingerprint||uci.get('routepilot','main','backend')==='worker');
   scanStart.setAttribute('class',scanApply.disabled?'btn cbi-button-action':'btn');scanApply.setAttribute('class',scanApply.disabled?'btn':'btn cbi-button-action');
   if(state)scanInfo.textContent=state.message||(busy?_('正在优选，已完成 ')+(state.rows||[]).length+'/'+(state.total||8)+(state.progress!=null?' · '+state.progress+'%':''):_('等待结果'));
   scanRows.replaceChildren();if(!state||!Array.isArray(state.rows))return;
   state.rows.forEach(function(r){var checks=r.checks||[],all=checks.length===2&&checks.every(function(c){return c.ok;}),avg=checks.length?Math.round(checks.reduce(function(n,c){return n+c.ms;},0)/checks.length):null;scanRows.appendChild(E('p',{class:'rp-help'},(r.ip===state.best_ip?'★ ':'')+r.ip+' · '+(all?_('两站通过'):_('未完整通过'))+(avg!=null?' · '+avg+' ms':'')+(r.download&&r.download.ok?' · '+(r.download.mibps*8*1048576/1000000).toFixed(2)+' Mbps（短测）':r.download&&r.download.warning?' · '+r.download.warning:'')));});
  }
  updateScan(null);

  updateRelays(null,null);
  var connectionRows=E('div'),connectionDirectory=E('div'),connectionHistory=E('details',{class:'rp-stat-details'},[E('summary',{},_('连接记录与开关说明')),connectionRows,connectionDirectory,E('p',{class:'rp-help'},_('开关立即生效，无需保存；不会提交尚未保存的其他设置。'))]);
  function updateConnectionHistory(data){connectionRows.replaceChildren();var rows=data&&Array.isArray(data.events)?data.events.slice(-6).reverse():[];rows.forEach(function(row){var label=row.state==='running'?_('连接已恢复 / 已运行'):row.recovering?_('短暂中断，等待原客户端恢复'):row.state==='error'?_('连接异常'):row.state==='disabled'?_('已关闭'):_('状态变化');connectionRows.appendChild(E('p',{class:'rp-help'},when(row.time)+' · '+label+(row.fallback==='direct'?_(' · 已撤回接管，保持直连'):row.fallback==='unknown'?_(' · 网络路径未确认'):'')));});if(!rows.length)connectionRows.appendChild(E('p',{class:'rp-help'},_('尚无连接变化记录')));}
  var overviewBadge=E('span',{class:'rp-status-badge'},_('读取中'));
  var overviewMeta=E('p',{class:'rp-help'}),overviewLine=E('p',{class:'rp-overview-line',role:'status','aria-live':'polite'});
  var overviewHero=E('section',{class:'cbi-section rp-overview-hero','data-tone':'unknown'},[E('div',{class:'rp-hero-heading'},[overviewBadge,powerButton]),overviewLine,overviewMeta,switchFeedback]);
  var trafficRange='today',latestTraffic=null,trafficNote=E('p',{class:'rp-data-note',role:'status'},_('正在读取流量观测…'));
  var trafficMeta=E('p',{class:'rp-help'}),metricFields={};
  var metricCards=['proxy','direct'].map(function(key){var value=E('strong',{class:'rp-metric-number'},'—'),detail=E('p',{class:'rp-help'}),speed=E('p',{class:'rp-help'});metricFields[key]={value:value,detail:detail,speed:speed};return E('section',{class:'cbi-section rp-metric-card rp-'+key},[E('div',{class:'rp-metric-heading'},[E('span',{class:'rp-metric-icon','aria-hidden':'true'},key==='proxy'?'↗':'⇄'),E('h3',{},key==='proxy'?_('代理出口 · 已观测'):_('直连线路 · 已观测')),value]),detail,speed]);});
  var rangeButtons={};
  var rangeControls=E('div',{class:'rp-segments',role:'group','aria-label':_('流量统计时段')},[['today',_('今日')],['total',_('累计')]].map(function(item){var b=rangeButtons[item[0]]=E('button',{class:'btn','aria-pressed':item[0]===trafficRange?'true':'false',click:function(){trafficRange=item[0];Object.keys(rangeButtons).forEach(function(k){rangeButtons[k].setAttribute('aria-pressed',k===trafficRange?'true':'false');});updateTraffic(latestTraffic);}},item[1]);return b;}));
  var weekChart=E('div',{class:'rp-week-chart','aria-label':_('近七天已观测流量，蓝色代理，青色直连')}),weekLegend=E('p',{class:'rp-help'},[E('span',{class:'rp-legend-proxy'},_('● 代理')),E('span',{class:'rp-legend-direct'},_('● 直连')),_(' · 缺失日期显示 —，不补零')]);
  var trafficCard=E('section',{class:'cbi-section rp-traffic-section'},[E('div',{class:'rp-hero-heading'},[E('h3',{},_('流量观测')),rangeControls]),trafficNote,E('div',{class:'rp-metric-grid'},metricCards),E('div',{class:'rp-trend-heading'},[E('strong',{},_('近 7 天')),weekLegend]),weekChart,E('details',{class:'rp-stat-details'},[E('summary',{},_('统计口径与采样详情')),trafficMeta])]);
  var nodeCount=E('span',{class:'rp-group-state'},'—'),nodeSummary=E('p'),nodeTime=E('p',{class:'rp-help'});
  var nodeRefresh=E('button',{class:'btn',click:function(){nodeRefresh.disabled=true;return refreshDirectory().finally(function(){nodeRefresh.disabled=false;});}},_('刷新出口目录'));
  var nodeCard=E('section',{class:'cbi-section'},[E('div',{class:'rp-hero-heading'},[E('h3',{},[_('账户出口'),nodeCount]),E('a',{href:base+'/cloudflare#rp-center-basic'},_('管理全部出口 →'))]),nodeSummary]);
  connectionDirectory.appendChild(E('details',{class:'rp-stat-details'},[E('summary',{},_('账户目录时间与刷新')),nodeTime,nodeRefresh]));
  var versionInfo=E('p',{class:'rp-help'},_('客户端版本正在读取…'));
  var quickCard=E('section',{class:'cbi-section','aria-label':_('快捷操作')},[E('div',{class:'rp-quick-grid'},[['cloudflare#rp-center-basic','↗',_('出口与分流'),_('查看当前出口和接管范围')],['cloudflare#rp-center-dns','◎',_('DNS 与联网检测'),_('检查解析、网页并清理缓存')],['cloudflare#rp-center-workers','⌁',_('Workers 备用'),_('部署、优选和独立检测')]].map(function(q){return E('a',{class:'rp-quick-tile',href:base+'/'+q[0]},[E('span',{class:'rp-quick-icon','aria-hidden':'true'},q[1]),E('span',{},[E('strong',{},q[2]),E('small',{},q[3])])]);}))]);
  function bytes(n){if(!Number.isFinite(n)||n<0)return '—';var units=['B','KiB','MiB','GiB','TiB'],i=0;while(n>=1024&&i<units.length-1){n/=1024;i++;}return (i?n.toFixed(n<10?2:1):String(Math.round(n)))+' '+units[i];}
  function validTrafficCounts(v){return v&&['proxy_up','proxy_down','direct_up','direct_down'].every(function(k){return Number.isSafeInteger(v[k])&&v[k]>=0;});}
  function updateTraffic(v){
   latestTraffic=v;var age=v?Date.now()/1000-Number(v.time):Infinity,live=v&&v.schema===1&&age>=-5&&age<=20&&v.state==='observing';
   var limited=!v||v.offload!=='not_detected';trafficNote.textContent=!live?(v&&v.message?v.message:!v?_('尚无采集数据，不能确认当前用量。'):_('采集已暂停或过期；以下仅为历史观测，不是当前用量。')):limited?_('仅统计未加速部分，可能远低于实际用量；图表与累计均为观测下限。'):_('观测下限，不作账单；历史可能存在采集中断。');
   trafficCard.setAttribute('data-stale',live?'false':'true');if(v&&v.clock_synced===false)trafficNote.textContent+=_(' 路由器时间尚未同步，新增流量暂不分配到日期。');
   var bucket=v&&v.days&&v.days[v.today],counts=trafficRange==='total'?v&&v.total:bucket&&bucket.bytes,valid=validTrafficCounts(counts);
   ['proxy','direct'].forEach(function(k){var f=metricFields[k];f.value.textContent=valid?bytes(counts[k+'_up']+counts[k+'_down']):'—';f.detail.textContent=valid?(live?'':_('历史观测，停止于 ')+when(v.time)+' · ')+_('↑ 上传 ')+bytes(counts[k+'_up'])+_(' · ↓ 下载 ')+bytes(counts[k+'_down']):_('此时段没有采集数据');var last=v&&Array.isArray(v.history)&&v.history[v.history.length-1],rate=live&&last&&last.rate;f.speed.textContent=rate&&Number.isFinite(rate[k+'_down'])&&Number.isFinite(rate[k+'_up'])?_('已观测速率 ↑ ')+bytes(rate[k+'_up'])+'/s ↓ '+bytes(rate[k+'_down'])+'/s':_('当前速率：未知');});
   weekChart.replaceChildren();var today=v&&/^\d{4}-\d{2}-\d{2}$/.test(v.today||'')?v.today:null,days=[],max=1;
   if(today){var end=new Date(today+'T12:00:00Z');for(var i=6;i>=0;i--){var stamp=new Date(end.getTime()-i*86400000).toISOString().slice(0,10),b=v.days&&v.days[stamp],c=b&&b.bytes,ok=validTrafficCounts(c),proxy=ok?c.proxy_up+c.proxy_down:null,direct=ok?c.direct_up+c.direct_down:null;days.push({day:stamp,proxy:proxy,direct:direct,ok:ok});if(ok)max=Math.max(max,proxy+direct);}}
   days.forEach(function(d){var text=d.ok?bytes(d.proxy+d.direct):'—',bar=E('div',{class:'rp-day-bars','aria-hidden':'true'},d.ok?[E('span',{class:'rp-bar-direct',style:'height:'+(d.direct/max*100)+'%'}),E('span',{class:'rp-bar-proxy',style:'height:'+(d.proxy/max*100)+'%'})]:E('span',{class:'rp-no-data'},'—'));weekChart.appendChild(E('div',{class:'rp-day',role:'img','aria-label':d.day+': '+(d.ok?_('代理 ')+bytes(d.proxy)+_('，直连 ')+bytes(d.direct):_('没有采集数据'))},[E('span',{class:'rp-day-number'},text),bar,E('span',{class:'rp-day-label'},d.day.slice(5))]));});
   if(!days.length)weekChart.appendChild(E('p',{class:'rp-help'},_('采集开始后显示每日趋势。')));
   trafficMeta.textContent=v?_('累计为自此时间起的观测下限：')+when(v.started_at)+_(' · 最后采样：')+when(v.time)+_(' · 路由器时区：')+String(v.timezone||_('未知'))+_('。每 5 分钟保存一次，掉电可能丢失未保存部分。仅含受管 IPv4 公网转发；不含 IPv6、局域网、路由器本机和隧道封装开销。')+(v.gaps?_(' 已记录不完整采样区间或边界：')+v.gaps+_(' 次。'):'')+(validTrafficCounts(v.unallocated)&&Object.keys(v.unallocated).some(function(k){return v.unallocated[k]>0;})?_(' 有无法归属到日期的流量，仅纳入累计。'):''):_('升级前的流量无法补算。');
   versionInfo.textContent='RoutePilot '+(buildInfo.package||_('版本待读取'))+' · WARP '+(v&&v.client_version?v.client_version:_('版本未知'))+_(' · 仅显示本机读到的版本；是否有更新请核对官方发布记录。');
  }
  function updateOverview(v,t){
   var fresh=feedback.fresh(v,Date.now()),running=fresh&&v.state==='running',tone=!fresh?'unknown':running?'good':v.state==='error'?'bad':'warn';
   overviewHero.setAttribute('data-tone',tone);overviewBadge.textContent=!fresh?_('？ 状态未知'):running?(v.backend==='worker'?_('✓ 备用线路运行中（TCP）'):_('✓ 隧道已连接')):v.state==='error'?_('! 连接故障，请查看详情'):v.state==='disabled'?_('○ 已关闭'):v.state==='preparing'?_('◷ 登录准备中'):_('◷ 等待连接');
   overviewLine.textContent=!fresh?_('状态已过期，当前连接未确认'):running?(v.backend==='worker'?_('Workers 备用'):_('WARP 主线路'))+' · '+_('实际协议：')+(v.protocol||_('待确认'))+' · '+directoryLabel(v.exit,catalog)+' · IP '+(v.exit_ip||'—'):v.message||_('等待连接');
   overviewMeta.textContent=_('状态更新时间：')+when(v&&v.time)+_(' · 接管范围：')+(v&&v.scope==='lan'?_('所选局域网'):_('所选设备'))+_(' · 隧道连接不等于所有网站可访问。')+(v&&v.protocol_warning?' '+v.protocol_warning:'');
   var recent=catalog.available&&Date.now()-catalog.read_at<=60000,count=catalog.available?catalog.networks.length:null;
   nodeCount.textContent=count==null?_('目录待确认'):_('共 ')+String(count)+_(' 个可选网络');
   var verified=feedback.wizardProxyVerification(t,v,wizardConfig(),Date.now()),proof=verified==='success',proofText=proof?_('1 个最近检测通过'):verified==='error'?_('当前出口检测失败'):_('当前出口尚无有效检测');
   nodeSummary.textContent=(v&&v.backend!=='worker'?_('当前出口：')+directoryLabel(v.exit,catalog)+' · ':'')+(v&&v.backend==='worker'?_('当前运行备用线路；账户出口未接管。'):(fresh?(running?_('1 个当前连接'):_('0 个当前连接')):_('当前连接数未知'))+' · '+proofText);

   nodeTime.textContent=catalog.available?(recent?_('目录读取时间：'):_('目录可能已变化，上次读取：'))+new Date(catalog.read_at).toLocaleString()+(proof?_(' · 网页检测通过时间：')+when(t.finished_at)+_('（5 分钟内有效）'):''):_('目录暂不可用，请刷新；不代表账户没有出口。');
  }
  var rulesCard=E('div',{class:'cbi-section'},[E('h3',{},_('规则更新反馈')),rulesProgress,rulesTime,rulesCounts]);
  var testCard=E('div',{class:'cbi-section'},[E('h3',{},_('网站连通性检测')),testsInfo,testButton,E('table',{class:'table'},[E('tr',{class:'tr table-titles'},[E('th',{},_('网站')),E('th',{},_('检测线路')),E('th',{},_('结果')),E('th',{},_('HTTPS 耗时'))])].concat(testRows)),E('p',{class:'rp-help'},_('检测 HTTPS 能否建立连接；耗时不是 Ping，也不代表视频速度或网站登录一定可用。'))]);
  var dnsInfo=E('p',{role:'status','aria-live':'polite'},_('正在读取独立 DNS 状态…')),dnsCounts=E('p'),dnsEffective=E('p'),dnsResults=E('div'),dnsTestInfo=E('p',{role:'status','aria-live':'polite'},_('尚未执行 DNS 检测'));
  var clearPending=false,dnsSubmitting=false,dnsJobPending=null;
  var dnsClearButton=E('button',{class:'btn',disabled:true,click:function(){
   if(clearPending||feedback.dnsState(liveDNS,wizardStatus,Date.now())!=='running')return;
   clearPending=true;dnsClearButton.disabled=true;
   command('dns-clear').then(JSON.parse).then(function(result){
    if(!result.ok||!liveDNS||['runtime_id','generation','process_instance'].some(function(k){return result[k]!==liveDNS[k];}))throw Error(_('连接已改变，请刷新后确认缓存状态'));
    notify(_('已清理 RoutePilot 独立 DNS 缓存，移除 ')+result.removed+_(' 条；未清理系统、SSR 缓存或动态分流规则。'));
   }).catch(function(e){notify(e.message,true);}).finally(function(){clearPending=false;dnsClearButton.disabled=feedback.dnsState(liveDNS,wizardStatus,Date.now())!=='running'||!liveDNS.control_available;});
  }},_('清理本插件 DNS 缓存'));
  var dnsProbeButton=E('button',{class:'btn cbi-button-action',disabled:true,click:function(){
   if(feedback.dnsState(liveDNS,wizardStatus,Date.now())!=='running')return;
   if(dnsSubmitting)return;dnsSubmitting=true;dnsProbeButton.disabled=true;dnsTestInfo.textContent=_('正在提交 DNS 检测…');
   command('dns-test').then(JSON.parse).then(function(result){
    dnsTestInfo.textContent=result.message;
    if(result.state==='submitted'||result.state==='running')dnsJobPending={id:result.request_id||null,time:Date.now()};
   }).catch(function(e){dnsTestInfo.textContent=e.message;dnsProbeButton.disabled=false;}).finally(function(){dnsSubmitting=false;});
  }},_('检测当前 DNS 解析'));
  var dnsCacheCard=E('div',{class:'cbi-section'},[E('h3',{},_('独立 DNS 状态与缓存')),dnsInfo,dnsEffective,dnsCounts,dnsClearButton,E('p',{class:'rp-help'},_('显示已生效的 DNS，表单未保存的修改不会用于检测。清理只作用于本插件缓存，不重启隧道，也不清除动态分流规则。'))]);
  var dnsTestCard=E('div',{class:'cbi-section'},[E('h3',{},_('DNS 解析检测')),E('p',{class:'rp-help'},_('从路由器测试当前受管 DNS 入口的国内与代理域名解析。上游按生效规则显示，结果不能代替设备端到端验收。检测会产生正常 DNS 查询，不会保存表单或切换出口。')),dnsProbeButton,dnsTestInfo,dnsResults]);
  function updateDNS(data,test,status){
   liveDNS=data;var now=Date.now(),state=feedback.dnsState(data,status,now);
   dnsInfo.textContent=({running:_('独立 DNS 正在运行'),inactive:_('分流未运行，独立 DNS 当前不可用'),stale:_('DNS 状态已过期或连接已改变'),unavailable:_('暂未取得独立 DNS 状态')})[state];
   dnsCounts.textContent='';dnsEffective.textContent='';
   var valid=state==='running';dnsClearButton.disabled=clearPending||!valid||!data.control_available;
   if(valid){
    var entries=0,hits=0,requests=0,errors=0;data.policies.forEach(function(p){entries+=p.cache_entries;hits+=p.cache_hits;requests+=p.requests;errors+=p.errors;});
    dnsCounts.textContent=_('缓存条目：')+entries+' · '+_('命中：')+hits+' / '+_('查询：')+requests+' · '+_('转发异常：')+errors;
    dnsEffective.textContent=_('生效国内上游：')+data.upstreams.dns_domestic+' · '+String(data.upstreams.transport||'').toUpperCase()+' · '+_('代理上游：')+(data.upstreams.proxy_dns_override?data.upstreams.proxy_dns_override+_(' · DoH，经备用线路加密'):data.upstreams.dns_foreign+_(' · 普通 DNS，非加密上游'));
    if(!data.control_available)dnsInfo.textContent+=_('；缓存控制暂不可用，转发仍独立运行');
   }
   var ts=feedback.dnsTestState(test,status,data,now);
   if(dnsJobPending&&now-dnsJobPending.time>50000)dnsJobPending=null;
   var awaiting=dnsJobPending&&(!test||dnsJobPending.id&&test.request_id!==dnsJobPending.id);
   if(dnsJobPending&&!awaiting&&ts!=='busy')dnsJobPending=null;
   dnsProbeButton.disabled=dnsSubmitting||!valid||ts==='busy'||!!dnsJobPending;
   dnsTestInfo.textContent=awaiting?_('等待本次 DNS 检测作业，最长约 40 秒…'):({busy:_('正在检测，最长约 40 秒…'),success:_('本机受管 DNS 入口解析通过'),error:_('部分 DNS 解析检测失败'),warning:_('部分 DNS 入口未就绪或没有完整解析结果'),stale:_('历史 DNS 结果已过期或检测环境已改变，请重新检测'),pending:_('尚未执行 DNS 检测'),unavailable:_('当前 DNS 未运行，尚不能检测')})[ts];
   if(test&&test.finished_at)dnsTestInfo.textContent+=' · '+_('检测时间：')+when(test.finished_at);
   var rows=(test&&Array.isArray(test.results)?test.results:[]).map(function(r){return E('tr',{},[E('td',{},r.label||_('受管范围 ')+r.policy),E('td',{},r.domain+' · '+String(r.protocol||'').toUpperCase()),E('td',{},(r.configured_route==='domestic'?_('国内上游：'):_('代理上游：'))+r.upstream),E('td',{},(ts==='stale'||awaiting?_('历史：'):'')+(r.message||r.state)+(r.addresses&&r.addresses.length?' · '+r.addresses.join(', '):'')),E('td',{},r.ms!=null?r.ms+' ms':'—')]);});
   dnsResults.replaceChildren(E('table',{class:'table'},[E('thead',{},E('tr',{},['受管范围','测试域名 / 接入','按规则选择的上游','解析结果','耗时'].map(function(t){return E('th',{},_(t));}))),E('tbody',{},rows)]));
  }
  var receiveState=E('p',{role:'status','aria-live':'polite'},_('正在读取接收观测…')),receiveCounts=E('p'),receiveCoverage=E('p');
  var receiveCard=E('div',{class:'cbi-section'},[E('h3',{},_('WARP 客户端 UDP 接收观测')),receiveState,receiveCounts,receiveCoverage,E('p',{class:'rp-help'},_('仅观察客户端公网 UDP，已识别隧道与其他公网 UDP 均包含在统计中。目标约 100ms 采样、每秒更新；队列表示内核接收内存占用，峰值为最近约 60 秒的采样值，可能漏掉更短突发。新增丢弃从各连接建立观测基线后累计，不含启动前或漏采段，不是端到端丢包率，也不能单独证明速度波动原因。不会调整缓冲或分流设置。'))]);
  function updateReceive(data,status){
   if(status&&status.backend==='worker'){receiveState.textContent=_('当前使用 TCP 备用线路；此处的 WARP UDP 观测不适用。');receiveCounts.textContent='';receiveCoverage.textContent='';return;}
   var state=feedback.receiveState(data,status,Date.now()),names={unavailable:_('接收观测不可用，不能确认队列或丢包情况。'),stale:_('接收观测已过期或连接已改变，旧数据不能代表当前网络。'),inactive:_('当前没有运行中的隧道观测。'),no_sockets:_('暂未观测到客户端公网 UDP 连接，不能据此认定没有丢包。'),observing:_('正在进行只读接收观测。'),partial:_('正在观测，但存在漏采或计数重置，数据不完整。')};
   receiveState.textContent=names[state];receiveCounts.textContent='';receiveCoverage.textContent='';
   if(state!=='observing'&&state!=='partial')return;
   receiveCounts.textContent=_('当前接收积压：')+(data.queue_now/1048576).toFixed(2)+' MiB · '+_('最近采样峰值：')+(data.peak_queue/1048576).toFixed(2)+' MiB · '+_('本次观测新增丢弃：')+data.observed_drops;
   receiveCoverage.textContent=_('连接数：')+data.socket_count+' · '+_('已识别隧道：')+data.known_ingress_count+' · '+_('其他公网 UDP：')+data.other_public_udp_count+' · '+_('观测开始：')+when(data.started_at)+' · '+_('最近更新：')+when(data.time);
  }
  var pendingApply=null,pendingUpdate=null;
  function when(ts){return ts?new Date(ts*1000).toLocaleString():_('暂无成功记录');}
  function showCounts(parent,counts){parent.replaceChildren();var names={china:_('中国 IP'),china_domains:_('中国域名'),gfw:_('代理域名'),whitelist:_('直连域名')};Object.keys(names).forEach(function(k){parent.appendChild(E('span',{style:'display:inline-block;margin-right:18px'},names[k]+'：'+(counts&&counts[k]!=null?Number(counts[k]).toLocaleString():'—')));});}
  function updateFeedback(v){if(v.state==='running'&&!feedback.updateRunning(v,Date.now()))v=Object.assign({},v,{state:'unknown',phase:_('更新状态已过期，结果未知；可重新更新')});lastRule=v;rulesProgress.textContent=(v.state==='running'?_('更新中 · ')+String(v.percent||0)+'% · ':'')+String(v.phase||_('尚未更新'));rulesProgress.style.color=v.state==='failed'?'#b42318':v.state==='success'?'#087443':'#2254d1';rulesTime.textContent=_('最后成功更新：')+when(v.last_success_at);showCounts(rulesCounts,v.counts);if(pendingUpdate&&v.request_id===pendingUpdate.nonce){pendingUpdate.box.replaceChildren(E('p',{},rulesProgress.textContent),E('p',{},rulesTime.textContent));var counts=E('div');showCounts(counts,v.counts);pendingUpdate.box.appendChild(counts);if(v.state==='success'||v.state==='failed')pendingUpdate=null;}}
  function submitSettings(update){
   if(saveInFlight)return saveInFlight;
   if(update&&feedback.updateRunning(lastRule,Date.now())){var b=E('div',{},lastRule.phase);pendingUpdate={nonce:lastRule.request_id,box:b};ui.showModal(_('规则正在更新'),[b,E('button',{class:'btn',click:ui.hideModal},_('关闭'))]);return Promise.resolve();}
   var nonce=String(Date.now()),box=E('div',{},E('p',{},_('正在提交本插件配置…')));uci.set('routepilot','main','apply_nonce',nonce);if(update)uci.set('routepilot','main','update_nonce',nonce);
   pendingApply={nonce:nonce,box:box,started:Date.now(),update:update};if(update)pendingUpdate={nonce:nonce,box:box};
   ui.showModal(update?_('规则更新进度'):_('应用配置'),[box,E('button',{class:'btn',click:function(){ui.hideModal();if(statusCard.isConnected)statusCard.scrollIntoView({behavior:'smooth',block:'start'});}},_('关闭'))]);
   saveInFlight=Promise.resolve().then(function(){return m.save();}).then(function(){return uci.save();}).then(function(){return commitConfig('routepilot');}).then(function(){committedOrganization=uci.get('routepilot','main','organization')||'';delete wizardActions.org;updateWizard();box.textContent=update?_('请求已提交，等待后台开始更新…'):_('配置已提交，正在等待实际应用结果…');return {nonce:nonce};}).catch(function(e){box.textContent=_('未完成：')+e.message;pendingApply=null;pendingUpdate=null;if((page==='advanced'||center)&&wizardActions.org)failWizardStep('org');return false;}).finally(function(){saveInFlight=null;});return saveInFlight;
  }
  self.applySettings=function(){return submitSettings(false);};self.requestRulesUpdate=function(){return submitSettings(true);};
  poll.add(function(){return Promise.all(['/var/run/routepilot/status.json','/var/run/routepilot/update.json','/var/run/routepilot/connectivity.json'].concat(center?['/var/run/routepilot/receive.json','/var/run/routepilot/dns-state.json','/var/run/routepilot/dns-tests.json','/var/run/routepilot/backup-node.json','/var/run/routepilot/backup-test.json','/var/run/routepilot/cloud-state.json','/var/run/routepilot/backup-scan.json','/var/run/routepilot/relay-tests.json','/var/run/routepilot/relay-observed.json','/var/run/routepilot/warp-state.json','/var/run/routepilot/exit-observation.json']:page==='dns'?['/var/run/routepilot/receive.json','/var/run/routepilot/dns-state.json','/var/run/routepilot/dns-tests.json']:page==='overview'?['/var/run/routepilot/traffic.json']:page==='workers'?['/var/run/routepilot/backup-node.json','/var/run/routepilot/backup-test.json','/var/run/routepilot/cloud-state.json','/var/run/routepilot/backup-scan.json','/var/run/routepilot/relay-tests.json','/var/run/routepilot/relay-observed.json']:[]).concat((center||page==='workers')?['/var/run/routepilot/connection-events.json','/var/run/routepilot/cloud-directory-state.json']:['/var/run/routepilot/connection-events.json']).map(function(path){return fs.read(path).then(JSON.parse).catch(function(){return null;});})).then(function(files){
   var hasDirectory=center||page==='workers';updateConnectionHistory(files[files.length-(hasDirectory?2:1)]);if(hasDirectory)updateDirectory(files[files.length-1]);wizardStatus=files[0];wizardTest=files[2];if(center){updateBackup(files[6],files[7],files[0]);updateCloud(files[8]);updateScan(files[9]);updateRelays(files[10],files[11]);updateReceive(files[3],files[0]);updateDNS(files[4],files[5],files[0]);warpState=files[12]||warpState;exitObservation=files[13]||exitObservation;updateCenter();}if(page==='workers'){updateBackup(files[3],files[4],files[0]);updateCloud(files[5]);updateScan(files[6]);updateRelays(files[7],files[8]);}if(page==='overview'){updateOverview(files[0],files[2]);updateTraffic(files[3]);}
   if(page==='dns'){updateReceive(files[3],files[0]);updateDNS(files[4],files[5],files[0]);}
   updateWorkerProgress();updateWorkerFlow();
   if(hasDirectory&&!cloudDirectoryAuto&&!cloudBusy&&!workerActions.deploy&&cloudMeta.token_saved&&!cloudToken.value&&(!cloudDirectory||cloudDirectory.stale)&&!(cloudState&&['queued','running'].indexOf(cloudState.state)>=0)){cloudDirectoryAuto=true;cloudAction('verify',false);}
   var v=files[0],fresh=feedback.fresh(v,Date.now());if(v){
    if(switchPending){if(fresh&&v.applied_nonce===switchPending.nonce&&v.state===(switchEnabled?'running':'disabled')){switchText.textContent=switchEnabled?_('已开启，正在按保存的范围和规则接管网络。'):_('已关闭，本插件已退出接管；恢复此前的网络方式。');powerButton.disabled=false;switchPending=null;}else if(fresh&&v.state==='error'&&v.attempted_nonce===switchPending.nonce){switchText.textContent=_('开启失败：')+v.message;powerButton.disabled=false;switchPending=null;}else if(Date.now()-switchPending.started>45000){switchText.textContent=_('尚未收到切换确认，请查看实际运行状态。');powerButton.disabled=false;switchPending=null;}}
var exitName=v.backend==='worker'?(v.backup_name||_('Workers 备用')):directoryLabel(v.exit,catalog),message=v.message||v.state;if(!catalog.skipped&&v.state==='preparing'&&message==='登录环境已就绪；请完成邮箱登录，再自动读取出口')message=catalog.available?_('登录环境已就绪，分流尚未开启；已读到 ')+catalog.networks.length+_(' 个账户网络（未验证连通性）'):_('登录环境已就绪；出口目录暂未取得，可重新检查账户，或到分流设置刷新目录');status.textContent=String(message)+' · '+_('出口：')+exitName+' · IP '+String(v.exit_ip||'—')+' · '+(v.scope==='lan'?_('所选局域网'):_('接管设备：')+(Array.isArray(v.devices)?v.devices.length:0));status.style.color=fresh&&v.state==='running'?'#087443':v.state==='error'?'#b42318':'#555';if(!fresh){status.textContent=_('运行状态已过期，无法确认 WARP 或直连是否生效；请检查服务。');status.style.color='#a15c00';}
    if(pendingApply){var p=pendingApply;if(fresh&&v.applied_nonce===p.nonce&&['running','disabled','preparing'].indexOf(v.state)>=0){p.box.textContent=p.update?_('配置已应用，等待规则更新反馈…'):_('已应用成功：')+status.textContent;pendingApply=null;}else if(fresh&&v.state==='error'&&v.attempted_nonce===p.nonce){p.box.textContent=_('应用失败：')+v.message;pendingApply=null;pendingUpdate=null;}else if(Date.now()-p.started>45000){p.box.textContent=_('已提交，但尚未收到应用确认。请检查页面顶部的实际运行状态。');pendingApply=null;}}
   }else status.textContent=_('尚无运行状态，未能确认服务是否生效。');
   if(files[1])updateFeedback(files[1]);else rulesProgress.textContent=_('尚无更新记录；点击“规则与更新 → 立即更新规则”查看完整反馈。');
   var t=files[2];if(t){var detecting=feedback.diagnosticRunning(t,Date.now()),staleTest=feedback.diagnosticStale(t,v,Date.now())||((page==='dns'||center)&&(v&&v.applied_nonce!==wizardConfig().nonce||v&&v.backend!=='worker'&&v.exit!==configuredExit()||t.state==='done'&&(!Number.isFinite(Number(t.finished_at))||Date.now()/1000-Number(t.finished_at)>300))); testButton.disabled=detecting||((page==='dns'||center)&&(!feedback.fresh(v,Date.now())||v.state!=='running'));testsInfo.textContent=detecting?_('正在检测，最长约 10 秒…'):((t.state==='running'?_('检测已中断或超时，结果未知；可以重新检测。'):_('检测时间：')+when(t.finished_at))+' · '+_('代理出口：')+String(t.exit_ip||'—')+(staleTest?' · '+_('历史结果已过期，不能代表当前网络，请重新检测'):''));(t.results||[]).forEach(function(r){var c=testCells[r.id];if(!c)return;c.result.textContent=(staleTest?_('历史：'):'')+(r.message||_('等待检测'));c.result.style.color=staleTest?'#777':r.state==='ok'?'#087443':r.state==='pending'?'#2254d1':r.state==='restricted'?'#a15c00':'#b42318';c.delay.textContent=r.ms!=null?r.ms+' ms':'—';});}
   if(center||page==='advanced'||page==='basic'){renderDirectory();}
  });},2);
  function backup(){var sections=[];uci.sections('routepilot',null,function(c){sections.push(c);});var b=new Blob([JSON.stringify({format:'routepilot-masque-v2',sections:sections},null,2)],{type:'application/json'}),u=URL.createObjectURL(b);E('a',{href:u,download:'routepilot-settings.json'}).click();URL.revokeObjectURL(u);}
  function restore(file){if(!file||file.size>262144)return;file.text().then(function(raw){var b=JSON.parse(raw);if(b.format!=='routepilot-masque-v2'||!Array.isArray(b.sections)||b.sections.length>64)throw Error(_('备份格式无效'));var main=0,names={};b.sections.forEach(function(c){if(!/^[A-Za-z0-9_]{1,32}$/.test(c['.name']||'')||names[c['.name']]||['main','policy'].indexOf(c['.type'])<0)throw Error(_('配置节无效'));names[c['.name']]=1;if(c['.type']==='main'){if(c['.name']!=='main')throw Error(_('总配置名称无效'));main++;}Object.keys(c).forEach(function(k){if(k[0]!=='.'&&(!/^[a-z_][a-z0-9_]*$/.test(k)||!(typeof c[k]==='string'||Array.isArray(c[k])&&c[k].every(function(x){return typeof x==='string';}))))throw Error(_('配置字段无效'));});});if(main!==1)throw Error(_('缺少总配置'));uci.sections('routepilot',null,function(c){uci.remove('routepilot',c['.name']);});b.sections.forEach(function(c){var id=uci.add('routepilot',c['.type'],c['.name']);Object.keys(c).forEach(function(k){if(k[0]!=='.')uci.set('routepilot',id,k,c[k]);});uci.set('routepilot',id,'enabled','0');if(c['.type']==='main'){uci.set('routepilot',id,'preparing','0');uci.set('routepilot',id,'backend','masque');}});return uci.save().then(function(){return commitConfig('routepilot');});}).then(function(){notify(_('已导入并保存，插件保持关闭。刷新后查看设置；新路由器需重新登录。'));}).catch(function(e){notify(e.message,true);});}
  var backupCard=E('div',{class:'cbi-section'},[E('h3',{},_('配置备份与迁移')),E('p',{},_('仅导出本插件的分流、DNS 等设置；不含 WARP 登录身份、Cloudflare API 令牌或备用节点凭据。导入后保持关闭并默认选主线路；登录和备用凭据需另行配置。')),E('button',{class:'btn',click:backup},_('导出配置')),E('hr'),E('label',{},[_('导入配置文件：'),E('input',{type:'file',accept:'.json',change:function(ev){restore(ev.target.files[0]);}})]),E('p',{},_('导入后保持关闭，不修改原 SSR 节点或分流。'))]);
  function saveOrganizationOnly(){var org=organizationOption.formvalue('main');if(org==null)org=uci.get('routepilot','main','organization')||'';return fs.write('/var/run/routepilot/organization-input',JSON.stringify({organization:String(org).trim()}),384).then(function(){return command('warp-org-save');}).then(function(raw){var result=JSON.parse(raw);uci.set('routepilot','main','organization',result.organization);uci.set('routepilot','main','apply_nonce',result.nonce);committedOrganization=result.organization;delete wizardActions.org;updateWizard();return result;});}
  function countryName(code){return ({US:'美国',KR:'韩国',JP:'日本',SG:'新加坡',HK:'香港',TW:'台湾',DE:'德国',GB:'英国',CN:'中国',AU:'澳大利亚',CA:'加拿大'})[code]||code||_('未知');}
  var centerState=E('div',{role:'status','aria-live':'polite'}),centerCountry=E('span',{class:'rp-summary-tag',role:'status','aria-live':'polite'}),centerWarpAuth=E('span',{class:'rp-summary-tag'}),centerAPIAuth=E('span',{class:'rp-summary-tag'}),centerAuth=E('div',{class:'rp-auth-badges'},[centerWarpAuth,centerAPIAuth,centerCountry]),warpInfo=E('p',{role:'status','aria-live':'polite'});
  var centerReadBusy=false;
  function observationCurrent(row,st){return row&&st&&row.state==='done'&&feedback.fresh(st,Date.now())&&st.state==='running'&&['runtime_id','generation','applied_nonce','exit','backend'].every(function(k){return row[k]===st[k];})&&Date.now()/1000-row.time>=-5&&Date.now()/1000-row.time<=300;}
  function updateCenter(){
   var st=wizardStatus,fresh=feedback.fresh(st,Date.now()),running=fresh&&st&&st.state==='running';
   centerState.textContent=running?((st.backend==='worker'?_('当前使用 Workers 备用'):_('当前使用 WARP 主线路'))+' · '+_('实际协议：')+(st.protocol||_('尚未确认'))+(st.protocol_warning?_('（上次确认）'):'')+' · '+_('出口：')+(st.backend==='worker'?(st.backup_name||_('Workers 备用')):directoryLabel(st.exit,catalog))+' · IP '+(st.exit_ip||'—')):!fresh?_('○ 状态过期，当前连接未确认'):st&&st.state==='disabled'?_('○ 已关闭'):st&&st.message||_('○ 尚无运行状态');
   centerState.className=running?'rp-center-ok':'rp-help';
   var valid=observationCurrent(exitObservation,st);
   centerCountry.textContent=valid?_('本次观测出口地区：')+countryName(exitObservation.country)+' ('+exitObservation.country+')':exitObservation?_('○ 地区观测已过期或线路改变，可重新检测'):_('○ 出口地区尚未检测');
   var cfg=cloudState&&cloudState.configured!=null?cloudState:cloudMeta;
   centerWarpAuth.textContent=catalog.available||registeredHere||running&&st.backend!=='worker'?_('✓ WARP 已注册'):_('○ WARP 注册待确认');
   centerAPIAuth.textContent=cfg&&cfg.configured?_('✓ API 令牌已保存'):_('○ API 未保存');
   warpInfo.textContent=warpState&&warpState.state==='available'?_('读取到的客户端协议：')+warpState.protocol+' · '+({organization:_('组织策略'),local_policy:_('本机管理配置'),local:_('客户端设置'),mdm:_('本机管理文件'),routepilot:_('本路由器配置'),external_mdm:_('外部管理文件')}[warpState.source]||_('来源待确认'))+' · '+warpState.message:_('尚未读取到主线路协议信息；新安装先完成本组登录。');
   var labels={advanced:catalog.available?_('账户可读取'):_('账户待确认'),basic:running?_('已生效'):_('待确认'),devices:uci.get('routepilot','main','scope')==='lan'?_('当前按网络统一生效'):_('按设备设置'),dns:liveDNS&&feedback.dnsState(liveDNS,st,Date.now())==='running'?_('DNS 运行中'):_('DNS 待确认'),workers:running&&st.backend==='worker'?_('备用运行中'):backupNode&&backupNode.configured?_('已配置，未接管'):_('未配置')};
   Object.keys(centerGroupBadges||{}).forEach(function(k){centerGroupBadges[k].textContent=labels[k]||'';});
   centerRefresh.disabled=centerReadBusy;centerObserve.disabled=centerReadBusy||!running;
  }
  function centerRead(action){centerReadBusy=true;updateCenter();return command(action).then(function(raw){var result=JSON.parse(raw);if(action==='warp-info')warpState=result;else exitObservation=result;}).catch(function(e){notify(e.message,true);}).finally(function(){centerReadBusy=false;updateCenter();});}
  var centerRefresh=E('button',{class:'btn',click:function(){return centerRead('warp-info');}},_('刷新协议信息（只读）'));
  var centerObserve=E('button',{class:'btn',click:function(){return centerRead('exit-observe');}},_('检测实际出口国家 / 地区（不切换）'));
  var regionFilter=E('select',{'aria-label':_('出口地区筛选（账户名称提示）')},[E('option',{value:''},_('全部账户出口'))]);
  function activeCatalog(){if(!center||!regionFilter||!regionFilter.value)return catalog;var region=regionFilter.value;return Object.assign({},catalog,{filtered:true,networks:(catalog.networks||[]).filter(function(n){return region==='unknown'?!n.country_hint:n.country_hint===region;})});}
  function updateRegions(){var codes=Array.from(new Set((catalog.networks||[]).map(function(n){return n.country_hint;}).filter(Boolean))).sort(),old=regionFilter.value||'';regionFilter.replaceChildren(E('option',{value:''},_('全部账户出口')));codes.forEach(function(code){regionFilter.appendChild(E('option',{value:code},countryName(code)+_(' · 名称提示')));});regionFilter.appendChild(E('option',{value:'unknown'},_('名称未标明地区')));regionFilter.value=codes.indexOf(old)>=0||old==='unknown'?old:'';}
  regionFilter.addEventListener('change',function(){return updateExitChoices();});
  var centerGroups={},centerGroupBadges={};
  workerInventory=E('section',{class:'rp-worker-inventory','aria-label':_('Workers 节点与部署记录')});
  function openWorkerStage(key){Object.keys(workerStages).forEach(function(k){workerStages[k].open=k===key;workerStageOpen[k]=k===key;});}
  function workerPanel(key){if(!workerPanels[key])workerPanels[key]=E('div',{class:'rp-operation-feedback',role:'status','aria-live':'polite'});return workerPanels[key];}
  function workerOperationBusy(key){var op=workerActions[key];return !!(op&&(op.submitting||op.pending||op.waitingSwitch));}
  function startWorkerOperation(key,title,kind,action,job){workerActions[key]={title:title,kind:kind,action:action,started:Date.now(),submitting:true,pending:null,baseline:feedback.workerJobKey(job)};updateWorkerProgress();}
  function acceptWorkerOperation(key,result,async){var op=workerActions[key];if(!op)return;op.submitting=false;op.finished=Date.now();if(async&&result&&result.state==='submitted'){op.pending={started:op.started,baseline:op.baseline,action:op.action};}else if(async&&result&&result.state==='running'){op.result={state:'waiting',message:_('已有后台任务正在运行；本次没有重复创建或检测。请等待下方实际状态更新。')};}else if(async){op.result={state:'unknown',message:_('提交响应未给出明确任务状态，请只读检查结果；不能据此确认创建成功。')};}else{op.result={state:'success',message:result&&result.message||_('✓ 操作已完成并保存。')};}updateWorkerProgress();}
  function failWorkerOperation(key,message,state){var op=workerActions[key]||{};op.submitting=false;op.waitingSwitch=false;op.pending=null;op.finished=Date.now();op.result={state:state||'error',message:message};workerActions[key]=op;updateWorkerProgress();}
  function refreshWorkerMetadata(){return fs.exec('/usr/libexec/routepilot-backup-list',[]).then(function(r){if(r.code)throw Error(_('保存操作已完成，但节点列表读取失败；请刷新页面确认。'));var next=JSON.parse(r.stdout);if(next.cloud){cloudMeta=next.cloud;workerProjectRows=next.cloud.projects||[];workerProjectsAt=Number(next.cloud.projects_read_at||0);}if(next.node){backupNode=next.node;updateBackup(next.node,backupTest,wizardStatus);}updateWorkerProgress();});}
  function progressText(key,state,job,kind){
   var elapsed=_('已等待 ')+state.elapsed+_(' 秒'),count=state.total?_('已完成 ')+state.completed+'/'+state.total:'';
   if(state.state==='busy')return (state.phase==='awaiting'?_('请求已提交，正在等待后台接收确认'):state.message||_('后台正在处理'))+' · '+(count?count+' · ':'')+elapsed;
   if(state.state==='unknown')return _('较长时间未收到完成确认，当前结果未知；请只读检查状态，避免反复创建。')+' · '+elapsed;
   if(state.state==='error')return '✕ '+(state.message||_('操作未完成；请检查具体原因后重试。'));
   if(state.state==='waiting')return '! '+(state.message||_('仍在等待 DNS 或证书生效；稍后只读检查，无需重复创建。'));
   if(state.state==='warning')return '! '+(state.message||_('发现冲突或访问受限，请核对后再继续。'));
   if(key==='deploy'&&state.state==='success')return job&&job.state==='ready'?_('✓ Worker 与域名 HTTPS 已确认就绪；这不等于备用线路已经启用。'):job&&job.state==='verified'?_('✓ 账户和根域名读取完成；尚未因此创建节点。'):job&&job.state==='available'?_('✓ 名称和子域名占用检查通过；尚未创建节点。'):_('✓ 操作完成。');
   if(key==='relay'&&job&&job.state==='done'){
    var rows=job.results||[],passed=rows.filter(function(r){return r.state==='ok';}).length,enabled=relayValues().filter(function(r){return r.enabled;}),current=!relayDirty&&enabled.length&&enabled.every(function(r){var proof=relayRowProof(r.address);return relayCurrent(proof)&&proof.state==='ok'&&proof.forced===true;});
    state.state=current?'success':'warning';return (current?'✓ ':'! ')+_('逐项检测结束：通过 ')+passed+'/'+rows.length+(current?_('；请点击“应用已通过的主备顺序”，检测不会自动保存应用。'):_('；结果已过期、节点 / 候选改变或有项目未通过，请查看逐项结果。'));
   }
   if(key==='scan'&&job&&job.state==='done'){
    var age=Date.now()/1000-Number(job.finished_at),current=backupNode&&age>=-5&&age<=300&&(job.fingerprint===backupNode.fingerprint||job.applied_fingerprint===backupNode.fingerprint);
    state.state=current&&job.best_ip?'success':'warning';return current&&job.best_ip?'✓ '+_('本轮推荐入口：')+job.best_ip+(job.applied_fingerprint===backupNode.fingerprint?_('；已保存，下一步独立检测。'):_('；尚未应用。可应用推荐入口，也可保留原入口进入下一步。')):'! '+_('没有当前有效的推荐结果；历史结果或没有通过的入口不能当作已完成优化。');
   }
   if(key==='use'&&job&&job.state==='done'){
    state.state=workerFlow.tested?'success':'warning';return workerFlow.tested?'✓ '+_('当前节点基础联网检测通过，可手动启用；检测不会切换现有主线路。'):'! '+_('独立检测已结束，但未通过、已过期或节点已变化；当前不能据此启用备用。');
   }
   return state.message||_('尚未开始；执行操作后会在这里显示接收确认、真实进度和结果。');
  }
  function updateWorkerInventory(){
   if(!workerInventory)return;var node=backupNode||(data[5]&&data[5].node),st=wizardStatus,running=feedback.fresh(st,Date.now())&&st.state==='running'&&st.backend==='worker';
   var signature=JSON.stringify([node,workerProjectRows,running,workerFlow.tested]);if(signature===workerInventory._signature)return;workerInventory._signature=signature;
   var saved=E('div',{class:'rp-node-summary'},[E('h4',{},_('当前保存的备用节点')),E('p',{},node&&node.configured?'✓ '+_('已保存到路由器 · ')+(node.name||node.sni||_('备用节点')):_('○ 还没有保存备用节点；创建就绪后需点“将新部署设为备用节点”，或在④导入已有节点。'))]);
   if(node&&node.configured){saved.appendChild(E('p',{},_('验证域名：')+node.sni+' · '+_('连接入口：')+node.address+':'+node.port));saved.appendChild(E('p',{},running?_('✓ 备用正在运行'):st&&st.backend==='worker'?_('! 已选择备用，实际运行状态待确认'):_('○ 备用未启用，现有主线路仍在使用')));saved.appendChild(E('p',{class:'rp-help'},workerFlow.tested?_('✓ 当前节点有有效的独立检测结果'):_('○ 当前节点未检测、结果已过期或节点已改变；请到④重新检测')));}
   saved.appendChild(E('button',{class:'btn',click:function(){workerPinned=true;openWorkerStage('use');}},_('查看保存节点 / 进入独立检测')));
   var created=E('div',{class:'rp-created-nodes'},[E('h4',{},_('本路由器创建的云端节点'))]);
   if(!workerProjectRows.length)created.appendChild(E('p',{class:'rp-help'},_('暂无本路由器创建记录。已有导入节点仍显示在上方；授权或读取域名不会自动创建节点。')));
   workerProjectRows.forEach(function(row){created.appendChild(E('div',{class:'rp-created-node'},[E('strong',{},row.script),E('span',{},row.hostname),E('span',{class:'rp-help'},(row.uploaded?_('✓ Worker 已上传'):_('○ 已预留，上传待确认'))+' · '+(row.bound?_('✓ 域名已绑定'):_('○ 域名尚未确认'))+' · '+(row.saved_as_backup?_('✓ 已保存为当前备用'):_('○ 未保存为当前备用')))]));});
   created.appendChild(E('p',{class:'rp-help'},_('云端项目来自本机部署记录，不代表当前都能联网。创建、绑定、保存为备用、手动启用是四种不同状态。')));
   workerInventory.replaceChildren(E('h3',{},_('备用节点与云端部署记录')),workerActivity,saved,created);
  }
  function updateWorkerProgress(){
   if(!workerInventory)return;
   var jobs={deploy:cloudState||cloudDirectoryJob,relay:relayTest,scan:scanState,use:backupTest};
   ['deploy','relay','scan','use'].forEach(function(key){
    var op=workerActions[key],job=op&&op.completedJob|| (op&&op.kind==='directory'?cloudDirectoryJob:jobs[key]),kind=op?op.kind:key==='deploy'?'cloud':key==='use'?'backup':key;
    var display=op&&op.submitting?{state:'busy',phase:'submitting',elapsed:Math.max(0,Math.floor((Date.now()-op.started)/1000)),completed:0,total:0,message:_('正在提交操作，请勿重复点击…')}:op&&op.result?Object.assign({elapsed:0,completed:0,total:0},op.result):feedback.workerJobProgress(job,op&&op.pending,Date.now(),kind,key==='use'?5:0);
    var message=op&&op.result?display.message:progressText(key,display,job,kind);
    if(op&&op.pending&&display.matched&&['busy','unknown'].indexOf(display.state)<0){op.pending=null;op.completedJob=job;}
    if(key==='deploy'&&workerFlow.cloudDirty&&display.state==='success'&&!(op&&op.result)){display.state='warning';message=_('这是上次保存目标的结果；表单有未保存编辑，不能代表新目标已经创建。');}
    if(op&&op.waitingSwitch){display.state='busy';display.elapsed=Math.max(0,Math.floor((Date.now()-op.started)/1000));message=_('切换请求已提交，正在等待实际运行状态确认…')+' · '+_('已等待 ')+display.elapsed+_(' 秒');}
    if(op&&op.pending&&display.state==='unknown'){op.pending=null;op.result={state:'unknown',message:message,elapsed:display.elapsed};}
    if(op)op.display=display;workerDisplays[key]=display;workerMessages[key]=message;
    var panel=workerPanel(key),title=op&&op.title||({deploy:_('部署与授权操作结果'),relay:_('PROXYIP 检测 / 应用结果'),scan:_('入口优选结果'),use:_('备用节点独立检测结果')})[key],stamp=op&&op.finished&&!workerOperationBusy(key)?when(op.finished/1000):job&&job.finished_at&&!workerOperationBusy(key)?when(job.finished_at):'',signature=JSON.stringify([title,display,message,stamp,workerFlow.tested]);
    if(panel._signature===signature)return;panel._signature=signature;panel.setAttribute('data-state',display.state);panel.setAttribute('aria-busy',display.state==='busy'?'true':'false');
    var children=[E('strong',{},title),E('p',{},message)];if(display.total)children.push(E('progress',{max:display.total,value:Math.min(display.completed,display.total),'aria-label':_('实际已完成项目')}));
    if(key==='deploy'&&job&&['deploy','check'].indexOf(job.action)>=0&&!(op&&op.kind==='directory')&&!(op&&op.result)){
     var waitingForNew=!!(op&&(op.submitting||op.pending)&&!display.matched);var steps=[_('项目归属与占用'),_('Worker 上传 / 存在'),_('子域名绑定'),_('DNS 与 HTTPS 证书')],index={connecting:0,checking:0,uploading:1,binding:2,waiting_dns:3}[job.phase],ready=job.state==='ready'&&!workerFlow.cloudDirty&&!waitingForNew;if(waitingForNew)index=-1;else if(job.state==='waiting_dns')index=3;children.push(E('ol',{class:'rp-job-steps'},steps.map(function(label,i){var tone=ready?'success':Number.isFinite(index)&&i<index?'success':i===index?display.state==='error'?'error':'busy':'pending';return E('li',{'data-state':tone},(tone==='success'?'✓ ':tone==='error'?'✕ ':tone==='busy'?'… ':'○ ')+label+(i===index&&display.state==='busy'?_(' · 正在处理'):''));})));
    }
    if(stamp)children.push(E('small',{},_('结果记录时间：')+stamp));
    if(['success','warning','waiting'].indexOf(display.state)>=0){var next=key==='deploy'?backupNode&&backupNode.configured&&backupNode.sni===cloudHost.value?'relay':'deploy':key==='relay'?'relay':key==='scan'?'use':'use',text=key==='deploy'?next==='relay'?_('下一步：配置 / 检测 PROXYIP'):_('下一步：在①检查或保存为备用节点'):key==='relay'?relayApply&&!relayApply.disabled?_('下一步：应用已通过的主备顺序'):_('查看候选与逐项结果'):key==='scan'?_('保留当前入口，前往④独立检测'):_('查看保存节点与检测结果');children.push(E('button',{class:'btn',click:function(){workerPinned=true;openWorkerStage(next);}},text));}
    panel.replaceChildren.apply(panel,children);
   });updateWorkerInventory();
   var keys=['deploy','relay','scan','use'],recent=keys.filter(function(k){return workerActions[k];}).sort(function(a,b){return workerActions[b].started-workerActions[a].started;})[0]||keys.filter(function(k){return jobs[k]&&jobs[k].started_at;}).sort(function(a,b){return Number(jobs[b].started_at)-Number(jobs[a].started_at);})[0];
   if(recent){var d=workerDisplays[recent],a=workerActions[recent],title=({deploy:_('① 部署与授权'),relay:_('② PROXYIP'),scan:_('③ 优选入口'),use:_('④ 保存与独立检测')})[recent],text=(a?a.title:title)+' · '+workerMessages[recent],signature=JSON.stringify([recent,d&&d.state,text]);if(workerActivity._signature!==signature){workerActivity._signature=signature;workerActivity.setAttribute('data-state',d&&d.state||'idle');workerActivity.replaceChildren(E('strong',{},_('最近操作结果（展开下一步后仍保留）')),E('p',{},text));}}
  }
  function workerStage(key,title,card){var summary=E('summary',{},[E('span',{},title),workerBadges[key]=E('span',{class:'rp-group-state'})]),box=E('details',{class:'rp-worker-stage','data-stage':key},[summary,E('div',{class:'rp-worker-stage-body'},card)]);box.open=!!workerStageOpen[key];summary.addEventListener('click',function(){workerPinned=true;});box.addEventListener('toggle',function(){workerStageOpen[key]=box.open;});workerStages[key]=box;return box;}
  function workerActionStage(key){workerPinned=false;openWorkerStage(key);}
  function updateWorkerFlow(){
   if(!Object.keys(workerStages).length)return;
   var node=backupNode||(data[5]&&data[5].node),configured=!!(node&&node.configured),now=Date.now()/1000;
   var imported=configured&&!(cloudMeta.configured||cloudState&&cloudState.configured),deployed=!!workerFlow.deployed;
   var relayApplied=configured&&!relayDirty&&!!relaySavedHash&&node.relay_order_hash===relaySavedHash;
   var scanCurrent=scanState&&scanState.state==='done'&&configured&&now-Number(scanState.finished_at)>=-5&&now-Number(scanState.finished_at)<=300&&(scanState.fingerprint===node.fingerprint||scanState.applied_fingerprint===node.fingerprint);
   var relayEnabled=relayValues().filter(function(r){return r.enabled;}),relayPassed=!relayDirty&&relayTest&&relayTest.state==='done'&&relayEnabled.length&&relayEnabled.every(function(r){var proof=relayRowProof(r.address);return relayCurrent(proof)&&proof.state==='ok'&&proof.forced===true;});
   var scanned=!!(scanCurrent&&scanState.best_ip),scanApplied=!!(scanned&&scanState.applied_fingerprint===node.fingerprint),tested=!!workerFlow.tested;
   var states={deploy:imported?_('已有导入节点'):deployed&&configured&&node.sni===cloudHost.value?_('✓ 已部署并设为备用'):deployed?_('部署就绪，待设为备用'):_('○ 待部署 / 检查'),relay:relayDirty?_('有未保存编辑'):relayApplied?_('✓ 顺序已应用'):relayPassed?_('✓ 检测通过，待应用顺序'):_('○ 待检测 / 应用'),scan:scanApplied?_('✓ 已应用，待整线检测'):scanned?_('✓ 推荐可用，待应用'):_('○ 可选：保留原入口'),use:tested?_('✓ 检测有效，可手动启用'):_('○ 待独立检测')};
   Object.keys(workerBadges).forEach(function(k){var op=workerActions[k],d=workerDisplays[k];workerBadges[k].textContent=d&&d.state==='busy'?'… '+(op&&op.title||_('后台正在处理'))+' · '+_('已等待 ')+d.elapsed+'s':d&&d.state==='error'?_('✕ 操作失败，查看本步结果'):d&&d.state==='unknown'?_('! 结果未确认，查看本步提示'):states[k];workerStages[k].setAttribute('data-state',d&&['busy','error','unknown','waiting'].indexOf(d.state)>=0?d.state:states[k].indexOf('✓')===0?'success':'pending');});
   if(workerPinned)return;
   var cloudRunning=cloudBusy||workerOperationBusy('deploy')||cloudState&&['queued','running'].indexOf(cloudState.state)>=0&&now-Number(cloudState.started_at)<300;
   var scanRunning=scanBusy||workerOperationBusy('scan')||scanState&&['queued','running'].indexOf(scanState.state)>=0&&now-Number(scanState.started_at)<300;
   var key=cloudRunning?'deploy':relayBusy||workerOperationBusy('relay')||relayTaskRunning()?'relay':scanRunning?'scan':workerFlow.testing||tested?'use':!configured||!imported&&!(deployed&&node.sni===cloudHost.value)?'deploy':!relayApplied?'relay':!scanned?'scan':scanApplied?'use':'scan';
   openWorkerStage(key);
  }
  function defaultCenterOpen(id){var hash=(window.location.hash||'').replace('#rp-center-','');if(hash)return id===hash;if(!catalog.available&&uci.get('routepilot','main','enabled')!=='1')return id==='advanced';return id==='basic'||id==='devices'&&uci.get('routepilot','main','scope')==='devices';}
  function centerGroup(id,title,description,children){
   var box=E('details',{class:'rp-center-group',id:'rp-center-'+id,open:Object.prototype.hasOwnProperty.call(centerOpen,id)?centerOpen[id]:defaultCenterOpen(id)},[E('summary',{},[E('span',{},title),centerGroupBadges[id]=E('span',{class:'rp-group-state'})]),E('div',{class:'rp-center-body'},[E('p',{class:'rp-help'},description)].concat(children.filter(Boolean)))]);
   box.open=Object.prototype.hasOwnProperty.call(centerOpen,id)?centerOpen[id]:defaultCenterOpen(id);centerGroups[id]=box;return box;
  }
  function buildCenter(node,force){
   if(centerComposed===node&&!force)return [node];
   function fields(group){return E('div',{},centerFields[group].map(function(o){return node.querySelector('[id="cbi-routepilot-main-'+o.option+'"]');}).filter(Boolean));}
   var guide=node.querySelector('.rp-guide'),protocol=node.querySelector('[id="cbi-routepilot-main-warp_protocol"]');
   var top=E('section',{class:'cbi-section rp-center-summary'},[centerState,E('div',{class:'rp-summary-bottom'},[centerAuth,E('div',{class:'rp-summary-actions'},[centerRefresh,centerObserve])])]);
   updateRegions();updateCenter();
   var groups=[top,
    centerGroup('advanced',_('1. 主线路账户与连接协议'),_('沿用已注册账户。MASQUE 与 WireGuard 都使用官方客户端；只有保存并应用所选协议后才重连，本轮保持当前设置。'),[warpInfo,protocol,guide]),
    centerGroup('basic',_('2. 账户出口、国家 / 地区与接管范围'),_('要固定某地区，选择已部署的对应出口，再检测实际出口。默认 WARP 和 Workers 不是任意国家选择器，优选 IP 只改变入口。地区筛选来自账户名称，仅辅助查找，不是实测定位，不会自动选择出口。'),[E('label',{class:'rp-cloud-field'},[E('span',{},_('按出口名称中的地区筛选')),regionFilter]),fields('basic')]),
    centerGroup('devices',_('3. 设备分流'),_('保留现有设备表；局域网模式按上面的范围设置，设备表只有按设备模式生效。'),[centerDeviceNode]),
    centerGroup('dns',_('4. DNS 与联网检测'),_('DNS 设置和真实联网结果在一起；缓存清理、只读检测不会保存其他表单。历史结果失效时会明确标记。'),[fields('dns'),dnsCacheCard,dnsTestCard,testCard,connectionHistory,E('details',{class:'rp-guide-step'},[E('summary',{},_('接收队列与丢包观测')),receiveCard])]),
    centerGroup('workers',_('5. Workers 备用与 Cloudflare API 授权'),_('在路由器读取授权账户和域名、创建 Worker、绑定子域名、管理 PROXYIP、优选入口并独立检测。备用仍需手动启用；保留现有主线路。'),[workerInventory,E('p',{class:'rp-help'},E('a',{href:'#',click:function(ev){if(ev&&ev.preventDefault)ev.preventDefault();workerPinned=true;openWorkerStage('use');}},_('已有节点？保留原入口，直接到④独立检测 →'))),workerStage('deploy',_('① 创建部署与 API 授权'),cloudCard,!(cloudMeta&&cloudMeta.configured)),workerStage('relay',_('② PROXYIP 主用与备用'),relayCard,false),workerStage('scan',_('③ 优选 Cloudflare 入口'),scanCard,false),workerStage('use',_('④ 独立测试与手动启用'),workerBackupCard,!!(cloudMeta&&cloudMeta.configured))])];
   groups.push(E('p',{class:'rp-save-hint'},_('页面底部“保存并应用”提交本地设置；读取、检测和清缓存不会提交编辑。云端部署和备用节点按钮分别立即执行其注明的操作。')));node.replaceChildren.apply(node,groups);centerComposed=node;updateCenter();updateWorkerProgress();updateWorkerFlow();return [node];
  }
  if(page==='rules'&&typeof m.renderContents==='function'){var renderRules=m.renderContents.bind(m);m.renderContents=function(){return renderRules.apply(null,arguments).then(function(node){var fields=['china_url','china_domains_url','gfw_url','whitelist_url','update_hours'].map(function(k){return node.querySelector('[id="cbi-routepilot-main-'+k+'"]');}).filter(Boolean);if(fields.length)node.appendChild(E('details',{class:'rp-stat-details'},[E('summary',{},_('规则来源与更新间隔（高级）')),E('div',{},fields)]));return node;});};}
  if(center&&typeof m.renderContents==='function'){var renderMap=m.renderContents.bind(m);m.renderContents=function(){Object.keys(centerGroups).forEach(function(id){centerOpen[id]=centerGroups[id].open;});return renderMap.apply(null,arguments).then(function(node){buildCenter(node,true);return node;});};}

  var content=page==='overview'?[overviewHero,trafficCard,nodeCard,quickCard,connectionHistory,versionInfo]:page==='advanced'?[statusCard]:page==='rules'?[rulesCard]:page==='dns'?[]:page==='backup'?[backupCard]:page==='workers'?[cloudCard,relayCard,scanCard,workerBackupCard]:[];
  return (formPage?m.render():Promise.resolve(null)).then(function(node){if(center){content=buildCenter(node);}else if(node){var title=node.querySelector('h2');if(title)title.remove();var intro=node.querySelector('.cbi-map-descr');if(intro)intro.remove();if(page==='dns')content=[node,dnsCacheCard,dnsTestCard,testCard,E('details',{class:'rp-guide-step'},[E('summary',{},_('高级诊断：接收队列与丢包')),receiveCard])];else if(page==='basic')content=[node,E('section',{class:'cbi-section'},[E('h3',{},_('另一种连接方式')),E('a',{class:'btn',href:base+'/cloudflare#rp-center-workers'},_('打开 Cloudflare 备用线路 →'))])];else content.push(node);}return E('div',{class:'rp-layout','data-page':page},[E('link',{rel:'stylesheet',href:L.resource('routepilot/style_5539f87b8a7e.css')}),E('div',{class:'rp-header'},[E('span',{class:'rp-brand'},'RoutePilot'),E('h2',{},pageInfo[1]),E('p',{class:'rp-caption'},pageInfo[2])]),E('div',{class:'rp-page-content'},content)]);});
 },
 handleSaveApply:function(){return this.applySettings();},
 handleReset:null
});
