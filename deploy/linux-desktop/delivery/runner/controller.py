#!/usr/bin/env python3
"""Repository-scoped queued-job reconciliation; never dispatches or cancels workflows."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from provision import (REPOSITORY, BRANCH, WORKFLOW, MANAGER, LABEL, ROLES, DEADLINES,
                       eligible, metadata, validate, job_manifest)

SELECTOR = urllib.parse.quote(LABEL + '=' + MANAGER + ',cindy-resource=state', safe='')


class ApiError(RuntimeError):
    def __init__(self, service, status):
        self.status = status
        super().__init__(f'{service}_HTTP_{status}')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Api:
    def __init__(self, config):
        self.config = config
        self.guard = lambda: None
        self.github_token = Path('/credentials/token')
        self.sa = Path('/var/run/cindy-kubernetes')
        self.kube_base = 'https://' + os.environ['KUBERNETES_SERVICE_HOST'] + ':' + os.environ.get('KUBERNETES_SERVICE_PORT', '443')
        self.https = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.khttps = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
            urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(self.sa / 'ca.crt'))))

    def request(self, service, path, method='GET', body=None):
        if method != 'GET' and path.split('/')[0] != 'leases':
            self.guard()
        if service == 'GITHUB':
            if not path.startswith('actions/'):
                raise ValueError('GITHUB_PATH_OUT_OF_SCOPE')
            url = 'https://api.github.com/repos/' + REPOSITORY + '/' + path
            token = self.github_token.read_text().strip()
            opener = self.https
        else:
            resource = path.split('/')[0].split('?')[0]
            if resource not in ('jobs', 'secrets', 'configmaps', 'leases'):
                raise ValueError('KUBERNETES_RESOURCE_OUT_OF_SCOPE')
            prefix = {'jobs': '/apis/batch/v1', 'leases': '/apis/coordination.k8s.io/v1'}.get(resource, '/api/v1')
            url = self.kube_base + prefix + '/namespaces/' + self.config['namespace'] + '/' + path
            token = (self.sa / 'token').read_text().strip()
            opener = self.khttps
        headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' if service == 'GITHUB' else 'application/json',
                   'Content-Type': 'application/json', 'User-Agent': MANAGER, 'X-GitHub-Api-Version': '2022-11-28'}
        request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                         headers=headers, method=method)
        try:
            with opener.open(request, timeout=15) as response:
                data = response.read(8 * 1024 * 1024)
                return json.loads(data) if data else None
        except urllib.error.HTTPError as exc:
            # Never log a response body, request header, JIT config or bearer token.
            raise ApiError(service, exc.code) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise RuntimeError(service + '_TRANSPORT_FAILED') from None

    def gh(self, path, method='GET', body=None):
        return self.request('GITHUB', path, method, body)

    def kube(self, path, method='GET', body=None):
        return self.request('KUBERNETES', path, method, body)


def optional(call, path):
    try:
        return call(path)
    except ApiError as exc:
        if exc.status == 404:
            return None
        raise


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def iso(now):
    return dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def emit(event, **fields):
    print(json.dumps({'time': iso(time.time()), 'event': event, **fields}), flush=True)


class Lease:
    def __init__(self, api, identity, now=time.time):
        self.api, self.identity, self.now = api, identity, now

    def renew(self):
        now = self.now()
        old = optional(self.api.kube, 'leases/cindy-fork-autosupply')
        if old:
            spec = old['spec']
            if spec.get('holderIdentity') != self.identity and timestamp(spec['renewTime']) + 180 > now:
                raise RuntimeError('CONTROLLER_LEASE_HELD')
            old['spec'].update(holderIdentity=self.identity, renewTime=iso(now), leaseDurationSeconds=180)
            self.api.kube('leases/cindy-fork-autosupply', 'PUT', old)
        else:
            self.api.kube('leases', 'POST', {'apiVersion': 'coordination.k8s.io/v1', 'kind': 'Lease',
                'metadata': {'name': 'cindy-fork-autosupply'},
                'spec': {'holderIdentity': self.identity, 'renewTime': iso(now), 'leaseDurationSeconds': 180}})


class Controller:
    def __init__(self, api, config, now=time.time, log=emit):
        self.api, self.config, self.now, self.log = api, validate(config), now, log

    def states(self):
        return self.api.kube('configmaps?labelSelector=' + SELECTOR)['items']

    def save(self, cm, state):
        cm['data'] = {'state.json': json.dumps(state)}
        result = self.api.kube('configmaps/' + cm['metadata']['name'], 'PUT', cm)
        cm.clear(); cm.update(result)

    def remove(self, resource, name):
        obj = optional(self.api.kube, resource + '/' + name)
        if obj is None:
            return
        if obj['metadata'].get('labels', {}).get(LABEL) != MANAGER:
            raise RuntimeError('RESOURCE_OWNER_MISMATCH')
        self.api.kube(resource + '/' + name, 'DELETE', {'apiVersion': 'v1', 'kind': 'DeleteOptions',
            'preconditions': {'uid': obj['metadata']['uid']}, 'propagationPolicy': 'Foreground'})

    def runner(self, name):
        for page in range(1, 11):
            data = self.api.gh(f'actions/runners?per_page=100&page={page}')
            for value in data['runners']:
                if value['name'] == name:
                    return value
            if len(data['runners']) < 100:
                return None
        raise RuntimeError('RUNNER_PAGINATION_LIMIT')

    def delete_runner(self, state):
        runner = self.runner(state['runnerName'])
        if runner:
            if runner.get('busy'):
                return False
            if state.get('runnerId') and runner['id'] != state['runnerId']:
                raise RuntimeError('RUNNER_ID_MISMATCH')
            self.api.gh(f"actions/runners/{runner['id']}", 'DELETE')
        return True

    def cleanup(self, cm, state, conclusion):
        name = state.get('runnerName')
        if name:
            self.remove('jobs', name)
            # Foreground deletion must finish before registration deletion/retry.
            if optional(self.api.kube, 'jobs/' + name):
                return False
            self.remove('secrets', name + '-jit')
            if not self.delete_runner(state):
                return False
        state.update(phase='finished', finishedAt=self.now(), conclusion=conclusion)
        self.save(cm, state)
        self.log('runner_reclaimed', jobId=state['jobId'], runId=state['runId'], conclusion=conclusion)
        return True

    def reconcile(self, cm):
        state = json.loads(cm['data']['state.json'])
        if state['phase'] == 'finished':
            if self.now() - state['finishedAt'] > 7 * 86400:
                self.remove('configmaps', cm['metadata']['name'])
            return
        job = optional(self.api.gh, f"actions/jobs/{state['jobId']}")
        if job and (job['run_id'] != state['runId'] or job.get('head_sha') != state['sha']):
            raise RuntimeError('JOB_IDENTITY_MISMATCH')
        name = state.get('runnerName')
        resource = optional(self.api.kube, 'jobs/' + name) if name else None
        if resource and resource['metadata'].get('labels', {}).get(LABEL) != MANAGER:
            raise RuntimeError('RESOURCE_OWNER_MISMATCH')
        if not job or job['status'] == 'completed':
            # Allow the listener/DinD exit handshake, then bounded forced cleanup.
            if resource and not (resource.get('status', {}).get('succeeded') or resource.get('status', {}).get('failed')):
                if job and self.now() - timestamp(job['completed_at']) < 120:
                    return
            if resource:
                state['kubernetesResult'] = {k: resource.get('status', {}).get(k) for k in ('succeeded', 'failed', 'completionTime')}
            self.cleanup(cm, state, job.get('conclusion') if job else 'job_removed')
            return
        # The Actions read API can regress an assigned/finished job to queued.
        # Only an unconsumed registration may bootstrap-retry the same job ID.
        # After execution, wait for its terminal GitHub result; a user rerun gets
        # a new job ID and will be admitted independently.
        if state['phase'] == 'running' and job['status'] != 'in_progress':
            return
        if resource and resource.get('status', {}).get('succeeded') and job['status'] != 'in_progress':
            if state['phase'] != 'running':
                state['phase'] = 'running'; self.save(cm, state)
            return
        if resource:
            if job['status'] == 'in_progress':
                if job.get('runner_name') != name:
                    raise RuntimeError('JOB_RUNNER_MISMATCH')
                # Listener consumed JIT, remove the backing Secret immediately.
                self.remove('secrets', name + '-jit')
                if state['phase'] != 'running':
                    state['phase'] = 'running'; self.save(cm, state)
                    self.log('runner_assigned', jobId=state['jobId'], runnerId=state['runnerId'])
            failed = resource.get('status', {}).get('failed')
            stale = job['status'] == 'queued' and self.now() - state['attemptAt'] > 900
            if failed or stale:
                if self.cleanup(cm, state, 'bootstrap_failed') and job['status'] == 'queued' and state['tries'] < 3:
                    state.update(phase='pending', runnerName=None, runnerId=None)
                    self.save(cm, state)
            return
        if job['status'] != 'queued':
            # Never start a replacement for a job already executing elsewhere.
            return
        if state['phase'] in ('registered', 'running'):
            if self.cleanup(cm, state, 'runner_job_missing') and state['tries'] < 3:
                state.update(phase='pending', runnerName=None, runnerId=None); self.save(cm, state)
            return
        if state['phase'] == 'pending':
            if state.get('tries', 0) >= 3:
                self.cleanup(cm, state, 'bootstrap_exhausted'); return
            state['tries'] = state.get('tries', 0) + 1
            state.update(phase='preparing', attemptAt=self.now(),
                runnerName=f"cfr-{state['jobId']}-a{state['runAttempt']}-t{state['tries']}")
            self.save(cm, state)
        name = state['runnerName']
        secret = optional(self.api.kube, 'secrets/' + name + '-jit')
        runner = self.runner(name)
        if runner and not secret:
            # Registration response was lost or controller died before persisting
            # JIT. It cannot be retrieved; retire that unused identity first.
            if not self.delete_runner(state):
                return
            state.update(phase='pending', runnerName=None, runnerId=None); self.save(cm, state)
            return
        if secret and not runner:
            self.remove('secrets', name + '-jit')
            state.update(phase='pending', runnerName=None, runnerId=None); self.save(cm, state)
            return
        if not secret:
            response = self.api.gh('actions/runners/generate-jitconfig', 'POST', {
                'name': name, 'runner_group_id': 1, 'labels': state['labels'], 'work_folder': '_work'})
            runner = response['runner']
            if runner['name'] != name:
                raise RuntimeError('JIT_RUNNER_NAME_MISMATCH')
            self.api.kube('secrets', 'POST', {'apiVersion': 'v1', 'kind': 'Secret',
                'metadata': {**metadata(name + '-jit', self.config),
                             'annotations': {'cindy-runner-id': str(runner['id'])}},
                'stringData': {'config': response['encoded_jit_config']}})
            del response
        else:
            if (secret['metadata'].get('labels', {}).get(LABEL) != MANAGER
                    or secret['metadata'].get('annotations', {}).get('cindy-runner-id') != str(runner['id'])):
                raise RuntimeError('JIT_OWNER_MISMATCH')
        state['runnerId'] = runner['id']
        self.save(cm, state)
        self.api.kube('jobs', 'POST', job_manifest(self.config, state))
        state['phase'] = 'registered'; self.save(cm, state)
        self.log('runner_created', runId=state['runId'], jobId=state['jobId'], role=state['role'], runnerId=state['runnerId'])

    def tick(self):
        states = self.states()
        for cm in states:
            try:
                self.reconcile(cm)
            except (ApiError, RuntimeError) as exc:
                self.log('reconcile_failed', state=cm['metadata']['name'], code=str(exc))
        states = self.states()
        active = [s for s in states if json.loads(s['data']['state.json'])['phase'] != 'finished']
        if len(active) >= 3:
            return
        names = {s['metadata']['name'] for s in states}
        runs = {}
        for status in ('queued', 'in_progress', 'waiting'):
            path = f'actions/workflows/cloud-image-delivery.yml/runs?branch={urllib.parse.quote(BRANCH, safe="")}&status={status}&per_page=100'
            data = self.api.gh(path)
            if data['total_count'] > 100:
                raise RuntimeError('WORKFLOW_QUEUE_LIMIT')
            runs.update({r['id']: r for r in data['workflow_runs']})
        for run in sorted(runs.values(), key=lambda r: r['id']):
            data = self.api.gh(f"actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs?per_page=100")
            if data['total_count'] > 100:
                raise RuntimeError('WORKFLOW_JOBS_LIMIT')
            for job in data['jobs']:
                if not eligible(run, job):
                    continue
                name = f"cfr-state-{job['id']}"
                if name in names or len(active) >= 3:
                    continue
                state = {'schemaVersion': 1, 'phase': 'pending', 'tries': 0, 'createdAt': self.now(),
                         'jobId': job['id'], 'runId': run['id'], 'runAttempt': run['run_attempt'],
                         'sha': run['head_sha'], 'role': ROLES[job['name']], 'labels': job['labels']}
                cm = self.api.kube('configmaps', 'POST', {'apiVersion': 'v1', 'kind': 'ConfigMap',
                    'metadata': metadata(name, self.config, {'cindy-resource': 'state'}), 'data': {'state.json': json.dumps(state)}})
                names.add(name); active.append(cm)
                self.log('job_admitted', runId=run['id'], jobId=job['id'], role=state['role'], sha=state['sha'])
                self.reconcile(cm)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    config = validate(json.loads(args.config.read_text()))
    api = Api(config)
    lease = Lease(api, os.environ.get('HOSTNAME', 'controller') + '-' + uuid.uuid4().hex[:8])
    api.guard = lease.renew
    controller = Controller(api, config)
    while True:
        try:
            lease.renew()
            controller.tick()
            Path('/tmp/controller-ready').write_text(str(time.time()))
        except Exception as exc:
            # Print only known fixed error codes; unexpected values may contain
            # credentials or API response data and must not be serialized.
            code = str(exc) if isinstance(exc, (ApiError, RuntimeError)) else type(exc).__name__
            emit('controller_cycle_failed', code=code)
        time.sleep(30)


if __name__ == '__main__':
    main()
