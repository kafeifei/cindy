"""Run inside an isolated, package-complete Linux image; never a real user home."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).with_name("apply-dock-apps.py")
SCHEMA = "net.launchpad.plank.dock.settings:/net/launchpad/plank/docks/dock1/"


class DockMigrationTest(unittest.TestCase):
    def exercise(self, existing):
        self.assertEqual(os.geteuid(), 0, "run isolated test container as root")
        with tempfile.TemporaryDirectory(prefix="cindy-dock-test-") as temp:
            root = Path(temp)
            root.chmod(0o755)
            home = root / "home"
            home.mkdir()
            os.chown(home, 10001, 10001)
            local = home / ".local"
            share = local / "share"
            share.mkdir(parents=True)
            for directory in (local, share):
                os.chown(directory, 0, 10001)
                directory.chmod(0o2755)
            before_metadata = [(d.stat().st_uid, d.stat().st_gid, d.stat().st_mode) for d in (local, share)]
            env = {"PATH": "/usr/bin:/bin", "HOME": str(home),
                   "XDG_CONFIG_HOME": str(home / ".config"), "GSETTINGS_BACKEND": "keyfile"}

            def demote():
                os.setgroups([])
                os.setgid(10001)
                os.setuid(10001)

            def run(*args):
                return subprocess.run(args, env=env, preexec_fn=demote, check=True,
                                      capture_output=True, text=True, timeout=20).stdout.strip()

            pins = home / ".config/plank/dock1/launchers"
            if existing:
                run("python3", "-c", "from pathlib import Path; h=Path.home(); "
                    "p=h/'.config/plank/dock1/launchers'; p.mkdir(parents=True); "
                    "(p/'cindy-terminal.dockitem').write_text('old pin'); "
                    "(p/'custom.dockitem').write_text('keep custom'); "
                    "m=h/'.config/cindy-desktop/plank-apps-v2'; "
                    "m.parent.mkdir(parents=True); m.write_text('v2')")
                run("gsettings", "set", SCHEMA, "icon-size", "44")
                run("gsettings", "set", SCHEMA, "zoom-enabled", "true")
            run("python3", str(SOURCE))
            self.assertEqual(run("gsettings", "get", SCHEMA, "icon-size"), "44" if existing else "40")
            self.assertEqual(run("gsettings", "get", SCHEMA, "zoom-enabled"), "true" if existing else "false")
            self.assertEqual(list(share.iterdir()), [])
            self.assertEqual(before_metadata, [(d.stat().st_uid, d.stat().st_gid, d.stat().st_mode) for d in (local, share)])
            for app in ("terminal", "chrome"):
                self.assertIn("file:///usr/share/applications/com.cindy.cloud-" + app + ".desktop",
                              (pins / ("cindy-" + app + ".dockitem")).read_text())
            if existing:
                self.assertEqual((pins / "custom.dockitem").read_text(), "keep custom")
                self.assertEqual((home / ".config/cindy-desktop/plank-apps-v3-before/cindy-terminal.dockitem").read_text(), "old pin")
            def snapshot():
                return {str(f.relative_to(home)): hashlib.sha256(f.read_bytes()).hexdigest()
                        for f in home.rglob("*") if f.is_file()}
            before = snapshot()
            run("python3", str(SOURCE))
            self.assertEqual(before, snapshot())

    def test_fresh_legacy_home(self):
        self.exercise(False)

    def test_existing_pins_and_preferences(self):
        self.exercise(True)


if __name__ == "__main__":
    unittest.main()
