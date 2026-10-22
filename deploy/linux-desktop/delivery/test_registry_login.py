import contextlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import unittest
from unittest.mock import patch

from registry_login import LoginError, login, main


class RegistryLoginTest(unittest.TestCase):
    def test_vpc_alias_uses_one_token_exchange_and_rejects_another_repository(self):
        # Credential boundary: only the same ACR repository's VPC alias may
        # receive the temporary token, never an arbitrary alternate hostname.
        private = 'fixture-vpc.cn-shanghai.cr.aliyuncs.com/public/candidate'
        calls = []
        def execute(cmd, **kwargs):
            calls.append((cmd, kwargs))
            return subprocess.CompletedProcess(cmd, 0, json.dumps(self.token), '')
        login({**self.env, 'IMAGE_PUSH_REPOSITORY': private}, execute=execute, now=lambda: 1000)
        self.assertEqual(len(calls), 3)
        self.assertEqual([c[0][2] for c in calls[1:]],
                         ['fixture.cn-shanghai.cr.aliyuncs.com', 'fixture-vpc.cn-shanghai.cr.aliyuncs.com'])
        self.assertEqual([c[1]['input'] for c in calls[1:]], [self.token['AuthorizationToken']]*2)
        calls.clear()
        with self.assertRaisesRegex(LoginError, 'PUSH_REPOSITORY'):
            login({**self.env, 'IMAGE_PUSH_REPOSITORY': 'other.example/public/candidate'}, execute=execute)
        self.assertEqual(calls, [])

    def setUp(self):
        self.env = {'IMAGE_REPOSITORY': 'fixture.cn-shanghai.cr.aliyuncs.com/public/candidate',
                    'DOCKER_CONFIG': '/tmp/invalid-test-fixture', 'PATH': '/fixture/bin',
                    'REGISTRY_AUTH': 'acr-ak', 'ACR_INSTANCE_ID': 'cri-fixture',
                    'ALIBABA_CLOUD_ACCESS_KEY_ID': 'invalid-ak-id',
                    'ALIBABA_CLOUD_ACCESS_KEY_SECRET': 'invalid-ak-secret',
                    'ALIBABA_CLOUD_SECURITY_TOKEN': 'invalid-unrelated-sts',
                    'ALIBABA_CLOUD_ROLE_ARN': 'invalid-unrelated-role',
                    'REGISTRY_PASSWORD': 'invalid-unused-password'}
        self.token = {'IsSuccess': True, 'Code': 'success', 'ExpireTime': 2000000,
                      'TempUsername': 'temporary-fixture', 'AuthorizationToken': 'invalid-temporary-password'}

    def test_ak_is_only_in_temporary_profile_and_token_only_in_docker_stdin(self):
        calls = []
        profiles = []
        def execute(command, **kwargs):
            calls.append((command, kwargs))
            if command[0] == 'aliyun':
                profile = Path(command[command.index('--config-path') + 1])
                profiles.append(profile)
                data = json.loads(profile.read_text())['profiles'][0]
                self.assertEqual(data['access_key_secret'], 'invalid-ak-secret')
                self.assertEqual(data['mode'], 'AK')
                self.assertEqual(profile.stat().st_mode & 0o777, 0o600)
                self.assertEqual(profile.parent.stat().st_mode & 0o777, 0o700)
                return subprocess.CompletedProcess(command, 0, json.dumps(self.token), '')
            return subprocess.CompletedProcess(command, 0, 'Login Succeeded', '')
        login(self.env, execute=execute, now=lambda: 1000)
        self.assertEqual(len(calls), 2)
        cli, docker = calls
        self.assertFalse(profiles[0].parent.exists())
        self.assertIsNone(cli[1]['input'])
        self.assertEqual(docker[1]['input'], self.token['AuthorizationToken'])
        self.assertEqual(docker[0][-1], '--password-stdin')
        for cmd, kwargs in calls:
            self.assertFalse(any(k.startswith('ALIBABA_CLOUD_') for k in kwargs['env']))
            self.assertNotIn('REGISTRY_PASSWORD', kwargs['env'])
            self.assertNotIn('invalid-ak-secret', ' '.join(cmd))
            self.assertNotIn('invalid-temporary-password', ' '.join(cmd))

    def test_bad_or_expiring_api_response_never_calls_docker(self):
        for data in [[], 'not-json', {}, {**self.token, 'ExpireTime': 1050000},
                     {**self.token, 'IsSuccess': False}, {**self.token, 'Code': 'NoPrivilege'},
                     {**self.token, 'AuthorizationToken': ''}]:
            calls = []
            def execute(cmd, **kwargs):
                calls.append(cmd)
                return subprocess.CompletedProcess(cmd, 0, json.dumps(data), '')
            with self.subTest(data=data), self.assertRaises(LoginError):
                login(self.env, execute=execute, now=lambda: 1000)
            self.assertEqual(len(calls), 1)
            self.assertFalse(Path(calls[0][calls[0].index('--config-path') + 1]).parent.exists())

    def test_invalid_configuration_never_starts_commands(self):
        for changes in [{'REGISTRY_AUTH': 'unknown'}, {'IMAGE_REPOSITORY': 'https://untrusted.example/repo'},
                        {'IMAGE_REPOSITORY': 'untrusted.example/repo'}, {'ACR_INSTANCE_ID': '../fixture'},
                        {'DOCKER_CONFIG': ''}, {'DOCKER_CONFIG': 'inside-checkout'},
                        {'ALIBABA_CLOUD_ACCESS_KEY_SECRET': ''}]:
            with self.subTest(changes=changes), self.assertRaises(LoginError):
                login({**self.env, **changes}, execute=lambda *a, **k: self.fail('unexpected command'))

    def test_password_mode_does_not_request_cloud_credentials(self):
        calls = []
        def execute(cmd, **kwargs):
            calls.append((cmd, kwargs))
            return subprocess.CompletedProcess(cmd, 0, '', '')
        login({**self.env, 'REGISTRY_AUTH': 'password', 'REGISTRY_USER': 'fixture'}, execute=execute)
        self.assertEqual([c[0][0] for c in calls], ['docker'])
        self.assertEqual(calls[0][1]['input'], 'invalid-unused-password')

    def test_failed_cli_output_and_exception_never_escape_to_logs(self):
        marker = 'invalid-secret-must-not-appear'
        failures = [subprocess.CompletedProcess([], 1, marker, marker),
                    subprocess.TimeoutExpired(['aliyun'], 1, output=marker, stderr=marker),
                    FileNotFoundError(marker)]
        for failure in failures:
            profiles = []
            def execute(command, **kw):
                profiles.append(Path(command[command.index('--config-path') + 1]))
                if isinstance(failure, Exception): raise failure
                return failure
            err, out = io.StringIO(), io.StringIO()
            def failed_login(env): return login(env, execute=execute)
            with self.subTest(failure=type(failure).__name__), patch.dict(os.environ, self.env, clear=True), patch('registry_login.login', side_effect=failed_login), contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
                self.assertEqual(main(), 1)
            self.assertEqual(out.getvalue(), '')
            self.assertEqual(err.getvalue(), 'REGISTRY_LOGIN_COMMAND_FAILED\n')
            self.assertNotIn(marker, err.getvalue())
            self.assertFalse(profiles[0].parent.exists())


