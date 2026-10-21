import hashlib
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

from install_aliyun_cli import install


def fixture(name='aliyun', kind=tarfile.REGTYPE):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        entry = tarfile.TarInfo(name)
        entry.type = kind
        entry.linkname = '/outside/fixture' if kind == tarfile.SYMTYPE else ''
        data = b'fixture-binary' if kind == tarfile.REGTYPE else b''
        entry.size = len(data)
        archive.addfile(entry, io.BytesIO(data))
    return output.getvalue()


class InstallCliTest(unittest.TestCase):
    def test_installs_only_into_new_directory_with_executable_mode(self):
        data = fixture()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'cli'
            target = install(data, output, hashlib.sha256(data).hexdigest())
            self.assertEqual(target.read_bytes(), b'fixture-binary')
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertEqual(target.stat().st_mode & 0o777, 0o755)
            with self.assertRaises(FileExistsError):
                install(data, output, hashlib.sha256(data).hexdigest())

    def test_rejects_modified_archive_before_writing(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'cli'
            with self.assertRaisesRegex(ValueError, 'CHECKSUM'):
                install(fixture(), output, '0' * 64)
            self.assertFalse(output.exists())

    def test_rejects_paths_and_symlinks(self):
        for name, kind in [('../aliyun', tarfile.REGTYPE), ('/aliyun', tarfile.REGTYPE),
                           ('aliyun', tarfile.SYMTYPE), ('unexpected', tarfile.REGTYPE)]:
            data = fixture(name, kind)
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as folder:
                output = Path(folder) / 'cli'
                with self.assertRaisesRegex(ValueError, 'INVALID_ARCHIVE'):
                    install(data, output, hashlib.sha256(data).hexdigest())
                self.assertFalse(output.exists())

    def test_workflow_installs_without_privilege_before_build(self):
        workflow = (Path(__file__).resolve().parents[3] / '.github/workflows/cloud-image-delivery.yml').read_text()
        self.assertNotIn('setup-aliyun-cli-action', workflow)
        candidate = workflow.split('  candidate:', 1)[1].split('  cache:', 1)[0]
        self.assertLess(candidate.index('install_aliyun_cli.py'), candidate.index('build-image.py'))
        self.assertEqual(workflow.count('python3 deploy/linux-desktop/delivery/install_aliyun_cli.py'), 2)


if __name__ == '__main__':
    unittest.main()
