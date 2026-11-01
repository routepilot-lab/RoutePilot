import hashlib,contextlib,json,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'root/usr/lib/routepilot'))
import config_backup as b
import endpoint_control as e
import worker_backend

class ConfigBackup(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.p=Path(self.temp.name)
  for module,names in [(b,{'INPUT':'input','UCI':'routepilot','RUN':'run'}),(e,{'CONFIG':'endpoint.json','TRANSACTION':'txn','APPLIED':'applied','RUN':'run','RECOVERY':'recovery','PROCESS_BLOCK':'run/process-block'})]:
   for name,file in names.items():
    pt=patch.object(module,name,self.p/file);pt.start();self.addCleanup(pt.stop)
  b.RUN.mkdir();b.UCI.write_text('old config\n');self.doc={'format':'routepilot-masque-v3','sections':[{'.name':'main','.type':'main','enabled':'1','preparing':'1','backend':'worker','organization':"a'b"},{'.name':'phone','.type':'policy','enabled':'1','mode':'direct'}],'endpoint':{'mode':'manual','address':'162.159.197.2:8443','hours':12}}
  pt=patch.object(worker_backend,'guard',contextlib.nullcontext);pt.start();self.addCleanup(pt.stop)
 def import_input(self):
  payload=json.loads(b.INPUT.read_text());b.INPUT.write_text(json.dumps({'request_id':'a'*32,'payload':payload}))
  return b.import_settings('a'*32+':'+hashlib.sha256(b.INPUT.read_bytes()).hexdigest())
 def test_v3_stages_preferences_and_disables_all_policies(self):
  rows,cfg=b.validate(self.doc);self.assertTrue(cfg['staged']);self.assertEqual(cfg['revision'],'');self.assertEqual(rows[0]['backend'],'masque');self.assertTrue(all(x['enabled']=='0' for x in rows));self.assertEqual(cfg['hours'],12)
 def test_v2_does_not_inherit_target_pending_entry(self):
  d=dict(self.doc);d['format']='routepilot-masque-v2';d.pop('endpoint');_,cfg=b.validate(d);self.assertEqual(cfg['mode'],'preserve');self.assertTrue(cfg['staged'])
 def test_no_identity_or_transaction_fields_accepted(self):
  for key in ['private_key','revision','staged','api_token']:
   d=json.loads(json.dumps(self.doc));d['endpoint'][key]='secret'
   with self.assertRaises(ValueError):b.validate(d)
 def test_injection_and_invalid_sections_rejected(self):
  for mutate in [lambda d:d['sections'][0].update(organization='a\nconfig main evil'),lambda d:d['sections'].append(d['sections'][0]),lambda d:d['sections'][0].update({'.name':'bad'}),lambda d:d['endpoint'].update(address='127.0.0.1:443')]:
   d=json.loads(json.dumps(self.doc));mutate(d)
   with self.assertRaises(ValueError):b.validate(d)
 def test_uci_quotation_is_literal(self):
  rows,_=b.validate(self.doc);text=b.render(rows);self.assertIn("option organization 'a'\\''b'",text);self.assertNotIn('enabled \'1\'',text)
 def fake_uci(self,args,**kw):
  if 'commit' in args:(Path(args[2])/'routepilot').write_text('validated imported config\n')
  return SimpleNamespace(returncode=0,stdout='')
 def test_import_commits_only_after_parser_accepts(self):
  b.INPUT.write_text(json.dumps(self.doc))
  with patch.object(b,'command',side_effect=self.fake_uci):r=self.import_input()
  self.assertTrue(r['endpoint_staged']);self.assertTrue(e.settings()['staged']);self.assertEqual(b.UCI.read_text(),'validated imported config\n');self.assertTrue(b.INPUT.exists())
 def test_parser_failure_leaves_both_settings_untouched(self):
  e.CONFIG.write_text('{}');b.INPUT.write_text(json.dumps(self.doc))
  with patch.object(b,'command',side_effect=RuntimeError('parse failed')),self.assertRaises(RuntimeError):self.import_input()
  self.assertEqual(b.UCI.read_text(),'old config\n');self.assertEqual(e.CONFIG.read_text(),'{}')
 def test_second_write_failure_restores_both_settings(self):
  e.CONFIG.write_text('{}');b.INPUT.write_text(json.dumps(self.doc));real=b.atomic
  failed=[False]
  def atomic(path,text,*args):
   if path==b.UCI and text.startswith('validated') and not failed[0]:failed[0]=True;raise OSError('disk')
   return real(path,text,*args)
  with patch.object(b,'command',side_effect=self.fake_uci),patch.object(b,'atomic',side_effect=atomic),self.assertRaises(OSError):self.import_input()
  self.assertEqual(b.UCI.read_text(),'old config\n');self.assertEqual(e.CONFIG.read_text(),'{}')
 def test_unfinished_transaction_prevents_import(self):
  e.TRANSACTION.write_text('{}');b.INPUT.write_text(json.dumps(self.doc))
  with patch.object(b,'command') as cmd,self.assertRaises(ValueError):self.import_input()
  cmd.assert_not_called();self.assertEqual(b.UCI.read_text(),'old config\n')
 def test_export_only_preferences_excludes_journal(self):
  e.CONFIG.write_text(json.dumps({'mode':'manual','address':'162.159.197.2:443','hours':6,'revision':'request'}));values={'main':self.doc['sections'][0]}
  with patch.object(b,'command',return_value=SimpleNamespace(stdout=json.dumps({'values':values}))):d=b.export()
  self.assertEqual(set(d['endpoint']),{'mode','address','hours'});self.assertNotIn('revision',d['endpoint']);self.assertEqual(d['format'],'routepilot-masque-v3')
 def test_firmware_restore_is_staged_without_replaying_journal(self):
  e.CONFIG.write_text(json.dumps({'mode':'manual','address':'162.159.197.2:443','revision':'old'}));e.stage_restored_preferences();self.assertTrue(e.settings()['staged']);self.assertEqual(e.settings()['revision'],'')
 def test_normal_restart_keeps_applied_preference(self):
  e.CONFIG.write_text(json.dumps({'mode':'manual','address':'162.159.197.2:443','revision':'old'}));e.APPLIED.write_text('{"revision":"old","state":"applied"}');before=e.CONFIG.read_bytes();e.stage_restored_preferences();self.assertEqual(e.CONFIG.read_bytes(),before)
if __name__=='__main__':unittest.main()
