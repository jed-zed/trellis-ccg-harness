import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
p=Path(__file__).parents[1]/'scripts/gptpro_bridge.py'
spec=importlib.util.spec_from_file_location('bridge',p);b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class ModeTests(unittest.TestCase):
 def test_default_workflow_unchanged(self):
  args=b.parse_args(['--mode','plan']);self.assertEqual(args.mode,'plan');self.assertIsNone(args.thinking_mode);self.assertEqual(b.canonical_thinking_mode(None),'Pro')
 def test_aliases_and_separate_mode(self):
  self.assertEqual(b.canonical_thinking_mode('\u6781\u9ad8'),'Extra High');self.assertEqual(b.canonical_thinking_mode('xhigh'),'xhigh')
  args=b.parse_args(['--mode','review','--thinking-mode','High']);self.assertEqual(args.mode,'review');self.assertEqual(args.thinking_mode,'High')
 def test_session_round_and_followup_persistence(self):
  with tempfile.TemporaryDirectory() as d:
   args=dict(mode='exc',workdir=d,prompt='bounded task',slug='test',output_root=Path(d)/'output',round_number=1,followup_session=None,followup_reason=None,thinking_mode='extra-high',project_context={})
   s=b.create_session(**args);self.assertEqual(s.status()['thinkingMode'],'Extra High');self.assertEqual(s.state()['thinkingMode'],'Extra High')
   args.update(thinking_mode=None,followup_session=s.session_dir,followup_reason='verify changed requirement')
   s=b.create_session(**args);self.assertEqual(s.status()['rounds']['round-2']['thinkingMode'],'Extra High')
   args.update(thinking_mode='Pro');s=b.create_session(**args);self.assertEqual(s.status()['rounds']['round-3']['thinkingMode'],'Pro');self.assertEqual(s.status()['rounds']['round-1']['thinkingMode'],'Extra High')
 def test_import_mismatch_is_fail_closed(self):
  self.assertEqual(b.validate_thinking_mode_evidence('Extra High',{'thinkingMode':'extra-high'}),'Extra High')
  with self.assertRaisesRegex(ValueError,'ThinkingModeEvidenceMismatch'):b.validate_thinking_mode_evidence('Extra High',{'thinkingMode':'Pro'})
  with self.assertRaisesRegex(ValueError,'ThinkingModeEvidenceMismatch'):b.validate_thinking_mode_evidence('High',{})
 def test_batch_explicit_override_wins(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'request.json';path.write_text(json.dumps({'schemaVersion':1,'codexThreadId':'11111111-1111-4111-8111-111111111111','thinkingMode':'High','rounds':[{'roundId':'a','prompt':'bounded','idempotencyKey':'unique','thinkingMode':'Medium'}]}),encoding='utf-8')
   kwargs=dict(expected_mode='exc',expected_codex_thread_id='')
   self.assertEqual(b.read_batch_request(path,**kwargs)['rounds'][0]['thinking_mode'],'Medium')
   self.assertEqual(b.read_batch_request(path,thinking_mode='extra-high',**kwargs)['rounds'][0]['thinking_mode'],'Extra High')
if __name__=='__main__':unittest.main()
