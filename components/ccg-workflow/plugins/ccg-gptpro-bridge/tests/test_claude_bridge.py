"""Offline forged-evidence/isolated-home tests. No browser, model, or global writes."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import os
import sys
from unittest import mock
import zipfile

SPEC = importlib.util.spec_from_file_location("claude_bridge", Path(__file__).resolve().parents[1] / "scripts" / "claude_bridge.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)
SID = "019fa981-725e-7f02-93a7-bb1e1b7aefd3"
OTHER = "019fa981-725e-7f02-93a7-bb1e1b7aefd4"
URL = "https://chatgpt.com/c/019fa981-725e-7f02-93a7-bb1e1b7aefd5"
BINDING = {"browserId":"fixture-browser","profileId":"fixture-profile","tabId":"fixture-tab","sessionKey":"fixture-session","origin":"https://chatgpt.com","url":"https://chatgpt.com/"}


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="claude-bridge-test-")
        self.root = Path(self.temp.name)
        self.launcher_artifact = self.root / 'synthetic-native-launcher.exe'
        self.launcher_artifact.write_bytes(b'MZ offline lifecycle fixture; never executed')
        prompt = self.root / "input.md"
        prompt.write_text("Synthetic test task only. Review a counter function.", encoding="utf-8")
        self.prepared = bridge.prepare(self.root, SID, prompt, "review", BINDING)
        self.round = Path(self.prepared["roundDirectory"])

    def tearDown(self):
        self.temp.cleanup()

    def install(self, home):
        return bridge.lifecycle(home, 'install', claude_executable=Path(sys.executable).resolve(),
                                launcher_file=self.launcher_artifact, launcher_sha256=bridge.sha(self.launcher_artifact.read_bytes()))

    def completed_fixture(self):
        """Deliberately forged transport fixture, never reported as a live run."""
        directory = self.round / "sidebar"
        directory.mkdir()
        owner = {k:self.prepared[k] for k in ("hostKind","hostSessionId","transportThreadId","legacyTransportThreadField")}
        owner["codexThreadId"] = bridge.transport_id(SID)
        binding = {**BINDING, "url":URL}
        prompt = (self.round / "prompt.md").read_bytes()
        response = b"Offline synthetic evidence fixture; no real model called.\n"
        url = (URL + "\n").encode()
        for name, content in (("prompt.md",prompt),("response.md",response),("url.txt",url)):
            bridge.atomic(directory / name, content)
        evidence = {**owner,"schemaVersion":1,"live":True,"transport":"agent-browser-cli-v2",
            "prompt":{"file":"prompt.md","sha256":bridge.sha(prompt)},
            "response":{"file":"response.md","sha256":bridge.sha(response)},
            "conversation":{"file":"url.txt","sha256":bridge.sha(url),"url":URL,"boundAtSend":URL,"exact":True,"matchedBoundUrl":True},
            "extractor":{"targetBinding":binding},
            "submission":{"acknowledged":True,"automaticResendAllowed":False},
            "authority":{"externalOutputIsUntrusted":True,"workspaceOwnerHost":"claude","workspaceOwnerSessionId":SID,"codexIsSoleWorkspaceWriter":False,"claudeIsSoleWorkspaceWriter":True}}
        bridge.write_json(directory / "evidence.json", evidence)
        state = {**owner,"schemaVersion":1,"live":True,"transport":"agent-browser-cli-v2","phase":"completed",
            "automaticResendAllowed":False,"targetBinding":binding,"conversationUrl":URL,"conversationUrlBound":URL,
            "promptFile":"prompt.md","promptSha256":bridge.sha(prompt),"responseFile":"response.md","responseSha256":bridge.sha(response),
            "urlFile":"url.txt","urlSha256":bridge.sha(url),"evidenceFile":"evidence.json","evidenceSha256":bridge.sha((directory/"evidence.json").read_bytes())}
        watch = {**owner,"watcherId":OTHER,"rootWait":True,"noWake":True,"agentMonitor":False,"promptSha256":bridge.sha(prompt),"targetBinding":binding}
        event = {**owner,"watcherId":OTHER,"status":"completed","automaticResendAllowed":False,"requiresHostReview":True,"requiresCodexReview":False,
                 "evidenceDirectory":str(directory),"transport":"agent-browser-cli-v2","conversationUrl":URL,"targetBinding":binding}
        for name, data in (("state.json",state),("watch-state.json",watch),("watch-event.json",event)):
            bridge.write_json(directory/name,data)
        manifest = bridge.read_json(self.round/"claude-round.json")
        manifest["requestState"] = "started"
        bridge.write_json(self.round/"claude-round.json",manifest)
        return directory

    def mutate(self, directory, name, update):
        obj = bridge.read_json(directory/name)
        update(obj)
        bridge.write_json(directory/name,obj)
        if name == "evidence.json":
            state = bridge.read_json(directory/"state.json")
            state["evidenceSha256"] = bridge.sha((directory/name).read_bytes())
            bridge.write_json(directory/"state.json",state)

    def test_namespaced_real_host_identity(self):
        self.assertNotEqual(bridge.transport_id(SID),SID)
        self.assertNotEqual(bridge.transport_id(SID),bridge.transport_id(OTHER))
        with self.assertRaises(ValueError):
            bridge.session_id(SID.upper())
        with self.assertRaises(ValueError):
            bridge.identity({**self.prepared,"hostKind":"codex"},SID)

    def test_exact_import_and_repeated_import(self):
        self.completed_fixture()
        first = bridge.import_response(self.round,SID)
        second = bridge.import_response(self.round,SID)
        self.assertFalse(first["idempotent"])
        self.assertTrue(second["idempotent"])
        self.assertTrue(first["claudeIsSoleWorkspaceWriter"])
        self.assertFalse(first["codexIsSoleWorkspaceWriter"])
        self.assertNotEqual(first["transportThreadId"],first["hostSessionId"])

    def test_other_real_session_rejected(self):
        self.completed_fixture()
        with self.assertRaisesRegex(ValueError,"mismatch"):
            bridge.import_response(self.round,OTHER)
        self.assertFalse((self.round/"response.md").exists())

    def test_host_and_owner_mutations_rejected(self):
        directory = self.completed_fixture()
        originals = {n:(directory/n).read_bytes() for n in ("state.json","evidence.json","watch-event.json","watch-state.json")}
        cases = [("state.json",lambda d:d.update(hostKind="codex")),
                 ("watch-event.json",lambda d:d.update(hostSessionId=OTHER)),
                 ("watch-state.json",lambda d:d.update(transportThreadId=SID)),
                 ("evidence.json",lambda d:d["authority"].update(codexIsSoleWorkspaceWriter=True)),
                 ("watch-event.json",lambda d:d.update(requiresCodexReview=True)),
                 ("watch-state.json",lambda d:d.update(rootWait=False))]
        for name, change in cases:
            with self.subTest(file=name):
                for n, content in originals.items():bridge.atomic(directory/n,content)
                self.mutate(directory,name,change)
                with self.assertRaises(ValueError):bridge.import_response(self.round,SID)
                self.assertFalse((self.round/"response.md").exists())

    def test_target_terminal_hash_and_path_mutations_rejected(self):
        directory = self.completed_fixture()
        originals = {p.name:p.read_bytes() for p in directory.iterdir() if p.is_file()}
        cases = [("watch-event.json",lambda d:d.update(status="send-uncertain")),
                 ("state.json",lambda d:d.update(terminalOutcome="recovery-required")),
                 ("state.json",lambda d:d.update(responseSha256="0"*64)),
                 ("state.json",lambda d:d.update(responseFile="../response.md")),
                 ("watch-event.json",lambda d:d["targetBinding"].update(tabId="different-tab")),
                 ("evidence.json",lambda d:d["conversation"].update(boundAtSend="https://chatgpt.com/")),
                 ("evidence.json",lambda d:d.update(live=False)),
                 ("evidence.json",lambda d:d["submission"].update(automaticResendAllowed=True))]
        for name, change in cases:
            with self.subTest(file=name):
                for n, content in originals.items():bridge.atomic(directory/n,content)
                self.mutate(directory,name,change)
                with self.assertRaises(ValueError):bridge.import_response(self.round,SID)

    def test_lost_launch_is_preserved_and_never_retried(self):
        old = bridge.powershell
        calls = []
        def fail(*args,**kwargs):
            calls.append(args)
            raise OSError("offline intentional launch failure")
        bridge.powershell = fail
        try:
            with self.assertRaises(OSError):bridge.run_root(self.round,SID)
            self.assertEqual(bridge.read_json(self.round/"claude-round.json")["requestState"],"started")
            with self.assertRaisesRegex(ValueError,"once"):
                bridge.run_root(self.round,SID)
            self.assertEqual(len(calls),1)
        finally:
            bridge.powershell = old

    def zip_manifest(self, content="Synthetic ZIP test only", entry="README.txt"):
        path = self.root/"synthetic.zip"
        with zipfile.ZipFile(path,"w") as archive:archive.writestr(entry,content)
        file = {"path":str(path),"filename":path.name,"sizeBytes":path.stat().st_size,"sha256":bridge.sha(path.read_bytes())}
        manifest = {"schemaVersion":1,"targetBinding":BINDING,"files":[file]}
        mp = self.root/"attachments.json"
        bridge.write_json(mp,manifest)
        receipt = {"schemaVersion":1,"manifestSha256":bridge.sha(mp.read_bytes()),"targetBinding":BINDING,"ready":True,"messageSubmitted":False,
                   "files":[{**file,"phase":"ready","cardSignature":"synthetic-card"}],
                   "stabilityProof":{"schemaVersion":1,"intervalMilliseconds":500,"cardSetSignature":"synthetic-cards"}}
        rp = self.root/"attachment-receipt.json"
        bridge.write_json(rp,receipt)
        return mp,rp

    def test_zip_seals_and_mutation_rejection(self):
        mp,rp = self.zip_manifest()
        manifest = bridge.read_json(self.round/"claude-round.json")
        seal = bridge.seal_attachments(self.round,manifest,mp,rp)
        manifest["attachments"] = seal
        self.assertEqual(bridge.seal_attachments(self.round,manifest,mp,rp),seal)
        self.mutate(rp.parent,rp.name,lambda d:d.update(ready=False))
        with self.assertRaises(ValueError):bridge.seal_attachments(self.round,manifest,mp,rp)

    def test_unsafe_zip_and_credentials_fail_before_transport(self):
        for content, entry in (("safe","../escape.txt"),("sk-"+"A"*30,"README.txt")):
            with self.subTest(entry=entry):
                mp,rp = self.zip_manifest(content,entry)
                with self.assertRaises(ValueError):bridge.seal_attachments(self.round,self.prepared,mp,rp)

    def test_attachment_import_matches_original_send_seals(self):
        directory = self.completed_fixture()
        mp,rp = self.zip_manifest()
        manifest = bridge.read_json(self.round/"claude-round.json")
        seal = bridge.seal_attachments(self.round,manifest,mp,rp)
        manifest["attachments"] = seal
        bridge.write_json(self.round/"claude-round.json",manifest)
        self.mutate(directory,"state.json",lambda d:d.update(attachmentManifestSha256=seal["manifestSha256"],attachmentReceiptSha256=seal["receiptSha256"]))
        self.mutate(directory,"evidence.json",lambda d:d.update(attachments={"manifestSha256":seal["manifestSha256"],"receiptSha256":seal["receiptSha256"]}))
        self.assertTrue(bridge.import_response(self.round,SID)["imported"])
        self.mutate(directory,"state.json",lambda d:d.update(attachmentReceiptSha256="0"*64))
        with self.assertRaises(ValueError):bridge.import_response(self.round,SID)

    def test_owned_install_repeat_drift_uninstall_and_backup(self):
        home = self.root/"claude-home"
        home.mkdir()
        upstream = home/"commands"/"ccg"/"plan.md"
        bridge.atomic(upstream,b"Original CCG must remain unchanged.\n")
        settings = home/"settings.json"
        bridge.atomic(settings,b'{"existing":"preserve"}\n')
        pins = {p:bridge.sha(p.read_bytes()) for p in (upstream,settings)}
        installed = self.install(home)
        self.assertTrue(installed["changed"])
        self.assertFalse(bridge.lifecycle(home,"install")["changed"])
        target = Path(installed["target"])
        extra = target/"user-extra.txt"
        extra.write_text("Preserve user edit",encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"drift"):bridge.lifecycle(home,"uninstall")
        self.assertTrue(extra.is_file())
        extra.unlink()
        before = bridge.file_inventory(target)
        removed = bridge.lifecycle(home,"uninstall")
        self.assertFalse(target.exists())
        self.assertEqual(bridge.sha(Path(removed["backup"]).read_bytes()),removed["backupSha256"])
        with zipfile.ZipFile(removed["backup"]) as archive:
            recovered = {info.filename:bridge.sha(archive.read(info)) for info in archive.infolist()}
        self.assertEqual(recovered,before)
        self.assertEqual({p:bridge.sha(p.read_bytes()) for p in pins},pins)
        self.assertFalse(bridge.lifecycle(home,"uninstall")["changed"])

    def test_stale_prepared_manifest_cannot_invoke_transport_twice(self):
        old_read = bridge.bridge_round
        old_transport = bridge.powershell
        interleaved = []
        invocations = []
        def transport(*args, **kwargs):
            invocations.append(args)
            return subprocess.CompletedProcess([], 0, '{"ok":true}', '')
        def schedule(path, sid):
            cached = old_read(path, sid)
            if not interleaved:
                interleaved.append(True)
                # Caller B has read prepared. Caller A completes and releases its lock.
                bridge.run_root(path, sid)
            return cached
        bridge.bridge_round = schedule
        bridge.powershell = transport
        try:
            with self.assertRaisesRegex(ValueError, 'once'):
                bridge.run_root(self.round, SID)
            self.assertEqual(len(invocations), 1)
        finally:
            bridge.bridge_round = old_read
            bridge.powershell = old_transport

    def test_backup_junction_cannot_write_outside_owned_home(self):
        home = self.root / 'claude-home'
        home.mkdir()
        installed = self.install(home)
        backup = home / 'plugins' / 'local' / '.ccg-gptpro-bridge-backups'
        outside = self.root / 'external-owned-temp'
        outside.mkdir()
        if os.name == 'nt':
            result = subprocess.run(['cmd.exe', '/c', 'mklink', '/J', str(backup), str(outside)], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
        else:
            backup.symlink_to(outside, target_is_directory=True)
        try:
            with self.assertRaisesRegex(ValueError, 'Backup directory'):
                bridge.lifecycle(home, 'uninstall')
            self.assertTrue(Path(installed['target']).is_dir())
            self.assertEqual(list(outside.iterdir()), [])
        finally:
            if os.name == 'nt':
                os.rmdir(backup)  # remove only this confirmed temporary junction
            else:
                backup.unlink()

    def test_project_junction_cannot_receive_prompt_outside_project(self):
        project = self.root / 'isolated-project'
        project.mkdir()
        outside = self.root / 'outside-project-owned-temp'
        outside.mkdir()
        link = project / '.ccg'
        if os.name == 'nt':
            result = subprocess.run(['cmd.exe', '/c', 'mklink', '/J', str(link), str(outside)], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
        else:
            link.symlink_to(outside, target_is_directory=True)
        try:
            prompt = self.root / 'input.md'
            with self.assertRaisesRegex(ValueError, 'path'):
                bridge.prepare(project, SID, prompt, 'review', BINDING)
            self.assertEqual(list(outside.iterdir()), [])
        finally:
            if os.name == 'nt':
                os.rmdir(link)
            else:
                link.unlink()

    def test_unowned_directory_cannot_be_overwritten(self):
        home = self.root/"claude-home"
        destination = home/"plugins"/"local"/bridge.NAME
        destination.mkdir(parents=True)
        existing = destination/"user.txt"
        existing.write_text("keep",encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"unowned"):bridge.lifecycle(home,"install")
        self.assertEqual(existing.read_text(),"keep")

    def test_launcher_uses_exact_owned_plugin_and_preserves_argv_without_shell(self):
        home = self.root / 'launcher-home'
        home.mkdir()
        installed = self.install(home)
        directory = Path(installed['target'])
        arguments = ['--plugin-dir', 'foreign plugin', 'a"b', '', '末尾\\', '$(do-not-run); & literal']
        with mock.patch.object(bridge.subprocess, 'run', return_value=subprocess.CompletedProcess([], 7)) as run:
            self.assertEqual(bridge.launch(arguments, directory), 7)
            run.assert_called_once_with([str(Path(sys.executable).resolve()), '--plugin-dir', str(directory), *arguments], check=False, shell=False)
        self.assertTrue(Path(installed['launcher']).is_file())
        self.assertEqual(Path(installed['launcher']).read_bytes()[:2], b'MZ')
        (directory / 'commands/gptpro-plan.md').write_text('subsequent user edit', encoding='utf-8')
        with mock.patch.object(bridge.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'drift'):
                bridge.launch([], directory)
            run.assert_not_called()

    def test_rollback_exact_update_and_uninstall_preserves_foreign_settings(self):
        home = self.root / 'rollback-home'
        home.mkdir()
        settings = home / 'settings.json'
        settings.write_bytes(b'{"permissions":{"allow":["existing"]}}\n')
        original_settings = settings.read_bytes()
        first = self.install(home)
        before = bridge.file_inventory(Path(first['target']))
        source = self.root / 'updated-plugin-source'
        import shutil
        shutil.copytree(bridge.ROOT, source, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        (source / 'commands/gptpro-review.md').write_text('new reviewed owned version', encoding='utf-8')
        changed = bridge.lifecycle(home, 'install', source=source)
        self.assertTrue(changed['changed'])
        restored = bridge.rollback(home, Path(changed['backup']), changed['backupSha256'])
        self.assertTrue(restored['changed'])
        self.assertEqual(bridge.file_inventory(Path(first['target'])), before)
        self.assertFalse(bridge.rollback(home, Path(changed['backup']), changed['backupSha256'])['changed'])
        removed = bridge.lifecycle(home, 'uninstall')
        self.assertFalse(Path(first['target']).exists())
        bridge.rollback(home, Path(removed['backup']), removed['backupSha256'])
        self.assertEqual(bridge.file_inventory(Path(first['target'])), before)
        self.assertEqual(settings.read_bytes(), original_settings)

    def test_rollback_refuses_user_edit_and_added_file_without_any_write(self):
        home = self.root / 'rollback-drift-home'
        home.mkdir()
        first = self.install(home)
        removed = bridge.lifecycle(home, 'uninstall')
        bridge.rollback(home, Path(removed['backup']), removed['backupSha256'])
        directory = Path(first['target'])
        (directory / 'user-extra.txt').write_text('foreign user file', encoding='utf-8')
        (directory / 'commands/gptpro-plan.md').write_text('preserve user customization', encoding='utf-8')
        before = bridge.file_inventory(directory)
        backups = bridge.file_inventory(home / 'plugins/local/.ccg-gptpro-bridge-backups')
        with self.assertRaisesRegex(ValueError, 'drift'):
            bridge.rollback(home, Path(removed['backup']), removed['backupSha256'])
        self.assertEqual(bridge.file_inventory(directory), before)
        self.assertEqual(bridge.file_inventory(home / 'plugins/local/.ccg-gptpro-bridge-backups'), backups)

    def test_rollback_rejects_wrong_hash_and_unsafe_archive_before_writes(self):
        home = self.root / 'rollback-archive-home'
        home.mkdir()
        installed = self.install(home)
        removed = bridge.lifecycle(home, 'uninstall')
        backup = Path(removed['backup'])
        with self.assertRaisesRegex(ValueError, 'hash'):
            bridge.rollback(home, backup, '0' * 64)
        with zipfile.ZipFile(backup, 'a') as archive:
            archive.writestr('../outside.txt', b'unsafe')
        with self.assertRaisesRegex(ValueError, 'unsafe'):
            bridge.rollback(home, backup, bridge.sha(backup.read_bytes()))
        self.assertFalse(Path(installed['target']).exists())
        self.assertFalse((home / 'plugins/local/outside.txt').exists())

    def test_active_shared_launcher_lock_blocks_lifecycle_before_any_plugin_write(self):
        home = self.root / 'active-launcher-home'
        home.mkdir()
        installed = self.install(home)
        directory = Path(installed['target'])
        before = bridge.file_inventory(directory)
        with bridge.lifecycle_lock(home, shared=True):
            with bridge.lifecycle_lock(home, shared=True):
                with self.assertRaisesRegex(ValueError, 'holds'):
                    bridge.lifecycle(home, 'uninstall')
            self.assertEqual(bridge.file_inventory(directory), before)
        self.assertTrue(bridge.lifecycle(home, 'uninstall')['changed'])

    def test_mismatched_backup_archive_stops_before_removing_any_owned_file(self):
        home = self.root / 'backup-race-home'
        home.mkdir()
        installed = self.install(home)
        directory = Path(installed['target'])
        before = bridge.file_inventory(directory)
        original_write = zipfile.ZipFile.write
        def changed_copy(archive, filename, arcname=None, *args, **kwargs):
            if arcname == 'commands/gptpro-plan.md':
                archive.writestr(arcname, b'simulated changed read during backup, original restored before final recheck')
            else:
                original_write(archive, filename, arcname, *args, **kwargs)
        with mock.patch.object(zipfile.ZipFile, 'write', changed_copy):
            with self.assertRaisesRegex(ValueError, 'Backup content'):
                bridge.lifecycle(home, 'uninstall')
        self.assertEqual(bridge.file_inventory(directory), before)

    def test_runtime_test_results_are_not_source_owned_or_copied(self):
        source = self.root / 'source-with-runtime-results'
        import shutil
        shutil.copytree(bridge.ROOT, source, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        runtime = source / 'tests/results/runtime-private.log'
        runtime.parent.mkdir(parents=True, exist_ok=True)
        runtime.write_bytes(b'owned fixture runtime evidence, not plugin source')
        inventory = bridge.file_inventory(source, source_files=True)
        self.assertFalse(any(rel.startswith('tests/results/') for rel in inventory))
        home = self.root / 'clean-source-home'
        home.mkdir()
        installed = bridge.lifecycle(home, 'install', source=source, claude_executable=Path(sys.executable).resolve(),
                                     launcher_file=self.launcher_artifact, launcher_sha256=bridge.sha(self.launcher_artifact.read_bytes()))
        directory = Path(installed['target'])
        self.assertFalse((directory / 'tests/results').exists())
        owned = bridge.read_json(directory / '.bridge-ownership.json')
        self.assertFalse(any(rel.startswith('tests/results/') for rel in owned['files']))
        self.assertTrue(runtime.is_file())


if __name__ == "__main__":
    unittest.main(verbosity=2)
