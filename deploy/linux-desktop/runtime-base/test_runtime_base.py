"""Offline checks for the dependency-base lock and comparison rules."""

import importlib.util
import io
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
import re
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base_lock = load("base_lock", "base_lock.py")
compare_base = load("compare_base", "compare-base.py")

DPKG = "ii \tadduser\t3.134\tall\nii \tlibc6\t2.36-9+deb12u14\tamd64\nii \tplank\t0.11.89-4+b1\tamd64\n"
MANUAL = "plank\n"


class LockTest(unittest.TestCase):
    def test_round_trip_keeps_versions_and_marks(self):
        rows = base_lock.parse_installed(DPKG, MANUAL)
        text = base_lock.format_lock(rows, "sha256:" + "0" * 64)
        self.assertEqual(base_lock.read_lock(text), rows)
        self.assertEqual(rows[("plank", "amd64")], ("0.11.89-4+b1", "manual"))
        self.assertEqual(rows[("adduser", "all")], ("3.134", "auto"))

    def test_rejects_partial_installs_and_dangling_marks(self):
        with self.assertRaisesRegex(base_lock.LockError, "not fully installed"):
            base_lock.parse_installed("rc \tplank\t0.11.89-4+b1\tamd64\n", "")
        with self.assertRaisesRegex(base_lock.LockError, "not installed"):
            base_lock.parse_installed(DPKG, "gh\n")

    def test_rejects_malformed_or_duplicate_lines(self):
        for text in ("plank\t1\tamd64\n", "plank\t1\tamd64\tsometimes\n",
                     "plank\t1 2\tamd64\tauto\n", "# only a comment\n"):
            with self.assertRaises(base_lock.LockError):
                base_lock.read_lock(text)
        with self.assertRaisesRegex(base_lock.LockError, "duplicate"):
            base_lock.read_lock("plank\t1\tamd64\tauto\nplank\t2\tamd64\tauto\n")

    def test_preferences_pin_every_package_above_1000(self):
        rows = base_lock.parse_installed(DPKG, MANUAL)
        prefs = base_lock.preferences(rows)
        self.assertEqual(prefs.count("Pin-Priority: 1001"), 3)
        self.assertIn("Package: libc6\nPin: version 2.36-9+deb12u14\n", prefs)

    def test_differences_report_every_kind(self):
        expected = base_lock.parse_installed(DPKG, MANUAL)
        actual = dict(expected)
        del actual[("adduser", "all")]
        actual[("libc6", "amd64")] = ("2.36-9+deb12u15", "auto")
        actual[("plank", "amd64")] = ("0.11.89-4+b1", "auto")
        actual[("gh", "amd64")] = ("2.100.0", "manual")
        problems = base_lock.differences(expected, actual)
        self.assertEqual(len(problems), 4)
        self.assertTrue(any(p.startswith("missing adduser") for p in problems))
        self.assertTrue(any(p.startswith("unexpected gh") for p in problems))
        self.assertTrue(any("2.36-9+deb12u15" in p for p in problems))
        self.assertTrue(any(p.startswith("mark plank") for p in problems))

    def test_verify_exit_codes(self):
        lock = base_lock.format_lock(base_lock.parse_installed(DPKG, MANUAL), "test")
        with tempfile.NamedTemporaryFile("w", suffix=".lock") as handle:
            handle.write(lock)
            handle.flush()
            for manual, code in ((MANUAL, 0), ("", 1)):
                outputs = {"dpkg-query": DPKG, "apt-mark": manual}
                with mock.patch.object(base_lock, "run", side_effect=lambda *c: outputs[c[0]]), \
                        redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                    self.assertEqual(base_lock.main(["verify", handle.name]), code)

    def test_manual_excludes_only_locked_names(self):
        lock = base_lock.format_lock(base_lock.parse_installed(DPKG, MANUAL), "test")
        with tempfile.NamedTemporaryFile("w", suffix=".lock") as handle:
            handle.write(lock)
            handle.flush()
            out = io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(base_lock.main(["manual", handle.name]), 0)
            self.assertEqual(out.getvalue(), "plank\n")
            with redirect_stderr(io.StringIO()):
                self.assertEqual(base_lock.main(["manual", handle.name, "--exclude", "gh"]), 2)

    def test_capture_rejects_mutable_tags(self):
        with self.assertRaisesRegex(base_lock.LockError, "mutable tag"):
            base_lock.capture("cindy-runtime-cn:latest")

    def test_committed_lock_is_valid_and_consistent(self):
        rows = base_lock.read_lock((HERE / "packages.lock").read_text())
        self.assertEqual(rows[("google-chrome-stable", "amd64")], ("155.0.8059.84-1", "manual"))
        self.assertEqual(rows[("libc6", "amd64")][0], "2.36-9+deb12u14")
        dockerfile = (HERE / "Dockerfile").read_text()
        # Files extracted without installing must not also be locked packages,
        # and every downloaded package needs its own checksum line.
        command = re.search(r"apt-get [^\n]*\bdownload (.*?)\nsha256sum", dockerfile, re.S).group(1)
        names = re.findall(r"\b([a-z0-9][a-z0-9.+-]+)=[0-9][^ \\\n]*", command)
        self.assertEqual(len(names), 6)
        sums = dockerfile.split("<<'SUMS'", 1)[1].split("SUMS", 1)[0]
        for name in names:
            self.assertNotIn((name, "all"), rows)
            self.assertNotIn((name, "amd64"), rows)
            self.assertRegex(sums, rf"\n[0-9a-f]{{64}}  {re.escape(name)}_")
        # The extracted locale sources must match the locked C library.
        self.assertIn("locales=" + rows[("libc6", "amd64")][0], dockerfile)


