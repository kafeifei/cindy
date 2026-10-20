import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'migration', pathlib.Path(__file__).with_name('retire-legacy-dock-entries.py'))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class LegacyEntries(unittest.TestCase):
    def test_exact_managed_entries_are_archived_and_rerun_is_noop(self):
        with tempfile.TemporaryDirectory() as root:
            home = pathlib.Path(root) / 'home'
            entries = home / '.local/share/applications'
            system = pathlib.Path(root) / 'system'
            entries.mkdir(parents=True)
            system.mkdir()
            before = entries.stat()
            for name in ('terminal', 'chrome'):
                content = f'[Desktop Entry]\nExec=/usr/local/bin/cindy-dock-{name}\n'
                (entries / f'cindy-dock-{name}.desktop').write_text(content)
                (system / f'com.cindy.cloud-{name}.desktop').write_text(content)
            result = migration.retire(home, system)
            self.assertEqual(len(result['archived']), 2)
            backups = list((home / '.config/cindy-desktop/legacy-user-desktop-entries').glob('*.bak'))
            self.assertEqual(len(backups), 2)
            for backup in backups:
                name = backup.name.split('.')[0].removeprefix('cindy-dock-')
                self.assertEqual(backup.read_bytes(), (system / f'com.cindy.cloud-{name}.desktop').read_bytes())
            self.assertEqual(migration.retire(home, system), {'archived': [], 'preserved': []})
            self.assertEqual((entries.stat().st_mode, entries.stat().st_uid), (before.st_mode, before.st_uid))

    def test_custom_launcher_and_symlink_are_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            home = pathlib.Path(root)
            entries = home / '.local/share/applications'
            entries.mkdir(parents=True)
            system = home / 'system'
            system.mkdir()
            custom = entries / 'cindy-dock-terminal.desktop'
            custom.write_text('user-custom-command')
            (system / 'com.cindy.cloud-terminal.desktop').write_text('managed-command')
            link = entries / 'cindy-dock-chrome.desktop'
            link.symlink_to(custom)
            result = migration.retire(home, system)
            self.assertEqual(len(result['preserved']), 2)
            self.assertEqual(custom.read_text(), 'user-custom-command')
            self.assertTrue(link.is_symlink())
            self.assertFalse((home / '.config').exists())

    def test_absent_legacy_directory_is_not_created(self):
        with tempfile.TemporaryDirectory() as root:
            home = pathlib.Path(root)
            self.assertEqual(migration.retire(home), {'archived': [], 'preserved': []})
            self.assertEqual(list(home.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
