import importlib.util
import os
from pathlib import Path
import signal
import tempfile
import unittest
from unittest.mock import patch


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / 'runner' / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


entry = module('runner_entry', 'entrypoint.py')
dns = module('runner_dns', 'dns-sidecar.py')


class RunnerTest(unittest.TestCase):
    def test_jit_only_in_listener_environment_and_handlers_restored(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'jit'
            p.write_text('invalid-fixture-jit')
            calls = []
            handlers = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT)}

            class Child:
                pid = 123456
                def poll(self): return None
                def wait(self):
                    signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
                    return 7

            def spawn(args, **kw):
                calls.append((args, {**kw, 'env': dict(kw['env'])}))
                return Child()

            env = {'PATH': '/bin', 'ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT': '1'}
            with patch.object(entry.os, 'killpg') as kill:
                self.assertEqual(entry.run(env, spawn=spawn, config_path=p), 7)
                kill.assert_called_once_with(123456, signal.SIGTERM)
            self.assertEqual(calls[0][0], ['/home/runner/run.sh'])
            self.assertTrue(calls[0][1]['start_new_session'])
            self.assertEqual(calls[0][1]['env']['ACTIONS_RUNNER_INPUT_JITCONFIG'], 'invalid-fixture-jit')
            self.assertNotIn('ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT', calls[0][1]['env'])
            self.assertNotIn('ACTIONS_RUNNER_INPUT_JITCONFIG', env)
            self.assertEqual(handlers, {s: signal.getsignal(s) for s in handlers})

    def test_empty_jit_does_not_start_listener(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'jit'; p.write_text(' ')
            with self.assertRaises(RuntimeError):
                entry.run({}, config_path=p, spawn=lambda *a, **k: self.fail('must not start'))

    def test_dns_scopes_only_github_and_prevents_aaaa_bypass(self):
        cmd = dns.command({'GITHUB_SNI_FORWARD_IP': '192.0.2.10', 'DNS_UPSTREAMS': '192.0.2.53,192.0.2.54'})
        self.assertIn('--address=/github.com/githubusercontent.com/ghcr.io/192.0.2.10', cmd)
        self.assertIn('--local=/github.com/githubusercontent.com/ghcr.io/', cmd)
        self.assertIn('--listen-address=127.0.0.1', cmd)
        self.assertIn('--server=192.0.2.53', cmd)
        self.assertNotIn('--log-queries', cmd)

    def test_dns_rejects_bad_addresses_and_loop(self):
        for target, upstream in [('bad', '192.0.2.53'), ('192.0.2.1', '127.0.0.1'), ('192.0.2.1', '')]:
            with self.subTest(target=target, upstream=upstream), self.assertRaises(ValueError):
                dns.command({'GITHUB_SNI_FORWARD_IP': target, 'DNS_UPSTREAMS': upstream})

    def test_build_pod_dns_supports_explicit_registry_domains(self):
        env = {'GITHUB_SNI_FORWARD_IP': '192.0.2.10', 'DNS_UPSTREAMS': '192.0.2.53',
               'POD_IP': '192.0.2.20', 'SNI_FORWARD_DOMAINS': 'github.com,docker.io'}
        args = dns.command(env)
        self.assertIn('--listen-address=127.0.0.1,192.0.2.20', args)
        self.assertIn('--address=/github.com/docker.io/192.0.2.10', args)
        self.assertIn('--local=/github.com/docker.io/', args)
        self.assertIn('--log-facility=-', args)
        for changes in [{'POD_IP': '0.0.0.0'}, {'POD_IP': '127.0.0.1'},
                        {'SNI_FORWARD_DOMAINS': '*'}, {'SNI_FORWARD_DOMAINS': 'github.com/evil'},
                        {'SNI_FORWARD_DOMAINS': 'github.com, --foo'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                dns.command({**env, **changes})


if __name__ == '__main__':
    unittest.main()