def row(sha="a", mode=0o644, **extra):
    return {"type": "0", "mode": mode, "uid": 0, "gid": 0, "xattrs": {}, "size": 1, "sha256": sha, **extra}


class CompareTest(unittest.TestCase):
    def test_identical_payload_passes(self):
        files = {"usr/bin/xvfb-run": row()}
        self.assertEqual(compare_base.classify(files, dict(files))["unexpected"], [])

    def test_release_layer_and_leftovers_may_only_be_absent(self):
        reference = {"usr/local/bin/cindy-seccomp": row(), "home/cindy/.cache/rosetta": row(),
                     "opt/cindy/Cindy": row()}
        result = compare_base.classify(reference, {})
        self.assertEqual(result["unexpected"], [])
        self.assertEqual(result["release-layer"], ["opt/cindy/Cindy", "usr/local/bin/cindy-seccomp"])
        # A base that ships Cindy-owned files fails, even with identical bytes.
        result = compare_base.classify({}, {"usr/local/lib/cindy/seccomp.json": row()})
        self.assertEqual(result["unexpected"], ["usr/local/lib/cindy/seccomp.json"])

    def test_regenerated_files_keep_metadata(self):
        result = compare_base.classify({"var/log/dpkg.log": row("a")}, {"var/log/dpkg.log": row("b")})
        self.assertEqual(result["regenerated"], ["var/log/dpkg.log"])
        result = compare_base.classify({"var/log/dpkg.log": row(mode=0o644)},
                                       {"var/log/dpkg.log": row(mode=0o666)})
        self.assertEqual(result["unexpected"], ["var/log/dpkg.log"])

    def test_any_other_change_is_unexpected(self):
        for candidate in ({"usr/bin/plank": row("b")}, {"usr/bin/plank": row(mode=0o4755)}, {}):
            result = compare_base.classify({"usr/bin/plank": row()}, candidate)
            self.assertEqual(result["unexpected"], ["usr/bin/plank"])

    def test_order_insensitive_files_need_identical_sorted_records(self):
        path = "var/lib/apt/extended_states"
        ref, new = {path: row("a")}, {path: row("b")}
        self.assertEqual(compare_base.order_paths(ref, new), [path])
        a = b"Package: x\nAuto-Installed: 1\n\nPackage: y\nAuto-Installed: 1\n"
        b = b"Package: y\nAuto-Installed: 1\n\nPackage: x\nAuto-Installed: 1\n"
        self.assertEqual(compare_base.classify(ref, new, {path: (a, b)})["order-insensitive"], [path])
        c = b"Package: y\nAuto-Installed: 0\n\nPackage: x\nAuto-Installed: 1\n"
        self.assertEqual(compare_base.classify(ref, new, {path: (a, c)})["unexpected"], [path])
        # Without the file contents nothing is assumed.
        self.assertEqual(compare_base.classify(ref, new)["unexpected"], [path])
        lines = "var/lib/dpkg/triggers/File"
        self.assertEqual(compare_base.classify({lines: row("a")}, {lines: row("b")},
                                               {lines: (b"a x\nb y\n", b"b y\na x\n")})["unexpected"], [])

    def test_transient_and_tmp_rules(self):
        status = "var/lib/dpkg/status-old"
        self.assertEqual(compare_base.classify({status: row("a")}, {status: row("b")})["transient"], [status])
        self.assertEqual(compare_base.classify({status: row("a")}, {})["unexpected"], [status])
        cache = "tmp/node-compile-cache/v24/1"
        self.assertEqual(compare_base.classify({cache: row()}, {})["build-leftover"], [cache])
        self.assertEqual(compare_base.classify({}, {cache: row()})["unexpected"], [cache])
        # dpkg's live status database has no exemption.
        live = "var/lib/dpkg/status"
        self.assertEqual(compare_base.classify({live: row("a")}, {live: row("b")})["unexpected"], [live])

    def test_sources_may_change_content_only(self):
        path = "etc/apt/sources.list.d/debian.sources"
        self.assertEqual(compare_base.classify({path: row("a")}, {path: row("b")})["unexpected"], [])
        self.assertEqual(compare_base.classify({path: row("a")}, {})["unexpected"], [path])

    def test_config_requires_single_layer_base_without_command(self):
        info = {"Os": "linux", "Architecture": "amd64", "RootFS": {"Layers": ["sha256:x"]},
                "Config": {"Env": ["LANG=zh_CN.UTF-8", "NODE_VERSION=24.19.0"]}}
        self.assertEqual(compare_base.check_config(info), [])
        info["Config"]["Cmd"] = ["/opt/cindy/Cindy"]
        info["RootFS"]["Layers"].append("sha256:y")
        self.assertEqual(compare_base.check_config(info), ["layers", "start-command"])


if __name__ == "__main__":
    unittest.main()
