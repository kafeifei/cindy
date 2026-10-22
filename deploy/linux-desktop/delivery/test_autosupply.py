"""Unit: Controller.tick is the actual queue/lifecycle entry.

Rule: fork-only ephemeral runners, no shared credentials or duplicate execution.
Existing runner tests cover process/DNS, not provisioning. Minimal failures are a
second tick/restart after JIT registration, or a cancelled queued job. In-memory
API boundary covers those observable resources without network or real secrets.
Render assertions guard the credential/capability boundary across controller/jobs.
"""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).parent / 'runner'
sys.path.insert(0, str(ROOT))
import controller as c
import provision as p
import render as r
sys.path.pop(0)

CONFIG = json.loads((ROOT / 'controller.example.json').read_text())
CONFIG['bootstrapConfigMap'] = 'fixture-bootstrap'
RUN = {'id': 12, 'run_attempt': 1, 'head_sha': 'a' * 40, 'status': 'in_progress', 'event': 'push',
       'head_branch': p.BRANCH, 'path': p.WORKFLOW, 'repository': {'full_name': p.REPOSITORY},
       'head_repository': {'full_name': p.REPOSITORY}}
JOB = {'id': 31, 'run_id': 12, 'name': 'verify', 'head_sha': 'a' * 40, 'status': 'queued',
       'labels': ['self-hosted', 'Linux', 'X64', 'cindy-fork-cloud-check', p.run_label(RUN)]}


class FakeApi:
    def __init__(self):
        self.run = copy.deepcopy(RUN); self.job = copy.deepcopy(JOB)
        self.objects = {}; self.runners = {}; self.next_id = 100
        self.calls = []; self.fail_job_create = False

    def kube(self, path, method='GET', body=None):
        self.calls.append((path, method))
        if '?' in path:
            return {'items': [copy.deepcopy(o) for (k, n), o in self.objects.items()
                              if k == 'configmaps' and 'state.json' in o.get('data', {})]}
        resource, _, name = path.partition('/')
        if method == 'POST':
            if resource == 'jobs' and self.fail_job_create:
                self.fail_job_create = False
                raise c.ApiError('KUBERNETES', 503)
            obj = copy.deepcopy(body); name = obj['metadata']['name']
            if (resource, name) in self.objects: raise c.ApiError('KUBERNETES', 409)
            obj['metadata']['uid'] = 'uid-' + name
            obj['metadata']['resourceVersion'] = '1'
            if resource == 'secrets':
                obj['data'] = obj.pop('stringData')
            self.objects[(resource, name)] = obj
            return copy.deepcopy(obj)
        key = (resource, name)
        if key not in self.objects: raise c.ApiError('KUBERNETES', 404)
        if method == 'GET': return copy.deepcopy(self.objects[key])
        if method == 'PUT':
            self.objects[key] = copy.deepcopy(body); return copy.deepcopy(body)
        if method == 'DELETE':
            if body['preconditions']['uid'] != self.objects[key]['metadata']['uid']:
                raise c.ApiError('KUBERNETES', 409)
            del self.objects[key]; return None
        raise AssertionError(method)

    def gh(self, path, method='GET', body=None):
        self.calls.append((path, method))
        if path.startswith('actions/workflows/'):
            return {'workflow_runs': [copy.deepcopy(self.run)], 'total_count': 1}
        if path.startswith('actions/runs/'):
            return {'jobs': [copy.deepcopy(self.job)], 'total_count': 1}
        if path == 'actions/jobs/31': return copy.deepcopy(self.job)
        if path.startswith('actions/runners?'):
            return {'runners': list(copy.deepcopy(self.runners).values()), 'total_count': len(self.runners)}
        if path == 'actions/runners/generate-jitconfig' and method == 'POST':
            self.next_id += 1
            runner = {'id': self.next_id, 'name': body['name'], 'busy': False}
            self.runners[runner['id']] = runner
            return {'runner': copy.deepcopy(runner), 'encoded_jit_config': 'INVALID-TEST-JIT'}
        if path.startswith('actions/runners/') and method == 'DELETE':
            del self.runners[int(path.split('/')[-1])]; return None
        raise AssertionError((path, method))


