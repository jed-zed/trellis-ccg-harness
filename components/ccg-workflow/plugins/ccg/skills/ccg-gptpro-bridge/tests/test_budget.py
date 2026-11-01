import contextlib
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import gptpro_budget as b
import gptpro_bridge as bridge
THREAD='11111111-1111-4111-8111-111111111111'
class BudgetTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.state=self.root/'budget.json'
  self.job={'importance':'step','risk':'low','complexity':2,'goal':'check one bounded transformation','snapshot':'fixture-source-v1','acceptance':'local tests pass','inputs':[]}
 def tearDown(self):self.temp.cleanup()
 def enable(self,**limits):b.configure(self.state,'save-codex',THREAD,limits,evidence_access='summary')
 def prepare(self,**kwargs):return b.prepare(self.state,self.job,'bounded fixture evidence',self.root,**kwargs)
 def session(self,prepared):
  record=b.load(self.state)['requests'][prepared['requestId']]
  s=bridge.create_session(mode='exc',workdir=self.root,prompt=Path(record['briefFile']).read_text(encoding='utf-8'),slug='fixture',output_root=self.root/'sessions',round_number=1,followup_session=None,followup_reason=None,thinking_mode=record['thinkingMode'],project_context={},codex_thread_id=THREAD)
  b.attach(self.state,prepared['requestId'],s)
  folder=s.prompt_file.parent/'sidebar';folder.mkdir();adapter={'phase':'pre-invoke-failed','codexThreadId':THREAD,'idempotencyKeySha256':b.digest(record['idempotencyKey'].encode()),'promptSha256':bridge.sha256_sidebar_prompt_path(s.prompt_file),'thinkingMode':record['thinkingMode'],'attemptCount':0,'invokeAttempted':False}
  bridge.write_json_atomic(folder/'state.json',adapter);return s,folder,adapter
 def test_default_and_disabled_leave_ordinary_routing_unchanged(self):
  self.assertEqual(self.prepare()['action'],'ordinary-ccg');self.assertFalse(self.state.exists())
  b.configure(self.state,'standard');self.assertEqual(self.prepare()['action'],'ordinary-ccg')
 def test_enabled_bounded_steps_use_extra_high(self):
  self.enable();p=self.prepare();self.assertEqual(p['thinkingMode'],'Extra High');self.assertEqual(p['newWebRequests'],0);self.assertTrue(p['authorizationRequiredForNewSend'])
 def test_critical_risk_complexity_escalate_to_pro(self):
  for changes in [{'importance':'critical'},{'risk':'high'},{'complexity':4},{'decision':'hard-diagnosis'},{'decision':'security'}]:
   self.assertEqual(b.route_mode(dict(self.job,**changes))[0],'Pro')
 def test_explicit_user_choice_has_priority(self):
  self.assertEqual(b.route_mode(dict(self.job,importance='critical'), 'extra-high')[0],'Extra High')
  self.assertEqual(b.route_mode(dict(self.job,thinkingMode='Medium'))[0],'Medium')
 def test_pending_duplicate_reuses_original_identity_without_new_request(self):
  self.enable();a=self.prepare();d=self.prepare();self.assertEqual(d['action'],'resume-existing');self.assertEqual(a['requestId'],d['requestId']);self.assertEqual(len(b.load(self.state)['requests']),1)
 def test_call_pro_and_concurrency_limits_do_not_trigger_codex_fallback(self):
  self.enable(maxRequests=1);self.prepare();self.job['snapshot']='new';self.assertEqual(self.prepare()['action'],'pause')
  b.configure(self.state,'save-codex',limits={'maxRequests':8,'maxConcurrency':1});self.assertEqual(self.prepare()['action'],'queue')
  b.configure(self.state,'save-codex',limits={'maxConcurrency':3,'maxProRequests':0});self.assertEqual(self.prepare(explicit='Pro')['action'],'pause')
 def test_documented_limit_flags_configure_bounded_limits(self):
  skill=(Path(__file__).parents[2]/'ccg-save-codex'/'SKILL.md').read_text(encoding='utf-8')
  self.assertEqual(sorted(set(re.findall(r'--max-[a-z-]+',skill))),['--max-concurrency','--max-pre-invoke-retries','--max-pro-requests','--max-requests','--max-web-attempts'])
  base=['configure','--state',str(self.state),'--mode','save-codex','--codex-thread-id',THREAD]
  out=io.StringIO()
  with contextlib.redirect_stdout(out):self.assertEqual(b.main([*base,'--max-requests','5','--max-pro-requests','1','--max-web-attempts','10','--max-concurrency','3','--max-pre-invoke-retries','2']),0)
  self.assertEqual(json.loads(out.getvalue())['limits'],{'maxRequests':5,'maxProRequests':1,'maxWebAttempts':10,'maxConcurrency':3,'maxPreInvokeRetries':2})
  for flag,value in [('--max-concurrency','4'),('--max-concurrency','0'),('--max-pre-invoke-retries','3'),('--max-requests','0'),('--max-pro-requests','-1')]:
   with contextlib.redirect_stderr(io.StringIO()):self.assertEqual(b.main([*base,flag,value]),2,flag+' '+value)
  self.assertEqual(b.load(self.state)['limits']['maxConcurrency'],3)
 def test_input_change_invalidates_reuse_key(self):
  self.enable(maxConcurrency=3);f=self.root/'input.txt';f.write_text('v1');self.job['inputs']=['input.txt'];a=self.prepare();f.write_text('v2');d=self.prepare();self.assertNotEqual(a['requestId'],d['requestId'])
 def test_quota_pauses_without_silent_downgrade_and_preserves_unknown_tokens(self):
  self.enable();p=self.prepare();s,folder,adapter=self.session(p);r=b.record_result(self.state,p['requestId'],'quota');self.assertTrue(r['paused']);self.assertFalse(r['silentCodexDeepFallback']);self.assertIsNone(r['actualTokens']);self.assertIsNone(r['tokenSource']);self.assertEqual(self.prepare(explicit='Pro')['action'],'pause')
 def test_only_sourced_token_field_is_reported_and_failure_cost_is_counted(self):
  self.enable();p=self.prepare();s,folder,adapter=self.session(p);adapter.update(attemptCount=1,phase='send-uncertain',invokeAttempted=True,usage={'total_tokens':123});bridge.write_json_atomic(folder/'state.json',adapter)
  r=b.record_result(self.state,p['requestId'],'capacity');self.assertEqual(r['actualTokens'],123);self.assertEqual(r['tokenSource']['field'],'/usage/total_tokens');stats=b.statistics(self.state);self.assertEqual(stats['failedWebAttempts'],1);self.assertEqual(stats['actualBilling'],'unknown')
 def test_wrong_identity_never_becomes_a_cache_result(self):
  self.enable();p=self.prepare();s,folder,adapter=self.session(p);adapter['idempotencyKeySha256']='0'*64;bridge.write_json_atomic(folder/'state.json',adapter)
  with self.assertRaisesRegex(ValueError,'identity mismatch'):b.record_result(self.state,p['requestId'])
 def test_default_retry_zero_and_configured_retry_requires_unchanged_preinvoke_proof(self):
  self.enable();p=self.prepare();s,folder,adapter=self.session(p);b.record_result(self.state,p['requestId'])
  with self.assertRaises(ValueError):b.retry_preinvoke(self.state,p['requestId'])
  b.configure(self.state,'save-codex',limits={'maxPreInvokeRetries':1});r=b.retry_preinvoke(self.state,p['requestId']);self.assertFalse(r['newIdentityAllowed']);self.assertFalse(r['openNewTab']);self.assertTrue(r['freshConversation'])
  with self.assertRaises(ValueError):b.retry_preinvoke(self.state,p['requestId'])
 def test_complete_result_reuse_requires_existing_validated_import_and_unchanged_hash(self):
  self.enable();p=self.prepare();s,folder,adapter=self.session(p);s.response_file.write_text('bounded fixture response',encoding='utf-8');adapter.update(phase='completed',attemptCount=1);bridge.write_json_atomic(folder/'state.json',adapter)
  with patch.object(bridge,'import_sidebar_evidence',return_value={'responseSha256':bridge.sha256_path(s.response_file)}) as validated:
   b.record_result(self.state,p['requestId']);r=self.prepare();self.assertEqual(r['action'],'reuse');self.assertEqual(r['newWebRequests'],0);self.assertEqual(validated.call_count,2)
   s.response_file.write_text('tampered',encoding='utf-8')
   with self.assertRaises(ValueError):self.prepare()
 def test_existing_ccg_entry_binds_once_and_does_not_create_replacement_session(self):
  self.enable();p=self.prepare();args=['--mode','exc','--workdir',str(self.root),'--output-root',str(self.root/'sessions'),'--prompt-file',p['briefFile'],*p['bridgeArgs']]
  with contextlib.redirect_stdout(io.StringIO()):self.assertEqual(bridge.main(args),0)
  first=b.load(self.state)['requests'][p['requestId']]['sessionDir']
  status=bridge.load_session(first).status();self.assertTrue(status['boundedAdvice'])
  self.assertEqual(bridge.load_session(first).prompt_file.read_text(encoding='utf-8'),Path(p['briefFile']).read_text(encoding='utf-8')+'\n')
  with contextlib.redirect_stdout(io.StringIO()) as out:self.assertEqual(bridge.main(args),0)
  self.assertIn('CCG_GPTPRO_BUDGET_EXISTING_REQUEST=1',out.getvalue());self.assertEqual(b.load(self.state)['requests'][p['requestId']]['sessionDir'],first);self.assertEqual(len(list((self.root/'sessions').glob('*/status.json'))),1)
 def test_prepared_brief_mutation_cannot_create_session(self):
  self.enable();p=self.prepare();Path(p['briefFile']).write_text('changed',encoding='utf-8')
  with contextlib.redirect_stderr(io.StringIO()):self.assertEqual(bridge.main(['--mode','exc','--workdir',str(self.root),'--prompt-file',p['briefFile'],*p['bridgeArgs']]),2)
  self.assertNotIn('sessionDir',b.load(self.state)['requests'][p['requestId']])
 def test_advice_brief_requires_independent_review_and_bounded_code_corrections(self):
  self.enable();p=self.prepare();text=Path(p['briefFile']).read_text(encoding='utf-8')
  for clause in ['return code drafts or unified diffs as text','Codex must independently review every proposed or revised diff before local application','local writes, tests and final acceptance','finding-by-finding resolution','preserve the accepted design','cache reuse is not code approval']:
   self.assertIn(clause,text)
  self.assertEqual(p['newWebRequests'],0);self.assertTrue(p['authorizationRequiredForNewSend'])
 def test_review_feedback_prepares_a_new_budgeted_request_without_resending_the_original(self):
  self.enable();first=self.prepare();before=b.load(self.state)['requests'][first['requestId']]
  feedback='Codex review: src/a.py:12 drops the empty-input case. Expected [] but got None. Reproduce with test_empty_input. Keep the accepted API design; correct only this finding.'
  revised=b.prepare(self.state,self.job,feedback,self.root)
  self.assertEqual(revised['action'],'prepare-bridge');self.assertNotEqual(first['requestId'],revised['requestId'])
  self.assertEqual(len(b.load(self.state)['requests']),2);self.assertEqual(b.load(self.state)['requests'][first['requestId']],before)
  self.assertIn(feedback,Path(revised['briefFile']).read_text(encoding='utf-8'))
  self.assertEqual(revised['newWebRequests'],0);self.assertTrue(revised['authorizationRequiredForNewSend'])
if __name__=='__main__':unittest.main()
