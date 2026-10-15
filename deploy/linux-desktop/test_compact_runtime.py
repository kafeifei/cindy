import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location("compact_runtime", Path(__file__).with_name("compact-runtime.py"))
compact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compact)


class CompactRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "User": "cindy", "Env": ["HOME=/home/cindy"],
            "Entrypoint": ["/usr/local/bin/cindy-seccomp", "/usr/local/bin/cindy-linux-desktop"],
            "Cmd": ["/opt/cindy/Cindy"], "Labels": {"io.cindy.region": "cn"},
            "ArgsEscaped": True,
        }

    def test_only_digest_pinned_images_are_accepted(self):
        for ref in ["example.test/runtime:latest", "example.test/runtime@sha256:abc", "x\nRUN evil"]:
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                compact.recipe(ref, self.config)
        compact.recipe("example.test/runtime@sha256:" + "a" * 64, self.config)

    def test_local_image_id_uses_a_dedicated_alias_without_accepting_mutable_tags(self):
        source = "sha256:" + "b" * 64
        self.assertEqual(compact.source_reference(source), "cindy-compact-source:" + "b" * 64)
        self.assertIn("FROM cindy-compact-source:" + "b" * 64 + " AS validated",
                      compact.recipe(source, self.config))
        with self.assertRaises(ValueError):
            compact.recipe("cindy-compact-source:" + "b" * 64, self.config)

    def test_config_that_could_execute_or_hide_files_is_not_silently_dropped(self):
        for field, value in [("OnBuild", ["RUN evil"]), ("Volumes", {"/opt/cindy": {}}),
                             ("Healthcheck", {"Test": ["CMD", "true"]}), ("Shell", ["sh"])]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                compact.metadata({**self.config, field: value})

    def test_metadata_cannot_inject_dockerfile_instructions_or_expand_variables(self):
        for value in ["value\nUSER root", "${HOST_TOKEN}", "value\rRUN command", "\x00"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                compact.metadata({**self.config, "Env": ["KEY=" + value]})

    def test_exec_form_and_root_workdir_are_required(self):
        for key, value in [("Entrypoint", "sh -c something"), ("Cmd", []), ("WorkingDir", "/data")]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                compact.metadata({**self.config, key: value})

    def test_metadata_equivalence_only_normalizes_default_workdir(self):
        self.assertEqual(compact.normalized_config(self.config),
                         compact.normalized_config({**self.config, "WorkingDir": "/"}))
        self.assertNotEqual(compact.normalized_config(self.config),
                            compact.normalized_config({**self.config, "User": "root"}))

    def test_application_prefix_does_not_match_other_runtime_files(self):
        self.assertTrue(compact.is_app("opt/cindy"))
        self.assertTrue(compact.is_app("opt/cindy/resources/app.asar"))
        self.assertFalse(compact.is_app("opt/cindy-tools/cli"))
        self.assertFalse(compact.is_app("usr/local/lib/cindy/profile-supervisor.mjs"))

    def test_equivalence_detects_missing_files_modes_links_capabilities_and_content(self):
        original = {"file": {"mode": 0o4755, "uid": 0, "gid": 0, "sha256": "digest",
                             "hardlinks": ["file", "other"],
                             "xattrs": {"SCHILY.xattr.security.capability": "cap"}}}
        for field, value in [("mode", 0o755), ("uid", 10001), ("sha256", "changed"),
                             ("hardlinks", ["file"]), ("xattrs", {})]:
            with self.subTest(field=field):
                changed = {"file": {**original["file"], field: value}}
                self.assertEqual(compact.differences(original, changed), ["file"])
        self.assertEqual(compact.differences(original, {}), ["file"])


if __name__ == "__main__":
    unittest.main()
