import ast
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import smoke


class RendererIdentityTest(unittest.TestCase):
    def test_matches_real_process_arguments_and_rewritten_chromium_titles(self):
        # Exercise the exact predicate sent to the Linux probe, without running
        # its Linux-only desktop checks on the unit-test host.
        predicate = next(n for n in ast.parse(smoke.CHECK).body
                         if isinstance(n, ast.FunctionDef) and n.name == 'is_cindy_renderer')
        scope = {}
        exec(compile(ast.Module(body=[predicate], type_ignores=[]), '<renderer-predicate>', 'exec'), scope)
        matches = scope['is_cindy_renderer']
        self.assertTrue(matches(b'/opt/cindy/Cindy\0--type=renderer\0--user-data-dir=/tmp/test\0'))
        self.assertTrue(matches(b'/opt/cindy/Cindy --type=renderer --user-data-dir=/tmp/test\0'))
        self.assertFalse(matches(b'python3\0-c\0' + smoke.CHECK.encode() + b'\0'))
        self.assertFalse(matches(b'/bin/sh\0-c\0/opt/cindy/Cindy --type=renderer\0'))
        self.assertFalse(matches(b'/opt/cindy/Cindy\0--type=gpu-process\0'))
        self.assertFalse(matches(b'/opt/cindy/Cindy --type=renderer-helper\0'))
        self.assertFalse(matches(b''))


class SmokeLifecycleTest(unittest.TestCase):
    def exercise(self, *, starts=True, check_passes=True, shutdown_code=0, oom=False, app_version="0.1.108-cloud.2"):
        calls = []
        stopped = False

        def command(*args, **kwargs):
            nonlocal stopped
            calls.append(args)
            value = ''
            if args[0] == 'info':
                value = {'Architecture': 'x86_64', 'OSType': 'linux'}
            elif args[:2] == ('image', 'inspect'):
                value = [{'Id': 'sha256:' + 'a' * 64, 'Config': {'Labels': {'org.opencontainers.image.version': '0.1.108-cloud.2'}}}]
            elif args[0] == 'inspect':
                value = [{'State': {'Running': starts and not stopped,
                                    'ExitCode': shutdown_code if stopped else 1,
                                    'OOMKilled': oom if stopped else False},
                          'HostConfig': {'NetworkMode': 'none', 'ReadonlyRootfs': True}}]
            elif args[0] == 'exec':
                if not check_passes:
                    return subprocess.CompletedProcess(args, 1, '', 'synthetic failed permission check')
                value = {'desktopReady': True, 'sandboxedRenderers': True, 'legacyHome': True, 'applicationVersion': app_version}
            elif args[0] == 'stop':
                stopped = True
            elif args[0] == 'logs':
                value = 'synthetic startup diagnostic'
            return subprocess.CompletedProcess(args, 0, json.dumps(value) if not isinstance(value, str) else value, '')

        with tempfile.TemporaryDirectory(prefix='cindy-delivery-smoke-test-', dir=tempfile.gettempdir()) as root:
            output = Path(root) / 'proof.json'
            error = None
            with patch.object(smoke.platform, 'system', return_value='Linux'), \
                    patch.object(smoke.platform, 'machine', return_value='x86_64'), \
                    patch.object(smoke, 'command', side_effect=command), \
                    patch.object(smoke.time, 'monotonic', side_effect=[0, 151]), \
                    patch.object(smoke.sys, 'stderr'):
                try:
                    smoke.smoke('registry.example.com/cindy:test', output)
                except ValueError as exc:
                    error = str(exc)
            proof = json.loads(output.read_text())
        self.assertEqual(calls[-1][:2], ('rm', '-f'))
        return proof, error, calls

    def test_success_requires_runtime_checks_and_clean_shutdown(self):
        proof, error, calls = self.exercise()
        self.assertIsNone(error)
        for key in ['passed', 'desktopReady', 'sandboxedRenderers', 'legacyHome',
                    'networkIsolated', 'readOnlyRoot', 'shutdown']:
            self.assertIs(proof[key], True)
        self.assertEqual(sum(c[0] == 'stop' for c in calls), 1)

    def test_old_application_version_blocks_release(self):
        proof, error, _ = self.exercise(app_version='0.1.108')
        self.assertEqual(error, 'APPLICATION_VERSION_MISMATCH')
        self.assertFalse(proof['passed'])

    def test_early_exit_preserves_failure_and_diagnostics_before_cleanup(self):
        proof, error, calls = self.exercise(starts=False)
        self.assertEqual(error, 'SMOKE_RUNTIME_EXITED')
        self.assertEqual(proof['error'], error)
        self.assertEqual(proof['exitCode'], 1)
        self.assertIs(proof['passed'], False)
        self.assertFalse(any(c[0] == 'stop' for c in calls))
        self.assertTrue(any(c[0] == 'logs' for c in calls[:-1]))

    def test_desktop_timeout_preserves_last_failed_check(self):
        proof, error, _ = self.exercise(check_passes=False)
        self.assertEqual(error, 'SMOKE_DESKTOP_TIMEOUT')
        self.assertEqual(proof['lastCheckError'], 'synthetic failed permission check')
        self.assertIs(proof['passed'], False)

    def test_bad_shutdown_never_produces_passed_evidence(self):
        for code, oom in [(1, False), (0, True)]:
            with self.subTest(exitCode=code, oomKilled=oom):
                proof, error, _ = self.exercise(shutdown_code=code, oom=oom)
                self.assertEqual(error, 'SMOKE_SHUTDOWN_FAILED')
                self.assertIs(proof['passed'], False)
                self.assertNotIn('shutdown', proof)


if __name__ == '__main__':
    unittest.main()
