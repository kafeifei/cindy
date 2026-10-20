import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('runtime_audit', HERE / 'audit-runtime-layer.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

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
