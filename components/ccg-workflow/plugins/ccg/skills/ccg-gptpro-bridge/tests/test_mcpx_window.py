"""Request-window regressions run against both shipped MCPX implementations."""
import importlib.util
import json
from datetime import datetime, timedelta
from pathlib import Path
import unittest
from unittest.mock import patch

import test_mcpx as fixture

THREAD, b, bridge, m = fixture.THREAD, fixture.b, fixture.bridge, fixture.m


ROOT = Path(__file__).resolve().parents[5]
spec = importlib.util.spec_from_file_location(
    'template_mcpx_window', ROOT / 'templates/engine/tools/gptpro/gptpro_mcpx.py')
template = importlib.util.module_from_spec(spec)
spec.loader.exec_module(template)
IMPLEMENTATIONS = (m, template)


class RequestWindowTests(unittest.TestCase):
    setUp = fixture.McpxTests.setUp
    tearDown = fixture.McpxTests.tearDown
    write = fixture.McpxTests.write
    save = fixture.McpxTests.save
    ctx = fixture.McpxTests.ctx
    history = fixture.McpxTests.history
    enable = fixture.McpxTests.enable
    prepare = fixture.McpxTests.prepare

    def altered_history(self, rid='request1', *, action='edit', position='after',
                        status='succeeded', duplicate=False):
        path = self.history(rid)
        data = json.loads(path.read_text())
        rows = data['data']['events']
        intent = dict(rows[0], sequence=4, summary=(
            'GPTPRO_ADVICE_REQUEST:' + rid if duplicate else 'next step'))
        effect = dict(rows[-1], event_id='outside', sequence=5,
                      tool=action, path='outside-scope.py', status=status)
        if action == 'file.changed':
            effect.update(kind='file.changed', tool='edit')
        if position == 'before':
            effect.update(sequence=0, created_at=self.lo)
            rows.insert(0, effect)
        elif position == 'between':
            effect['sequence'] = 4
            intent['sequence'] = 5
            rows += [effect, intent]
            rows += [dict(row, event_id='again-' + row['event_id'],
                          sequence=6 + index) for index, row in enumerate(rows[1:3])]
        else:
            rows += [intent, effect]
        self.write(path, data)
        return path

    def test_later_intent_cannot_hide_outside_reads_or_writes(self):
        for implementation in IMPLEMENTATIONS:
            for action in ('read', 'edit', 'file.changed'):
                for status in ('succeeded', 'failed'):
                    with self.subTest(implementation=implementation.__name__, action=action, status=status):
                        path = self.altered_history(action=action, status=status)
                        with self.assertRaises(implementation.McpxBlocked):
                            implementation.verify_read_history(self.ctx(), 'request1', path,
                                                               False, self.lo, self.hi)

    def test_repeated_request_marker_cannot_erase_earlier_violation(self):
        for implementation in IMPLEMENTATIONS:
            for bounded in (True, False):
                for action in ('read', 'edit'):
                    with self.subTest(implementation=implementation.__name__, bounded=bounded, action=action):
                        path = self.altered_history(action=action, position='between', duplicate=True)
                        window = (False, self.lo, self.hi) if bounded else ()
                        with self.assertRaises(implementation.McpxBlocked):
                            implementation.verify_read_history(self.ctx(), 'request1', path, *window)

    def test_full_window_checks_effects_before_marker_and_at_end(self):
        for implementation in IMPLEMENTATIONS:
            for position in ('before', 'after'):
                for action in ('read', 'edit', 'file.changed'):
                    with self.subTest(implementation=implementation.__name__, position=position, action=action):
                        path = self.altered_history(action=action, position=position)
                        data = json.loads(path.read_text())
                        if position == 'after':
                            data['data']['events'][-1]['created_at'] = self.hi
                            self.write(path, data)
                        with self.assertRaises(implementation.McpxBlocked):
                            implementation.verify_read_history(self.ctx(), 'request1', path,
                                                               False, self.lo, self.hi)

    def test_harmless_intents_do_not_discard_allowed_reads(self):
        path = self.history()
        data = json.loads(path.read_text())
        rows = data['data']['events']
        rows[-1]['sequence'] = 4
        rows.insert(2, dict(rows[0], sequence=3, summary='continuing the allowed reads'))
        self.write(path, data)
        for implementation in IMPLEMENTATIONS:
            with self.subTest(implementation=implementation.__name__):
                proof = implementation.verify_read_history(self.ctx(), 'request1', path,
                                                           False, self.lo, self.hi)
                self.assertEqual(proof['paths'], sorted(self.s['allowedPaths']))

    def test_outside_time_window_and_other_session_remain_excluded(self):
        path = self.history()
        data = json.loads(path.read_text())
        rows = data['data']['events']
        effect = dict(rows[-1], event_id='outside', tool='edit', path='outside-scope.py')
        rows += [dict(effect, sequence=0, created_at=(datetime.fromisoformat(self.lo)-timedelta(seconds=1)).isoformat()),
                 dict(effect, sequence=5, created_at=(datetime.fromisoformat(self.hi)+timedelta(seconds=1)).isoformat()),
                 dict(effect, sequence=6, remote_session_id='another-session')]
        self.write(path, data)
        for implementation in IMPLEMENTATIONS:
            with self.subTest(implementation=implementation.__name__):
                self.assertEqual(len(implementation.verify_read_history(
                    self.ctx(), 'request1', path, False, self.lo, self.hi)['readEventIds']), 2)

    def test_reads_before_marker_cannot_supply_positive_proof(self):
        path = self.history()
        data = json.loads(path.read_text())
        data['data']['events'][0]['sequence'] = 4
        self.write(path, data)
        for implementation in IMPLEMENTATIONS:
            with self.subTest(implementation=implementation.__name__):
                with self.assertRaisesRegex(implementation.McpxBlocked, 'SCOPED_READS'):
                    implementation.verify_read_history(self.ctx(), 'request1', path, False, self.lo, self.hi)

    def test_distinct_request_marker_cannot_donate_positive_proof(self):
        for implementation in IMPLEMENTATIONS:
            path = self.history()
            data = json.loads(path.read_text())
            rows = data['data']['events']
            rows[1]['sequence'], rows[2]['sequence'] = 3, 4
            rows.insert(1, dict(rows[0], sequence=2, summary='GPTPRO_ADVICE_REQUEST:request2'))
            self.write(path, data)
            with self.subTest(implementation=implementation.__name__), self.assertRaises(implementation.McpxBlocked):
                implementation.verify_read_history(self.ctx(), 'request1', path, False, self.lo, self.hi)

    def test_record_result_never_completes_or_verifies_violating_capability(self):
        self.enable()
        prepared = self.prepare()
        rid = prepared['requestId']
        record = b.load(self.state)['requests'][rid]
        session = bridge.create_session(
            mode='exc', workdir=self.root, prompt=Path(prepared['briefFile']).read_text(),
            slug='window', output_root=self.root/'sessions', round_number=1,
            followup_session=None, followup_reason=None, thinking_mode='Extra High',
            bounded_advice=True, project_context={}, codex_thread_id=THREAD)
        b.attach(self.state, rid, session)
        folder = session.prompt_file.parent/'sidebar'
        folder.mkdir()
        session.response_file.write_text('REVIEW_ENTRYPOINT.md:1 entry-rev', encoding='utf-8')
        history = self.altered_history(rid)
        self.write(folder/'state.json', {
            'phase': 'completed', 'codexThreadId': THREAD,
            'idempotencyKeySha256': b.digest(record['idempotencyKey'].encode()),
            'promptSha256': bridge.sha256_sidebar_prompt_path(session.prompt_file),
            'thinkingMode': 'Extra High', 'attemptCount': 1,
            'targetBinding': {'profileId': 'existing-profile'},
            'firstClickAtUtc': self.lo, 'completedAtUtc': self.hi})
        for implementation in IMPLEMENTATIONS:
            with self.subTest(implementation=implementation.__name__), patch.object(b, 'mcpx', implementation), patch.object(
                    bridge, 'import_sidebar_evidence', return_value={'responseSha256': bridge.sha256_path(session.response_file)}):
                result = b.record_result(self.state, rid, mcpx_history_file=history,
                                         mcpx_current_receipt=self.receipt)
                self.assertEqual(result['status'], 'awaiting-mcpx-proof')
                self.assertEqual(b.load(self.state)['requests'][rid]['status'], 'awaiting-mcpx-proof')
                self.assertEqual(b.statistics(self.state)['completed'], 0)
                self.assertFalse(implementation.mode_verified(self.state, self.ctx(), 'Extra High'))


