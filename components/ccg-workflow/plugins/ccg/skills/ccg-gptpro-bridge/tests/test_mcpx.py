import copy
from datetime import datetime,timezone,timedelta
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import gptpro_mcpx as m
import gptpro_budget as b
import gptpro_bridge as bridge
THREAD='11111111-1111-4111-8111-111111111111'
class McpxTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.receipt=self.root/'receipt.json';self.scope=self.root/'scope.json';self.state=self.root/'budget.json'
  self.r={'schemaVersion':1,'source':'successful-existing-MCPX-tools','observedAtUtc':datetime.now(timezone.utc).isoformat(),'availableTools':['workspace','session','runtime_read','read','edit','execute'],'runtime':{'version':'0.9.18'},'remoteSession':{'id':'existing-session','status':'active','role':'owner'},'workspace':{'name':'registered-workspace','path':str(self.root)},'sourceFiles':[{'path':'REVIEW_ENTRYPOINT.md','rev':'entry-rev'},{'path':'src/a.py','rev':'source-rev'}]}
  self.s={'permissionMode':'read-only','workspaceId':'registered-workspace','remoteSessionId':'existing-session','browserProfileId':'existing-profile','entrypoint':'REVIEW_ENTRYPOINT.md','allowedPaths':['REVIEW_ENTRYPOINT.md','src/a.py']}
  self.save();self.job={'importance':'step','risk':'low','complexity':2,'goal':'bounded source analysis','snapshot':'fixture-v1','acceptance':'cite source lines','inputs':[]}
 def tearDown(self):self.tmp.cleanup()
 def write(self,p,data):p.write_text(json.dumps(data),encoding='utf-8')
 def save(self):self.write(self.receipt,self.r);self.write(self.scope,self.s)
 def ctx(self):return m.contract(self.receipt,self.scope)
 def enable(self):b.configure(self.state,'save-codex',THREAD,mcpx_scope_file=self.scope,mcpx_preflight_file=self.receipt)
 def prepare(self,explicit=None):return b.prepare(self.state,self.job,'Only the goal; fetch scoped source through MCPX.',self.root,explicit)
 def history(self,rid='request1',paths=None,extra=False):
  start=datetime.now(timezone.utc)-timedelta(seconds=60);self.lo=start.isoformat();self.hi=(start+timedelta(seconds=5)).isoformat()
  rows=[{'kind':'agent.activity','activity_kind':'intent','summary':'GPTPRO_ADVICE_REQUEST:'+rid,'sequence':1,'workspace':'registered-workspace','remote_session_id':'existing-session','created_at':(start+timedelta(seconds=1)).isoformat()}]
  for i,path in enumerate(paths or ['REVIEW_ENTRYPOINT.md','src/a.py']):rows.append({'event_id':str(i+10),'kind':'tool.completed','status':'succeeded','tool':'read','path':path,'sequence':i+2,'workspace':'registered-workspace','remote_session_id':'existing-session','created_at':(start+timedelta(seconds=2)).isoformat()})
  if extra:rows.append(dict(rows[-1],tool='edit',sequence=5))
  f=self.root/'history.json';self.write(f,{'data':{'events':rows,'next_cursor':''}});return f
 def test_current_read_tools_do_not_claim_owner_connection_is_server_readonly(self):
  c=self.ctx();self.assertNotIn('edit',c['allowedTools']);self.assertIn('privileges unchanged',c['readOnlyEnforcement']);self.assertIn('unverified',c['webModeCapability'])
 def test_wrong_workspace_or_session_is_blocked(self):
  for key in ['workspaceId','remoteSessionId']:
   old=self.s[key];self.s[key]='wrong';self.save()
   with self.assertRaisesRegex(m.McpxBlocked,'NOT_VERIFIED'):self.ctx()
   self.s[key]=old
 def test_missing_tool_and_stale_receipt_are_recoverable_blocks(self):
  self.r['availableTools'].remove('read');self.save()
  with self.assertRaisesRegex(m.McpxBlocked,'UNAVAILABLE'):self.ctx()
  self.r['availableTools'].append('read');self.r['observedAtUtc']=(datetime.now(timezone.utc)-timedelta(minutes=6)).isoformat();self.save()
  with self.assertRaisesRegex(m.McpxBlocked,'STALE'):self.ctx()
 def test_protected_paths_and_scope_escape_are_rejected(self):
  for path in ['../AGENTS.md','C:/Users/u/.codex/sessions/x','.codex/sessions/x','.aws/config','.env','auth.json','a//b']:
   with self.assertRaises(m.McpxBlocked):m.relative_file(path)
 def test_unknown_or_duplicate_source_version_is_rejected(self):
  self.r['sourceFiles'][1]={'path':'src/a.py'};self.save()
  with self.assertRaisesRegex(m.McpxBlocked,'VERSION_MISSING'):self.ctx()
  self.r['sourceFiles'][1]=dict(self.r['sourceFiles'][0]);self.save()
  with self.assertRaisesRegex(m.McpxBlocked,'DUPLICATE'):self.ctx()
 def test_each_strength_requires_separate_web_tool_proof(self):
  c=self.ctx();proof=m.verify_read_history(c,'request1',self.history(),True);self.assertFalse(m.mode_verified(self.state,c,'Extra High'));self.assertFalse(m.mode_verified(self.state,c,'Pro'))
  m.mark_verified(self.state,c,'Extra High','f'*64,proof);self.assertTrue(m.mode_verified(self.state,c,'Extra High'));self.assertFalse(m.mode_verified(self.state,c,'Pro'))
 def test_first_request_checks_capability_without_project_analysis(self):
  self.enable();p=self.prepare();self.assertEqual(p['action'],'prepare-capability-check');text=Path(p['briefFile']).read_text();self.assertIn('do not analyze',text);self.assertIn(p['requestId'],text);self.assertNotIn(self.job['goal'],text);self.assertNotIn('Codex must independently review',text)
 def test_verified_mcpx_advice_carries_independent_code_review_contract(self):
  self.enable();c=self.ctx();proof=m.verify_read_history(c,'request1',self.history(),True)
  m.mark_verified(self.state,c,'Extra High','f'*64,proof)
  p=self.prepare();self.assertEqual(p['action'],'prepare-bridge');text=Path(p['briefFile']).read_text(encoding='utf-8')
  self.assertIn('Use MCPX to read the scoped evidence',text)
  self.assertIn('Codex must independently review every proposed or revised diff',text)
  self.assertIn('local writes, tests and final acceptance',text)
  self.assertEqual(p['newWebRequests'],0)
 def test_missing_connection_does_not_fall_back_to_summary_or_pro(self):
  b.configure(self.state,'save-codex',THREAD);r=self.prepare();self.assertEqual(r['action'],'mcpx-blocked');self.assertEqual(r['summaryFallback'],'explicit-user-choice-only');self.assertEqual(r['newWebRequests'],0)
 def test_explicit_summary_marks_its_missing_direct_access(self):
  b.configure(self.state,'save-codex',THREAD,evidence_access='summary');p=self.prepare();self.assertIn('Webpage has NOT read',Path(p['briefFile']).read_text())
 def test_read_proof_requires_marker_scope_and_read_tools(self):
  c=self.ctx();self.assertEqual(len(m.verify_read_history(c,'request1',self.history())['readEventIds']),2)
  with self.assertRaisesRegex(m.McpxBlocked,'MARKER'):m.verify_read_history(c,'wrong',self.history())
  with self.assertRaisesRegex(m.McpxBlocked,'NON_READ'):m.verify_read_history(c,'request1',self.history(extra=True))
  with self.assertRaisesRegex(m.McpxBlocked,'SCOPED_READS'):m.verify_read_history(c,'request1',self.history(paths=['REVIEW_ENTRYPOINT.md']))
 def test_batch_read_without_server_paths_stays_blocked_and_prompt_requires_single_file_reads(self):
  text=m.prompt(self.ctx(),False)
  self.assertIn('separate read call with top-level path',text)
  self.assertIn('do not use items',text)
  h=self.history();data=json.loads(h.read_text());data['data']['events'][1]['path']='';self.write(h,data)
  with self.assertRaisesRegex(m.McpxBlocked,'BATCH_READ_PATH_EVIDENCE_UNAVAILABLE'):m.verify_read_history(self.ctx(),'request1',h)
 def test_incomplete_history_cannot_prove_web_read(self):
  h=self.history();data=json.loads(h.read_text());data['data']['next_cursor']='more';self.write(h,data)
  with self.assertRaisesRegex(m.McpxBlocked,'INCOMPLETE'):m.verify_read_history(self.ctx(),'request1',h)
 def test_history_is_bounded_to_original_web_request_time(self):
  h=self.history();proof=m.verify_read_history(self.ctx(),'request1',h,False,self.lo,self.hi);self.assertEqual(len(proof['paths']),2)
  with self.assertRaisesRegex(m.McpxBlocked,'MARKER'):m.verify_read_history(self.ctx(),'request1',h,False,self.hi,(datetime.now(timezone.utc)).isoformat())
 def test_failed_out_of_scope_read_is_not_accepted(self):
  h=self.history();data=json.loads(h.read_text());e=dict(data['data']['events'][-1],path='other.py',status='failed',sequence=5);data['data']['events'].append(e);self.write(h,data)
  with self.assertRaisesRegex(m.McpxBlocked,'OUT_OF_SCOPE'):m.verify_read_history(self.ctx(),'request1',h)
 def test_source_changes_invalidate_reuse(self):
  c=self.ctx();self.assertTrue(m.current_versions_match(c,self.receipt));self.r['sourceFiles'][1]['rev']='new';self.save()
  with self.assertRaisesRegex(m.McpxBlocked,'SOURCE_CHANGED'):m.current_versions_match(c,self.receipt)
  self.assertNotEqual(m.version_fingerprint(c),m.version_fingerprint(self.ctx()))
 def test_concurrent_advice_needs_distinct_mcpx_sessions(self):
  self.enable();self.prepare();self.job['snapshot']='new-job';self.assertEqual(self.prepare()['action'],'queue')
 def test_record_needs_validated_import_read_history_and_current_sources(self):
  self.enable();p=self.prepare();record=b.load(self.state)['requests'][p['requestId']]
  session=bridge.create_session(mode='exc',workdir=self.root,prompt=Path(p['briefFile']).read_text(),slug='fixture',output_root=self.root/'sessions',round_number=1,followup_session=None,followup_reason=None,thinking_mode='Extra High',bounded_advice=True,project_context={},codex_thread_id=THREAD);b.attach(self.state,p['requestId'],session)
  folder=session.prompt_file.parent/'sidebar';folder.mkdir();session.response_file.write_text('REVIEW_ENTRYPOINT.md:1 entry-rev',encoding='utf-8');h=self.history(p['requestId'],['REVIEW_ENTRYPOINT.md'])
  adapter={'phase':'completed','codexThreadId':THREAD,'idempotencyKeySha256':b.digest(record['idempotencyKey'].encode()),'promptSha256':bridge.sha256_sidebar_prompt_path(session.prompt_file),'thinkingMode':'Extra High','attemptCount':1,'targetBinding':{'profileId':'existing-profile'},'firstClickAtUtc':self.lo,'completedAtUtc':self.hi};bridge.write_json_atomic(folder/'state.json',adapter)
  with patch.object(bridge,'import_sidebar_evidence',return_value={'responseSha256':bridge.sha256_path(session.response_file)}):
   self.assertEqual(b.record_result(self.state,p['requestId'])['status'],'awaiting-mcpx-proof');self.assertFalse(m.mode_verified(self.state,self.ctx(),'Extra High'))
   self.assertEqual(b.record_result(self.state,p['requestId'],mcpx_history_file=h,mcpx_current_receipt=self.receipt)['status'],'completed')
  self.assertTrue(m.mode_verified(self.state,self.ctx(),'Extra High'));self.assertFalse(m.mode_verified(self.state,self.ctx(),'Pro'))
  self.assertEqual(self.prepare()['action'],'prepare-bridge')

