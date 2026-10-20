import importlib.util
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('runtime_audit', HERE / 'audit-runtime-layer.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
build_spec = importlib.util.spec_from_file_location('source_build', HERE / 'build-image.py')
build = importlib.util.module_from_spec(build_spec)
build_spec.loader.exec_module(build)
agent_spec = importlib.util.spec_from_file_location('stage_agents', HERE / 'stage-runtime-agents.py')
agents = importlib.util.module_from_spec(agent_spec)
agent_spec.loader.exec_module(agents)

class AgentStagingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.artifact = self.root / 'artifact'
        for tool in ['shared', 'codex-package']:
            shutil.copytree(HERE.parents[1] / 'tools' / tool, self.source / 'tools' / tool)
        self.claude = self.source / 'apps/claude-code-bin/linux-x64/claude'
        self.claude.parent.mkdir(parents=True)
        self.claude.write_bytes(b'synthetic CLI')
        (self.source / 'tools/claude').mkdir()
        (self.source / 'tools/claude/latest.json').write_text(json.dumps({'version': 'fixture', 'runtimeAssets': {'linux-x64': {'size': 13, 'sha256': hashlib.sha256(b'synthetic CLI').hexdigest()}}}))
        self.codex = self.source / 'apps/codex-package-bin/linux-x64'
        for path in ['bin/codex', 'bin/codex-code-mode-host', 'codex-path/rg', 'codex-resources/helper']:
            p = self.codex / path; p.parent.mkdir(parents=True, exist_ok=True); p.write_text('fixture')
        (self.codex / 'codex-package.json').write_text(json.dumps({'layoutVersion': 1, 'version': 'fixture', 'target': 'x86_64-unknown-linux-musl', 'variant': 'codex', 'entrypoint': 'bin/codex', 'resourcesDir': 'codex-resources', 'pathDir': 'codex-path'}))
        (self.codex / '.version').write_text('fixture')
        (self.codex / '.asset-digest.bin').write_text('a' * 64)
        (self.source / 'tools/codex-package/latest.json').write_text(json.dumps({'version': 'fixture', 'runtimeAssets': {'linux-x64': {'sha256': 'a' * 64, 'target': 'x86_64-unknown-linux-musl', 'entrypoint': 'bin/codex'}}}))
        rows = [{'path': p.relative_to(self.codex).as_posix(), 'size': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in self.codex.rglob('*') if p.is_file() and p.name != '.version']
        (self.codex / '.manifest').write_text(json.dumps({'files': rows}))

    def test_full_cli_package_is_staged_and_recorded(self):
        agents.stage(self.source, self.artifact)
        self.assertEqual((self.artifact / 'cindy/resources/cloud-runtimes/claude/claude').read_bytes(), b'synthetic CLI')
        self.assertTrue((self.artifact / 'cindy/resources/cloud-runtimes/codex/codex-resources/helper').is_file())
        self.assertTrue(json.loads((self.artifact / 'agent-source-proof.json').read_text())['codex']['directoryVerified'])

    def test_rejects_corrupt_binary_before_copy(self):
        self.claude.write_bytes(b'changed bytes')
        with self.assertRaisesRegex(ValueError, 'CLAUDE_PIN_MISMATCH'): agents.stage(self.source, self.artifact)
        self.assertFalse(self.artifact.exists())

    def test_rejects_agent_links_and_unlisted_payload(self):
        (self.codex / 'escape').symlink_to(self.claude)
        with self.assertRaisesRegex(ValueError, 'CODEX_DIRECTORY_REQUIRED'): agents.stage(self.source, self.artifact)
        (self.codex / 'escape').unlink()
        (self.codex / 'unexpected').write_text('unverified extra')
        with self.assertRaises(subprocess.CalledProcessError): agents.stage(self.source, self.artifact)
        self.assertFalse(self.artifact.exists())

class BuildGraphTest(unittest.TestCase):
    def test_remote_targets_use_fresh_base_without_registry_roundtrip(self):
        plan = build.bake_plan(Path('/private/records'), 'example:unique', 'commit', 'entrysha', True)['target']
        self.assertEqual(plan['base']['target'], 'runtime-base-slim')
        for name in ['runtime', 'records']:
            self.assertEqual(plan[name]['contexts'], {'cindy-source-base': 'target:base'})
            self.assertEqual(plan[name]['args']['BASE_IMAGE'], 'cindy-source-base')
            self.assertEqual(plan[name]['args']['CINDY_SOURCE_COMMIT'], 'commit')
            self.assertTrue(plan[name]['no-cache'])
        self.assertEqual(plan['records']['target'], 'build-records')
        self.assertEqual(plan['records']['output'], ['type=local,dest=/private/records/records'])
        self.assertTrue(all('push=' not in out for t in plan.values() for out in t['output']))

class RuntimeLayerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.artifact = self.root / 'artifact'
        for name in ['Cindy', 'chrome_crashpad_handler',
                     'resources/cloud-runtimes/claude/claude',
                     'resources/cloud-runtimes/codex/bin/codex']:
            p = self.artifact / 'cindy' / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('fixture executable\n')
            p.chmod(0o700)
        for name in ['profile-maintenance-context.mjs', 'profile-runtime-wire.mjs']:
            (self.artifact / name).write_text('// synthetic build output\n')
        self.layer = self.root / 'layer'
        subprocess.run([sys.executable, str(HERE / 'assemble-runtime.py'),
                        str(self.artifact), str(self.layer)], check=True)

    def test_complete_layer_and_sources(self):
        result = audit.audit(self.layer)
        self.assertTrue(result['layerSha256'])
        self.assertEqual((self.layer / 'usr/local/bin/cindy-seccomp').read_bytes(),
                         (HERE / 'runtime-support/seccomp-launch.py').read_bytes())
        self.assertEqual((self.layer / 'usr/bin/chromium').read_bytes(),
                         (HERE / 'runtime-support/chromium-compat').read_bytes())
        self.assertEqual((self.layer / 'usr/local/bin/codex').readlink(),
                         Path('/opt/cindy/resources/cloud-runtimes/codex/bin/codex'))

    def test_rejects_restrictive_directories_and_setuid(self):
        directory = self.layer / 'opt/cindy'
        directory.chmod(0o700)
        with self.assertRaisesRegex(ValueError, 'DIRECTORY_PERMISSION'): audit.audit(self.layer)
        directory.chmod(0o755)
        (directory / 'Cindy').chmod(0o4755)
        with self.assertRaisesRegex(ValueError, 'FILE_PERMISSION'): audit.audit(self.layer)

    def test_rejects_missing_entrypoint_and_escaping_links(self):
        entry = self.layer / 'usr/local/bin/cindy-seccomp'
        entry.unlink()
        with self.assertRaisesRegex(ValueError, 'MISSING_EXECUTABLE'): audit.audit(self.layer)
        entry.symlink_to('/etc/passwd')
        with self.assertRaisesRegex(ValueError, 'UNREVIEWED_LINK'): audit.audit(self.layer)

if __name__ == '__main__': unittest.main()