class AutosupplyTest(unittest.TestCase):
    def setUp(self):
        self.api = FakeApi(); self.now = 2000
        self.logs = []
        self.controller = c.Controller(self.api, CONFIG, now=lambda: self.now,
                                       log=lambda event, **kw: self.logs.append((event, kw)))

    def state(self):
        return json.loads(self.api.objects[('configmaps', 'cfr-state-31')]['data']['state.json'])

    def test_push_admission_and_repeated_cycles_make_only_one_isolated_runner(self):
        self.controller.tick(); self.controller.tick()
        self.assertEqual(len(self.api.runners), 1)
        self.assertEqual(self.state()['phase'], 'registered')
        job = self.api.objects[('jobs', self.state()['runnerName'])]
        self.assertFalse(job['spec']['template']['spec']['automountServiceAccountToken'])
        self.assertEqual(self.state()['labels'], JOB['labels'])
        self.assertNotIn('INVALID-TEST-JIT', json.dumps(self.logs))
        self.assertNotIn('INVALID-TEST-JIT', json.dumps(self.state()))

    def test_foreign_repo_branch_pr_workflow_or_run_label_cannot_admit(self):
        mutations = [('head_branch', 'main'), ('event', 'pull_request'), ('path', '.github/workflows/ci.yml'),
                     ('head_repository', {'full_name': 'makecindy/cindy'}),
                     ('repository', {'full_name': 'makecindy/cindy'})]
        for field, value in mutations:
            with self.subTest(field=field):
                self.api.run = {**copy.deepcopy(RUN), field: value}
                self.controller.tick(); self.assertFalse(self.api.runners)
        self.api.run = copy.deepcopy(RUN)
        self.api.job['labels'][-1] = 'cindy-fork-run-11-1'
        self.controller.tick(); self.assertFalse(self.api.runners)

    def test_restart_between_secret_and_job_resumes_same_jit_identity(self):
        self.api.fail_job_create = True
        with self.assertRaises(c.ApiError): self.controller.tick()
        identity = self.state()['runnerId']
        c.Controller(self.api, CONFIG, now=lambda: self.now, log=lambda *a, **k: None).tick()
        self.assertEqual(self.state()['runnerId'], identity)
        self.assertEqual(len(self.api.runners), 1)
        self.assertEqual(self.state()['phase'], 'registered')

    def test_lost_jit_is_retired_before_replacement_and_retry_is_bounded(self):
        for attempt in range(3):
            self.api.fail_job_create = True
            try: self.controller.tick()
            except c.ApiError: pass
            state = self.state()
            self.assertEqual(state['tries'], attempt + 1)
            del self.api.objects[('secrets', state['runnerName'] + '-jit')]
            self.controller.tick()
            self.assertFalse(self.api.runners)
        self.controller.tick()
        self.assertEqual(self.state()['phase'], 'finished')
        self.assertEqual(self.state()['conclusion'], 'bootstrap_exhausted')

    def test_running_job_removes_jit_and_completion_reclaims_without_touching_others(self):
        self.controller.tick(); state = self.state(); name = state['runnerName']
        self.api.objects[('jobs', 'unrelated')] = {'metadata': {'name': 'unrelated', 'uid': 'other'}}
        self.api.job.update(status='in_progress', runner_name=name)
        self.controller.tick()
        self.assertNotIn(('secrets', name + '-jit'), self.api.objects)
        self.assertIn(('jobs', name), self.api.objects)
        self.api.job.update(status='completed', conclusion='success', completed_at=c.iso(self.now))
        self.api.objects[('jobs', name)]['status'] = {'succeeded': 1}
        self.controller.tick()
        self.assertFalse(self.api.runners)
        self.assertNotIn(('jobs', name), self.api.objects)
        self.assertIn(('jobs', 'unrelated'), self.api.objects)
        self.assertEqual(self.state()['conclusion'], 'success')
        self.assertEqual(self.state()['kubernetesResult']['succeeded'], 1)
        self.controller.tick(); self.assertFalse(self.api.runners)

    def test_cancellation_waits_for_exit_then_forces_bounded_cleanup(self):
        self.controller.tick(); name = self.state()['runnerName']
        self.api.job.update(status='completed', conclusion='cancelled', completed_at=c.iso(self.now))
        self.controller.tick(); self.assertIn(('jobs', name), self.api.objects)
        self.now += 121
        self.controller.tick(); self.assertNotIn(('jobs', name), self.api.objects)
        self.assertEqual(self.state()['conclusion'], 'cancelled')

    def test_cleanup_refuses_resource_without_ownership_label(self):
        self.controller.tick(); name = self.state()['runnerName']
        self.api.objects[('jobs', name)]['metadata']['labels'] = {}
        self.api.job.update(status='completed', conclusion='success', completed_at=c.iso(0))
        self.controller.tick()
        self.assertIn(('jobs', name), self.api.objects)
        self.assertTrue(any('RESOURCE_OWNER_MISMATCH' in str(x) for x in self.logs))

    def test_lease_excludes_second_controller_until_expiration(self):
        first = c.Lease(self.api, 'first', now=lambda: self.now)
        second = c.Lease(self.api, 'second', now=lambda: self.now)
        first.renew()
        with self.assertRaisesRegex(RuntimeError, 'CONTROLLER_LEASE_HELD'): second.renew()
        self.now += 181; second.renew()
        with self.assertRaisesRegex(RuntimeError, 'CONTROLLER_LEASE_HELD'): first.renew()

    def test_only_build_has_dind_and_controller_credentials_never_enter_jobs(self):
        for role in ['check', 'build', 'cache']:
            with self.subTest(role=role):
                doc = p.job_manifest(CONFIG, {'role': role, 'runnerName': 'fixture', 'jobId': 31})
                pod = doc['spec']['template']['spec']
                annotations = doc['spec']['template']['metadata']['annotations']
                self.assertEqual(annotations['k8s.aliyun.com/eci-auto-imc'], 'true')
                self.assertEqual(annotations['k8s.aliyun.com/imc-perfect-match'], 'true')
                self.assertTrue(all('@sha256:' in v['image'] for v in pod['containers']))
                privileged = [v['name'] for v in pod['containers'] if v['securityContext'].get('privileged')]
                self.assertEqual(privileged, ['dind'] if role == 'build' else [])
                self.assertFalse(pod['automountServiceAccountToken'])
                self.assertTrue(all(set(v) <= {'name', 'emptyDir', 'secret', 'configMap'} for v in pod['volumes']))
                self.assertEqual([v['secret']['secretName'] for v in pod['volumes'] if 'secret' in v], ['fixture-jit'])
        manifest = r.render(CONFIG)
        deployment = next(x for x in manifest['items'] if x['kind'] == 'Deployment')
        pod = deployment['spec']['template']['spec']
        self.assertEqual(deployment['spec']['strategy']['type'], 'Recreate')
        self.assertFalse(pod['automountServiceAccountToken'])
        self.assertFalse(any(m['name'] in ('credentials', 'kube-api') for m in pod['containers'][1]['volumeMounts']))
        self.assertFalse(any(x['kind'].startswith('Cluster') for x in manifest['items']))


if __name__ == '__main__':
    unittest.main()