class WorkflowRunnerBoundaryTest(unittest.TestCase):
    def test_docs_cannot_provision_runners_but_packaged_guidance_remains_eligible(self):
        # Guard: README-only pushes used to enter the private runner pool.
        # Keep runtime Markdown eligible; this protects the workflow scheduling
        # boundary, not a source-format preference. Real doc-push proof is separate.
        root = Path(__file__).resolve().parents[3]
        workflow = (root / '.github/workflows/cloud-image-delivery.yml').read_text()
        triggers = workflow.split('  workflow_dispatch:')[0]
        for pattern in ['!deploy/linux-desktop/*.md',
                        '!deploy/linux-desktop/**/README.md',
                        '!deploy/linux-desktop/delivery/**/*.md']:
            self.assertIn("- '" + pattern + "'", triggers)
        self.assertIn("- 'deploy/linux-desktop/**'", triggers)
        self.assertNotIn('!deploy/linux-desktop/**/*.md', triggers)
        self.assertNotIn('!deploy/linux-desktop/runtime-guidance/', triggers)

    def test_build_cache_login_is_step_scoped_and_smoke_still_precedes_publication(self):
        root = Path(__file__).resolve().parents[3]
        workflow = (root / '.github/workflows/cloud-image-delivery.yml').read_text()
        candidate = workflow.split('  candidate:',1)[1].split('  cache:',1)[0]
        self.assertIn('--cache-repository "$BUILD_CACHE_REPOSITORY"', candidate)
        self.assertIn('test "$BUILD_CACHE_REPOSITORY" != "$IMAGE_REPOSITORY"', candidate)
        before_build = candidate.index('      - name: Login for the isolated build cache')
        build = candidate.index('      - name: Freeze plan')
        smoke = candidate.index('      - name: Native isolated')
        publish_login = candidate.index('      - name: Login to the unified runtime')
        publish = candidate.index('      - name: Publish tested bytes')
        self.assertLess(before_build, build)
        self.assertLess(build, smoke)
        self.assertLess(smoke, publish_login)
        self.assertLess(publish_login, publish)
        self.assertNotIn('ACCESS_KEY', candidate[build:smoke])
        self.assertNotIn('ACCESS_KEY', candidate.split('    steps:',1)[0])

    def test_only_fork_private_runner_pools_and_no_external_pr_trigger(self):
        root = Path(__file__).resolve().parents[3]
        workflow = (root / '.github/workflows/cloud-image-delivery.yml').read_text()
        self.assertEqual(set(re.findall(r'^    runs-on: (.+)$', workflow, re.M)), {
            "[self-hosted, Linux, X64, cindy-fork-cloud-check, 'cindy-fork-run-${{ github.run_id }}-${{ github.run_attempt }}']",
            "[self-hosted, Linux, X64, cindy-fork-cloud-build, 'cindy-fork-run-${{ github.run_id }}-${{ github.run_attempt }}']",
            "[self-hosted, Linux, X64, cindy-fork-cloud-cache, 'cindy-fork-run-${{ github.run_id }}-${{ github.run_attempt }}']"})
        triggers = workflow.split('\npermissions:')[0]
        self.assertNotIn('pull_request', triggers)
        verify = workflow.split('  verify:')[1].split('    steps:')[0]
        self.assertIn("github.repository == 'zhuoshaojian/cindy'", verify)
        self.assertIn("github.ref == 'refs/heads/feat/cloud-settings-native-client'", verify)
        self.assertIn("github.event_name == 'push'", verify)

    def test_cache_keys_stay_in_cache_step_without_oidc_or_registry_keys(self):
        root = Path(__file__).resolve().parents[3]
        workflow = (root / '.github/workflows/cloud-image-delivery.yml').read_text()
        before, cache = workflow.split('  cache:', 1)
        self.assertNotIn('id-token:', workflow)
        self.assertNotIn('configure-aliyun-credentials-action', workflow)
        self.assertNotIn('CLOUD_IMAGE_CACHE_ACCESS_KEY_', before)
        self.assertNotIn('CLOUD_IMAGE_ACR_ACCESS_KEY_', cache)
        prepare = cache.split('      - name: Prepare main', 1)[1].split('      - name:', 1)[0]
        self.assertIn('secrets.CLOUD_IMAGE_CACHE_ACCESS_KEY_ID', prepare)
        self.assertIn('secrets.CLOUD_IMAGE_CACHE_ACCESS_KEY_SECRET', prepare)
        self.assertNotIn('ALIBABA_CLOUD_SECURITY_TOKEN', cache)


if __name__ == '__main__':
    unittest.main()