class ProductionTests(unittest.TestCase):
    write = McpxTests.write
    save = McpxTests.save
    ctx = McpxTests.ctx
    enable = McpxTests.enable
    prepare = McpxTests.prepare
    history = McpxTests.history
    tearDown = McpxTests.tearDown

    def setUp(self):
        McpxTests.setUp(self)
        self.r['availableTools'] += ['observe', 'progress']
        self.s['entrypoint'] = 'accept/REVIEW_ENTRYPOINT.md'
        self.s['allowedPaths'] = ['accept/REVIEW_ENTRYPOINT.md', 'accept/spec.md']
        for row, path in zip(self.r['sourceFiles'], self.s['allowedPaths']):
            row['path'] = path
        self.s.update(permissionMode='read-write-execute', authorizationConfirmed=True,
                      taskDirectory='accept', writePaths=['accept/a.py', 'accept/test_a.py'],
                      allowedExecutions=[{'argv': ['I:/python311/python.exe', '-m', 'unittest', 'discover', '-s', 'accept', '-v'], 'shell': False}])
        self.save()

    def full_history(self):
        path = self.history(paths=self.s['allowedPaths'])
        data = json.loads(path.read_text())
        rows = data['data']['events']
        base = rows[-1]
        for index, output in enumerate(self.s['writePaths']):
            request = 'edit-' + str(index)
            rows.append(dict(base, event_id='write-' + str(index), kind='file.changed', tool='edit', path=output,
                             sequence=4 + index * 2, request_id=request))
            rows.append(dict(base, event_id='edit-complete-' + str(index), kind='tool.completed', tool='edit', path='',
                             sequence=5 + index * 2, request_id=request))
        execution = self.ctx()['allowedExecutions'][0]
        rows.append(dict(base, event_id='execute-success', kind='tool.completed', tool='execute', path='',
                         sequence=8, command=execution['command'], working_directory=execution['workingDirectory'], exit_code=0))
        self.write(path, data)
        return path

    def test_explicit_read_only_compatibility_remains_available(self):
        scope = copy.deepcopy(self.s)
        for key in ('permissionMode', 'authorizationConfirmed', 'taskDirectory', 'writePaths', 'allowedExecutions'):
            scope.pop(key)
        scope['permissionMode'] = 'read-only'
        self.write(self.scope, scope)
        value = self.ctx()
        self.assertEqual(value['allowedTools'], list(m.READ_TOOLS))
        self.assertIn('Never edit, execute', m.prompt(value, False))

    def test_new_task_defaults_to_authorized_production_and_requires_scope_authorization(self):
        self.s.pop('permissionMode'); self.save()
        value = self.ctx()
        self.assertEqual(value['permissionMode'], 'read-write-execute')
        self.assertIn('edit', value['allowedTools'])
        self.assertIn('execute', value['allowedTools'])
        self.assertIn('Write only these exact paths', m.prompt(value, False))
        self.s['authorizationConfirmed'] = False; self.save()
        with self.assertRaisesRegex(m.McpxBlocked, 'AUTHORIZATION'): self.ctx()

    def test_role_tools_task_paths_and_exact_argv_are_checked(self):
        original_scope, original_receipt = copy.deepcopy(self.s), copy.deepcopy(self.r)
        mutations = [
            lambda: self.r['remoteSession'].update(role='viewer'),
            lambda: self.r['availableTools'].remove('execute'),
            lambda: self.s['writePaths'].append('outside.py'),
            lambda: self.s['writePaths'].append('accept/.env'),
            lambda: self.s['allowedExecutions'][0].update(shell=True),
            lambda: self.s['allowedExecutions'][0].update(argv=[]),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                self.s, self.r = copy.deepcopy(original_scope), copy.deepcopy(original_receipt)
                mutate(); self.save()
                with self.assertRaises(m.McpxBlocked): self.ctx()

    def test_nonexistent_outputs_do_not_need_prefabricated_source_receipts(self):
        value = self.ctx()
        self.assertEqual(value['writePaths'], self.s['writePaths'])
        self.assertFalse((self.root / 'accept/a.py').exists())
        self.assertEqual({row['path'] for row in value['filesManifest']}, set(self.s['allowedPaths']))

    def test_capability_round_stays_readonly_and_separately_keyed(self):
        value = self.ctx()
        self.assertIn('Never edit, execute', m.prompt(value, True))
        m.verify_read_history(value, 'request1', self.history(paths=[self.s['entrypoint']]), True)
        with self.assertRaisesRegex(m.McpxBlocked, 'NON_READ'):
            m.verify_read_history(value, 'request1', self.full_history(), True)
        default = dict(value); default.pop('permissionMode')
        self.assertNotEqual(m.capability_key(value, 'Extra High'), m.capability_key(default, 'Extra High'))

    def test_standard_budget_prepare_routes_default_code_production(self):
        self.s.pop('permissionMode'); self.save()
        self.enable()
        value = self.ctx()
        proof = m.verify_read_history(value, 'request1', self.history(paths=[self.s['entrypoint']]), True)
        m.mark_verified(self.state, value, 'Extra High', 'f' * 64, proof)
        self.job.update(goal='Produce a.py and test_a.py, write them using MCPX, and run the exact unittest argv.')
        prepared = self.prepare()
        text = Path(prepared['briefFile']).read_text(encoding='utf-8')
        self.assertEqual(prepared['action'], 'prepare-bridge')
        self.assertIn('Explicitly authorized scoped MCPX code production', text)
        self.assertIn('Write only these exact paths', text)
        self.assertIn('shell=false', text)
        self.assertNotIn('Do not make workspace changes or execute commands', text)
        self.assertEqual(prepared['newWebRequests'], 0)

    def test_structured_effect_receipts_are_required(self):
        value = self.ctx()
        with self.assertRaisesRegex(m.McpxBlocked, 'WRITES_NOT_PROVED'):
            m.verify_read_history(value, 'request1', self.history(paths=self.s['allowedPaths']))
        proof = m.verify_read_history(value, 'request1', self.full_history(), False, self.lo, self.hi)
        self.assertEqual(proof['writtenPaths'], sorted(self.s['writePaths']))
        self.assertEqual(proof['executeEventIds'], ['execute-success'])

    def test_outside_write_missing_edit_and_nonzero_or_wrong_execution_fail(self):
        mutations = [
            (lambda rows: rows[3].update(path='other/project.py'), 'OUT_OF_SCOPE'),
            (lambda rows: rows[4].update(request_id='unrelated'), 'WRITES_NOT_PROVED'),
            (lambda rows: rows[-1].update(exit_code=1), 'EXECUTION_NOT_PROVED'),
            (lambda rows: rows[-1].update(exit_code=None), 'EXECUTION_NOT_PROVED'),
            (lambda rows: rows[-1].update(sequence=3), 'EXECUTION_NOT_PROVED'),
            (lambda rows: rows[-1].update(command='something else'), 'OUT_OF_SCOPE_EXECUTION'),
            (lambda rows: rows[-1].update(working_directory='C:/elsewhere'), 'OUT_OF_SCOPE_EXECUTION'),
        ]
        for mutate, reason in mutations:
            with self.subTest(reason=reason):
                path = self.full_history(); data = json.loads(path.read_text()); mutate(data['data']['events']); self.write(path, data)
                with self.assertRaisesRegex(m.McpxBlocked, reason): m.verify_read_history(self.ctx(), 'request1', path)

    def test_unix_execution_directory_is_case_sensitive(self):
        contract = self.ctx()
        contract['allowedExecutions'][0]['workingDirectory'] = '/work/Demo'
        path = self.full_history(); data = json.loads(path.read_text())
        data['data']['events'][-1]['working_directory'] = '/work/demo'; self.write(path, data)
        with self.assertRaisesRegex(m.McpxBlocked, 'OUT_OF_SCOPE_EXECUTION'):
            m.verify_read_history(contract, 'request1', path)
        data['data']['events'][-1]['working_directory'] = '/work/Demo'; self.write(path, data)
        self.assertEqual(m.verify_read_history(contract, 'request1', path)['executeEventIds'], ['execute-success'])
        self.assertNotEqual(m.working_directory_key('/work/A\\B'), m.working_directory_key('/work/A/B'))
        self.assertEqual(m.working_directory_key('C:/Work/Demo'), m.working_directory_key('c:/work/demo'))
        self.assertEqual(m.working_directory_key('\\\\Server\\Share\\Demo'), '//server/share/demo')

    def test_permission_changes_invalidate_cache_and_immutable_inputs_still_match(self):
        original = self.ctx()
        self.s['writePaths'][0] = 'accept/changed.py'; self.save()
        self.assertNotEqual(m.version_fingerprint(original), m.version_fingerprint(self.ctx()))
        self.r['sourceFiles'][1]['rev'] = 'changed-input'; self.save()
        with self.assertRaisesRegex(m.McpxBlocked, 'SOURCE_CHANGED'):
            m.current_versions_match(original, self.receipt)

    def test_argv_display_matches_official_policy_quoting(self):
        self.assertEqual(m.argv_display(['C:\\Python\\python.exe', '-m', 'unittest']), "'C:\\Python\\python.exe' -m unittest")



class ConfirmationTests(unittest.TestCase):
    setUp = ProductionTests.setUp
    tearDown = McpxTests.tearDown
    write = McpxTests.write
    save = McpxTests.save
    ctx = McpxTests.ctx
    history = McpxTests.history
    full_history = ProductionTests.full_history

    def split_history(self, rid='request1'):
        path=self.full_history();data=json.loads(path.read_text())
        for row in data['data']['events']:
            if row.get('activity_kind')=='intent':row['summary']='GPTPRO_ADVICE_REQUEST:'+rid
        success=data['data']['events'][-1]
        hi=datetime.fromisoformat(self.hi)
        self.extra_lo=(hi+timedelta(seconds=10)).isoformat();self.extra_hi=(hi+timedelta(seconds=20)).isoformat()
        pending=dict(success,event_id='pending',status='waiting_confirmation',sequence=success['sequence']-1,working_directory='',created_at=(hi-timedelta(seconds=1)).isoformat())
        pending.pop('exit_code',None)
        success['created_at']=(hi+timedelta(seconds=11)).isoformat()
        data['data']['events'].insert(-1,pending);self.write(path,data);return path

    def observation(self, folder, prompt, response, start, end, key='ccg-advice:request1', deadline=None):
        folder.mkdir(parents=True)
        (folder/'prompt.md').write_bytes(prompt.encode('utf-8'));(folder/'response.md').write_bytes(response.encode('utf-8'))
        url='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';(folder/'url.txt').write_text(url,encoding='utf-8')
        binding={'browserId':'browser-test','profileId':'existing-profile','tabId':'123','sessionKey':'browser-test:existing-profile:123','origin':'https://chatgpt.com','url':url}
        sha=lambda name:bridge.sha256_path(folder/name)
        state={'schemaVersion':1,'tool':'chatgpt-pro-sidebar','transport':bridge.ACTIVE_BROWSER_TRANSPORT,'live':True,'phase':'completed','codexThreadId':THREAD,'thinkingMode':'Extra High','selectedThinkingMode':'Extra High','automaticResendAllowed':False,'submissionAcknowledged':True,'attemptCount':1,'targetBinding':binding,'idempotencyKey':key,'idempotencyKeySha256':b.digest(key.encode()),'baselineResponseSha256':[],'baselineUserTurnSha256':[],'firstClickAtUtc':start,'completedAtUtc':end,'responseDeadlineAtUtc':deadline or (datetime.fromisoformat(end)+timedelta(minutes=2)).isoformat(),'conversationUrl':url,'conversationUrlBound':url,'promptFile':'prompt.md','promptSha256':sha('prompt.md'),'responseFile':'response.md','responseSha256':sha('response.md'),'urlFile':'url.txt','urlSha256':sha('url.txt'),'evidenceFile':'evidence.json'}
        manifest={'tool':'chatgpt-pro-sidebar','transport':bridge.ACTIVE_BROWSER_TRANSPORT,'live':True,'thinkingMode':'Extra High','selectedThinkingMode':'Extra High','prompt':{'file':'prompt.md','sha256':sha('prompt.md')},'response':{'file':'response.md','sha256':sha('response.md')},'conversation':{'file':'url.txt','url':url,'boundAtSend':url,'exact':True,'matchedBoundUrl':True,'sha256':sha('url.txt')},'submission':{'acknowledged':True,'automaticResendAllowed':False},'extractor':{'targetBinding':binding},'authority':{'externalOutputIsUntrusted':True,'codexIsSoleWorkspaceWriter':True}}
        self.write(folder/'evidence.json',manifest);state['evidenceSha256']=sha('evidence.json');self.write(folder/'state.json',state)
        self.write(folder/'watch-event.json',{'status':'completed','requiresCodexReview':True,'automaticResendAllowed':False,'thinkingMode':'Extra High','selectedThinkingMode':'Extra High','codexThreadId':THREAD,'transport':bridge.ACTIVE_BROWSER_TRANSPORT,'evidenceDirectory':str(folder.resolve()),'conversationUrl':url,'targetBinding':binding,'watcherId':'11111111-1111-4111-8111-111111111111'})
        return folder

    def confirmed(self, folder, rid, start, end):
        prompt='Continue GPTPRO_ADVICE_REQUEST:'+rid+' with user_confirmed=true, shell=false\n'+json.dumps(self.ctx()['allowedExecutions'][0]['argv'])
        return self.observation(folder,prompt,'\n'.join(self.s['allowedPaths']),start,end,key='ccg-confirm-execute:'+rid+':pending')

    def test_pending_receipt_is_not_execution_success(self):
        path=self.split_history()
        with self.assertRaisesRegex(m.McpxBlocked,'EXECUTION_NOT_PROVED'):
            m.verify_read_history(self.ctx(),'request1',path,False,self.lo,self.hi)

    def test_disjoint_confirmed_window_accepts_only_real_success(self):
        path=self.split_history();proof=m.verify_read_history(self.ctx(),'request1',path,False,self.lo,self.hi,[self.extra_lo,self.extra_hi])
        self.assertEqual(proof['executeEventIds'],['execute-success']);self.assertEqual(proof['pendingExecutionEventIds'],['pending'])

    def test_pending_cannot_smuggle_a_different_command_or_claim_execution(self):
        for change in ({'command':'other command'},{'working_directory':'C:/other'},{'exit_code':0},{'execution_task_id':'already-running'}):
            path=self.split_history();data=json.loads(path.read_text());data['data']['events'][-2].update(change);self.write(path,data)
            with self.subTest(change=change),self.assertRaisesRegex(m.McpxBlocked,'INVALID_PENDING'):
                m.verify_read_history(self.ctx(),'request1',path,False,self.lo,self.hi,[self.extra_lo,self.extra_hi])

    def test_effects_in_unregistered_gap_are_rejected(self):
        path=self.split_history();data=json.loads(path.read_text());event=dict(data['data']['events'][-1],created_at=(datetime.fromisoformat(self.hi)+timedelta(seconds=3)).isoformat());data['data']['events'].append(event);self.write(path,data)
        with self.assertRaisesRegex(m.McpxBlocked,'UNREGISTERED_GAP'):
            m.verify_read_history(self.ctx(),'request1',path,False,self.lo,self.hi,[self.extra_lo,self.extra_hi])

    def test_passive_gap_events_are_not_used_to_fill_missing_reads(self):
        path=self.split_history();data=json.loads(path.read_text());read=data['data']['events'][1];read['created_at']=(datetime.fromisoformat(self.hi)+timedelta(seconds=3)).isoformat();self.write(path,data)
        with self.assertRaisesRegex(m.McpxBlocked,'SCOPED_READS'):
            m.verify_read_history(self.ctx(),'request1',path,False,self.lo,self.hi,[self.extra_lo,self.extra_hi])

    def test_confirmation_cannot_write_files_or_start_another_intent(self):
        for change in ({'tool':'edit'},{'kind':'agent.activity','activity_kind':'intent'}):
            path=self.split_history();data=json.loads(path.read_text());data['data']['events'][-1].update(change);self.write(path,data)
            with self.subTest(change=change),self.assertRaisesRegex(m.McpxBlocked,'CONFIRMATION_SCOPE'):
                m.verify_read_history(self.ctx(),'request1',path,False,self.lo,self.hi,[self.extra_lo,self.extra_hi])

    def test_confirmation_binding_argv_and_original_deadline_are_required(self):
        self.split_history();base=self.observation(self.root/'base/sidebar','request','initial',self.lo,self.hi)
        original=b.completed_observation(base,THREAD,'Extra High');record={'requestId':'request1','purpose':'bounded-advice','thinkingMode':'Extra High','mcpx':self.ctx()}
        folder=self.confirmed(self.root/'confirmation/sidebar','request1',self.extra_lo,self.extra_hi)
        _,proof=b.confirmation_observation(folder,original,record,THREAD);self.assertEqual(proof['window'],[self.extra_lo,self.extra_hi])
        for mutate,reason in ((lambda x:x.update(requestId='different'),'original request'),(lambda x:x['mcpx']['allowedExecutions'][0].update(argv=['other']),'argv')):
            changed=copy.deepcopy(record);mutate(changed)
            with self.assertRaisesRegex(ValueError,reason):b.confirmation_observation(folder,original,changed,THREAD)
        changed=copy.deepcopy(original);changed['state']['responseDeadlineAtUtc']=self.hi
        with self.assertRaisesRegex(ValueError,'deadline'):b.confirmation_observation(folder,changed,record,THREAD)

    def test_completed_confirmation_detects_tampered_response_and_cross_thread(self):
        self.split_history();folder=self.confirmed(self.root/'confirmation/sidebar','request1',self.extra_lo,self.extra_hi)
        with self.assertRaisesRegex(ValueError,'task'):b.completed_observation(folder,'22222222-2222-4222-8222-222222222222','Extra High')
        (folder/'response.md').write_text('forged',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'hash'):b.completed_observation(folder,THREAD,'Extra High')

    def test_record_preserves_initial_failure_and_links_true_confirmation(self):
        b.configure(self.state,'save-codex',THREAD,mcpx_scope_file=self.scope,mcpx_preflight_file=self.receipt)
        value=self.ctx();m.mark_verified(self.state,value,'Extra High','f'*64,{'source':'fixture'})
        prepared=b.prepare(self.state,{'importance':'step','risk':'low','complexity':2,'goal':'produce files','snapshot':'v1','inputs':[]},'bounded',self.root)
        rid=prepared['requestId'];prompt=Path(prepared['briefFile']).read_text()
        session=bridge.create_session(mode='exc',workdir=self.root,prompt=prompt,slug='confirmation',output_root=self.root/'sessions',round_number=1,followup_session=None,followup_reason=None,thinking_mode='Extra High',bounded_advice=True,project_context={},codex_thread_id=THREAD);b.attach(self.state,rid,session)
        prompt=session.prompt_file.read_text(encoding='utf-8').replace(chr(13)+chr(10),chr(10)).replace(chr(13),chr(10)).rstrip(chr(13)+chr(10))
        history=self.split_history(rid);folder=self.observation(session.prompt_file.parent/'sidebar',prompt,'initial reply',self.lo,self.hi,key='ccg-advice:'+rid)
        adapter=json.loads((folder/'state.json').read_text());reserved=b.load(self.state)['requests'][rid]
        self.assertEqual(adapter['promptSha256'],reserved['promptSha256'],'fixture prompt identity')
        self.assertEqual(adapter['idempotencyKeySha256'],b.digest(reserved['idempotencyKey'].encode()),'fixture key identity')
        self.assertEqual(adapter['codexThreadId'],b.load(self.state)['codexThreadId'],'fixture thread identity')
        # Production fixtures use exact brief bytes just as the actual adapter does.
        before={name:(folder/name).read_bytes() for name in ('state.json','evidence.json','watch-event.json','response.md')}
        with patch.object(bridge,'import_sidebar_evidence',side_effect=lambda *args: {'responseSha256':bridge.sha256_path(session.response_file)}):
            session.response_file.write_text('initial reply',encoding='utf-8')
            self.assertEqual(b.record_result(self.state,rid,mcpx_history_file=history,mcpx_current_receipt=self.receipt)['status'],'awaiting-mcpx-proof')
            confirmation=self.confirmed(self.root/'confirmed/sidebar',rid,self.extra_lo,self.extra_hi)
            result=b.record_result(self.state,rid,mcpx_history_file=history,mcpx_current_receipt=self.receipt,mcpx_confirmation_dir=confirmation)
        self.assertEqual(result['status'],'completed');record=b.load(self.state)['requests'][rid]
        self.assertEqual(record['resultHistory'][0]['status'],'awaiting-mcpx-proof');self.assertEqual(record['resultHistory'][0]['mcpxBlockedReason'],'MCPX_RESPONSE_SOURCE_CITATIONS_MISSING')
        self.assertEqual(record['mcpxReadProof']['executeEventIds'],['execute-success'])
        for name,raw in before.items():self.assertEqual((folder/name).read_bytes(),raw)

    def test_reextraction_binds_unchanged_original_and_preserves_code(self):
        self.split_history();folder=self.observation(self.root/'round/sidebar','request','Python',self.lo,self.hi)
        original=b.completed_observation(folder,THREAD,'Extra High');out=folder.parent/'reextraction';out.mkdir();text='Python\n\n```\ndef f():\n    return 1\n```\n\n';(out/'response.md').write_text(text,encoding='utf-8');sha=bridge.sha256_path(out/'response.md')
        proof={'schemaVersion':1,'tool':'chatgpt-pro-sidebar-reextract','live':True,'readOnly':True,'generating':False,'truncated':False,'automaticResendAllowed':False,'newWebRequests':0,'originalEvidenceDirectory':str(folder.resolve()),'originalHashes':copy.deepcopy(original['hashes']),'codexThreadId':THREAD,'thinkingMode':'Extra High','promptSha256':original['state']['promptSha256'],'conversationUrl':original['url'],'originalCompletedAtUtc':self.hi,'originalTargetBinding':original['binding'],'observedTargetBinding':original['binding'],'responseIndex':0,'observedUserTurnSha256':[original['state']['promptSha256']],'observedResponseSha256':[sha],'responseFile':'response.md','responseSha256':sha}
        path=out/'reextraction.json';self.write(path,proof);accepted,_=b.reextracted_response(path,original);self.assertEqual(accepted,text)
        legacy=copy.deepcopy(original);legacy['state'].pop('thinkingMode');proof['thinkingMode']='Pro';self.write(path,proof)
        accepted,_=b.reextracted_response(path,legacy);self.assertEqual(accepted,text)
        proof['thinkingMode']='Extra High';self.write(path,proof)
        with self.assertRaisesRegex(ValueError,'ThinkingModeEvidenceMismatch'):b.reextracted_response(path,legacy)
        proof['observedUserTurnSha256']=['wrong'];self.write(path,proof)
        with self.assertRaisesRegex(ValueError,'transcript'):b.reextracted_response(path,original)
        proof['observedUserTurnSha256']=[original['state']['promptSha256']];proof['originalHashes']['state.json']='wrong';self.write(path,proof)
        with self.assertRaisesRegex(ValueError,'original evidence'):b.reextracted_response(path,original)
        proof['originalHashes']=copy.deepcopy(original['hashes']);(out/'response.md').write_text('different reply',encoding='utf-8');proof['responseSha256']=bridge.sha256_path(out/'response.md');proof['observedResponseSha256']=[proof['responseSha256']];self.write(path,proof)
        with self.assertRaisesRegex(ValueError,'non-code'):b.reextracted_response(path,original)


if __name__=='__main__':unittest.main()
