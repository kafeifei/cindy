import importlib.util
import hashlib
import json
import shlex
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
    def test_local_copy_inputs_are_allowed_through_dockerignore(self):
        # COPY inputs may exist on disk yet disappear from BuildKit's context.
        # Check the real Dockerfile's input roots, including parent directories.
        rules = (HERE / 'Dockerfile.dockerignore').read_text().splitlines()
        self.assertEqual(rules[0], '*')
        roots = set()
        for line in (HERE / 'Dockerfile').read_text().splitlines():
            if not line.startswith('COPY '):
                continue
            parts = shlex.split(line)
            if parts and parts[0] == 'COPY' and not any(p.startswith('--from=') for p in parts):
                roots.update(p.split('/')[0] for p in parts[1:-1] if not p.startswith('--'))
        for root in roots:
            with self.subTest(root=root):
                self.assertIn('!' + root + '/', rules)
                self.assertIn('!' + root + '/**', rules)
        # Dependency caches and Git metadata remain excluded after the allowlist.
        for excluded in ['**/node_modules', '**/.git', '**/__pycache__']:
            self.assertGreater(rules.index(excluded), max(i for i, r in enumerate(rules) if r.startswith('!')))

    def test_registry_cache_survives_runner_replacement_without_overlapping_writers(self):
        targets = build.bake_plan(Path('/records'), 'example:unique', 'app-commit', 'sha', False,
            2, 'base-commit', 'registry.example.com/cindy/build-cache')['target']
        self.assertEqual(targets['base']['args']['CINDY_SOURCE_COMMIT'], 'base-commit')
        self.assertEqual(targets['runtime']['args']['CINDY_SOURCE_COMMIT'], 'app-commit')
        exports = [t['cache-to'][0] for t in targets.values() if 'cache-to' in t]
        self.assertEqual(len(exports), 2)
        self.assertEqual(len(set(exports)), 2)
        self.assertTrue(all('mode=max' in x and 'ignore-error' not in x for x in exports))
        self.assertEqual(targets['records']['cache-from'], targets['runtime']['cache-from'])
        self.assertNotIn('cache-to', targets['records'])

    def test_cold_rebuild_does_not_import_cache_or_accept_injected_options(self):
        targets = build.bake_plan(Path('/records'), 'example:unique', 'commit', 'sha', True,
            cache_repository='registry.example.com/cindy/build-cache')['target']
        self.assertTrue(all(t['cache-from'] == [] for t in targets.values()))
        for bad in ['https://registry.example.com/repo', 'user:password@registry.example.com/repo',
                    'registry.example.com/repo:latest', 'registry.example.com/repo,mode=min', '../repo']:
            with self.subTest(value=bad), self.assertRaises(ValueError): build.registry_cache(bad)

    def test_docs_and_provenance_do_not_invalidate_base_or_application_inputs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            recipe = root / 'recipe'
            files = {p: 'locked input' for p in build.BASE_INPUTS}
            files.update({'README.md': 'docs', 'delivery/version.json': 'version',
                'build-inputs.json': 'commit metadata', 'runtime-base/README.md': 'base docs',
                'runtime-guidance/default.md': 'runtime prompt',
                'runtime-input/bridge.mjs': 'runtime code', 'runtime-input/bridge.test.mjs': 'test'})
            for name, data in files.items():
                p=recipe/name; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(data)
            build.stage_recipe_contexts(root)
            def snapshot(directory):
                return {p.relative_to(directory).as_posix():p.read_bytes() for p in directory.rglob('*') if p.is_file()}
            base=snapshot(root/'base-recipe'); app=snapshot(root/'build-recipe')
            self.assertEqual(set(base), set(build.BASE_INPUTS))
            self.assertIn('runtime-guidance/default.md', app)
            self.assertNotIn('build-inputs.json',app)
            for name in ['README.md','build-inputs.json','delivery/version.json','runtime-base/README.md']:
                (recipe/name).write_text('changed unrelated input')
            shutil.rmtree(root/'base-recipe'); shutil.rmtree(root/'build-recipe')
            build.stage_recipe_contexts(root)
            self.assertEqual(base,snapshot(root/'base-recipe'))
            self.assertEqual(app,snapshot(root/'build-recipe'))
            (recipe/'runtime-base/packages.lock').write_text('changed lock')
            (recipe/'runtime-guidance/default.md').write_text('changed prompt')
            shutil.rmtree(root/'base-recipe'); shutil.rmtree(root/'build-recipe')
            build.stage_recipe_contexts(root)
            self.assertNotEqual(base,snapshot(root/'base-recipe'))
            self.assertNotEqual(app,snapshot(root/'build-recipe'))

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