class ProductionWindowTests(unittest.TestCase):
    setUp = fixture.ProductionTests.setUp
    tearDown = fixture.McpxTests.tearDown
    write = fixture.McpxTests.write
    save = fixture.McpxTests.save
    ctx = fixture.McpxTests.ctx
    history = fixture.McpxTests.history
    full_history = fixture.ProductionTests.full_history

    def test_production_before_marker_cannot_supply_positive_proof(self):
        for implementation in IMPLEMENTATIONS:
            path = self.full_history()
            data = json.loads(path.read_text())
            rows = data['data']['events']
            rows[:] = rows[3:] + rows[:3]
            for index, row in enumerate(rows):
                row['sequence'] = index + 1
                row['created_at'] = (datetime.fromisoformat(self.lo) + timedelta(milliseconds=100*(index+1))).isoformat()
            self.write(path, data)
            with self.subTest(implementation=implementation.__name__), self.assertRaisesRegex(
                    implementation.McpxBlocked, 'WRITES_NOT_PROVED'):
                implementation.verify_read_history(self.ctx(), 'request1', path, False, self.lo, self.hi)

    def test_same_session_cannot_hide_effects_in_another_workspace(self):
        for implementation in IMPLEMENTATIONS:
            path = self.full_history()
            data = json.loads(path.read_text())
            rows = data['data']['events']
            rows.append(dict(rows[-1], event_id='cross-workspace', sequence=9,
                             workspace='another-workspace', command='unapproved'))
            self.write(path, data)
            with self.subTest(implementation=implementation.__name__), self.assertRaisesRegex(
                    implementation.McpxBlocked, 'OUT_OF_SCOPE_WORKSPACE'):
                implementation.verify_read_history(self.ctx(), 'request1', path, False, self.lo, self.hi)

    def test_allowed_late_write_still_requires_a_later_successful_test(self):
        for implementation in IMPLEMENTATIONS:
            path = self.full_history()
            data = json.loads(path.read_text())
            rows = data['data']['events']
            rows += [dict(rows[0], sequence=9, summary='next step'),
                     dict(rows[3], sequence=10, event_id='late-write', request_id='late'),
                     dict(rows[4], sequence=11, event_id='late-complete', request_id='late')]
            self.write(path, data)
            with self.subTest(implementation=implementation.__name__), self.assertRaisesRegex(
                    implementation.McpxBlocked, 'EXECUTION_NOT_PROVED'):
                implementation.verify_read_history(self.ctx(), 'request1', path, False, self.lo, self.hi)
            rows.append(dict(rows[7], sequence=12, event_id='rerun-success'))
            self.write(path, data)
            proof = implementation.verify_read_history(self.ctx(), 'request1', path, False, self.lo, self.hi)
            self.assertEqual(proof['executeEventIds'], ['rerun-success'])

    def test_later_intent_cannot_hide_unauthorized_production_effects(self):
        for implementation in IMPLEMENTATIONS:
            for action in ('read', 'edit', 'execute'):
                with self.subTest(implementation=implementation.__name__, action=action):
                    path = self.full_history()
                    data = json.loads(path.read_text())
                    rows = data['data']['events']
                    rows.append(dict(rows[0], sequence=9, summary='next step'))
                    effect = dict(rows[-2], event_id='outside', sequence=10,
                                  tool=action, path='outside-scope.py', command='unapproved')
                    if action == 'edit':
                        effect.update(kind='file.changed', request_id='outside-edit')
                    rows.append(effect)
                    self.write(path, data)
                    with self.assertRaises(implementation.McpxBlocked):
                        implementation.verify_read_history(self.ctx(), 'request1', path,
                                                           False, self.lo, self.hi)


if __name__ == '__main__':
    unittest.main()
