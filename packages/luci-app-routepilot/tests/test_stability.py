from input_fixture import stage
import json,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import Mock,patch
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'root/usr/lib/routepilot'))
import mplane,masque,auth_control as auth
from public_errors import ControlError

class StabilityTest(unittest.TestCase):
 def test_optional_protocol_query_failure_preserves_main_client(self):
  p=mplane.Plane();p.client_pid=123;p.protocol='MASQUE';p.protocol_preference='MASQUE';p.protocol_checked=mplane.time.monotonic()-31
  with patch.object(mplane,'cli',side_effect=RuntimeError('private diagnostic')),patch.object(mplane.os,'readlink',side_effect=OSError()),patch.object(p,'stop') as stop:
   p.optimize();stop.assert_not_called();self.assertEqual(p.protocol,'MASQUE');self.assertIn('上次确认值',p.protocol_warning);self.assertNotIn('private',p.protocol_warning)
 def test_verified_protocol_mismatch_is_not_hidden(self):
  p=mplane.Plane();p.client_pid=123;p.protocol='MASQUE';p.protocol_preference='MASQUE';p.protocol_checked=mplane.time.monotonic()-31
  with patch.object(mplane,'cli',return_value=SimpleNamespace(stdout='WARP tunnel protocol: WireGuard')):
   with self.assertRaises(ValueError):p.optimize()
 def test_transient_tunnel_withdraws_capture_without_killing_client(self):
  s=masque.Service();s.plane=Mock();s.dns=Mock();s.compiled={'kept':'before'}
  with patch.object(masque,'cli',side_effect=[SimpleNamespace(stdout='Status update: Connecting'),SimpleNamespace(stdout='Status update: Connected')]),patch.object(s,'withdraw',return_value=True):
   with self.assertRaises(masque.TunnelPending):s.tunnel_ready()
   self.assertTrue(s.suspend_capture());s.plane.stop.assert_not_called();s.dns.stop.assert_called_once();self.assertIsNone(s.compiled)
   s.tunnel_ready();self.assertIsNone(s.recovery_started)
 def test_persistent_tunnel_failure_has_bounded_recovery_window(self):
  s=masque.Service();s.recovery_started=1
  with patch.object(masque.time,'monotonic',return_value=22),patch.object(masque,'cli',return_value=SimpleNamespace(stdout='Status update: Connecting')):
   with self.assertRaisesRegex(RuntimeError,'等待超时'):s.tunnel_ready()
   self.assertIsNone(s.recovery_started)
 def test_event_history_is_bounded_and_does_not_copy_error_text(self):
  with tempfile.TemporaryDirectory() as folder,patch.object(masque,'RUN',Path(folder)),patch.object(masque,'_last_event',None):
   for i in range(45):masque.output('error' if i%2 else 'running','never copy a private diagnostic',runtime_id=str(i),recovering=bool(i%2))
   d=json.loads((Path(folder)/'connection-events.json').read_text());self.assertEqual(len(d['events']),40);self.assertNotIn('private',json.dumps(d))

class AuthTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.run=self.root/'run';self.run.mkdir();self.identity=self.root/'var/lib/cloudflare-warp';self.identity.mkdir(parents=True)
  self.cfg={'main':{'enabled':'0','organization':'Test-Team'}}
  (self.run/'status.json').write_text(json.dumps(dict(state='preparing',time=time.time())))
  for name,value in [('RUN',self.run),('ROOT',self.root),('read_config',lambda:self.cfg)]:
   p=patch.object(auth,name,value);p.start();self.addCleanup(p.stop)
 def input(self):
  p=self.run/'auth-input';p.write_text('com.cloudflare.warp://test-team.cloudflareaccess.com/auth?token=test-only');p.chmod(0o600);return p
 def test_existing_registration_never_replaced_by_login_or_token(self):
  (self.identity/'reg.json').write_text('existing private identity');p=self.input()
  with patch.object(auth,'cli') as cli:
   with self.assertRaises(ControlError):auth.login()
   with self.assertRaises(ControlError):auth.register(stage(auth.RUN/'auth-input'))
   cli.assert_not_called();self.assertFalse(p.exists());self.assertEqual((self.identity/'reg.json').read_text(),'existing private identity')
 def test_running_main_refuses_registration(self):
  self.cfg['main']['enabled']='1'
  with patch.object(auth,'cli') as cli:
   with self.assertRaises(ControlError):auth.login()
   cli.assert_not_called()
 def test_first_setup_is_single_owned_flow_and_retry_reuses_it(self):
  with patch.object(auth,'cli') as cli:
   self.assertEqual(auth.login(),'https://test-team.cloudflareaccess.com/warp');self.assertEqual(auth.login(),'https://test-team.cloudflareaccess.com/warp');self.assertEqual(cli.call_count,1)
   self.input();auth.register(stage(auth.RUN/'auth-input'));self.assertEqual(cli.call_count,2);self.assertFalse((self.run/'auth-pending.json').exists())
 def test_changed_or_expired_pending_request_cannot_register(self):
  with patch.object(auth,'cli') as cli:
   auth.login();(self.identity/'reg.json').write_text('another identity');self.input()
   with self.assertRaises(ControlError):auth.register(stage(auth.RUN/'auth-input'))
   self.assertEqual(cli.call_count,1)
 def test_organization_is_normalized_and_invalid_labels_refused(self):
  self.assertEqual(auth.organization(' Test-Team '),'test-team')
  for value in ['-team','team-','https://team','a.b',None]:
   with self.assertRaises(ControlError):auth.organization(value)
if __name__=='__main__':unittest.main()
