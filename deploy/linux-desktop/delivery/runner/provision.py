"""Build the qualified ECI job; real images/network settings are operator config."""
import copy
import ipaddress
import re

REPOSITORY = 'zhuoshaojian/cindy'
BRANCH = 'feat/cloud-settings-native-client'
WORKFLOW = '.github/workflows/cloud-image-delivery.yml'
MANAGER = 'cindy-fork-autosupply'
LABEL = 'app.kubernetes.io/managed-by'
ROLES = {'verify': 'check', 'candidate': 'build', 'cache': 'cache'}
DEADLINES = {'check': 2400, 'build': 9300, 'cache': 3300}


def validate(config):
    if config.get('repository') != REPOSITORY or config.get('branch') != BRANCH:
        raise ValueError('FORK_SCOPE_REQUIRED')
    if config.get('namespace') != 'cindy-fork-runners':
        raise ValueError('DEDICATED_NAMESPACE_REQUIRED')
    for name in ['runnerImage', 'dindImage']:
        if not re.fullmatch(r'[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}', config.get(name, '')):
            raise ValueError('PINNED_IMAGE_REQUIRED')
    ipaddress.IPv4Address(config['sniForwardIp'])
    for ip in config['dnsUpstreams'].split(','):
        ipaddress.IPv4Address(ip)
    return config


def run_label(run):
    return f"cindy-fork-run-{int(run['id'])}-{int(run['run_attempt'])}"


def eligible(run, job):
    if (run.get('head_repository', {}).get('full_name') != REPOSITORY
            or run.get('repository', {}).get('full_name') != REPOSITORY
            or run.get('head_branch') != BRANCH or run.get('path') != WORKFLOW
            or run.get('event') not in ('push', 'workflow_dispatch')
            or run.get('status') not in ('queued', 'in_progress', 'waiting')
            or job.get('status') != 'queued' or job.get('run_id') != run.get('id')
            or job.get('head_sha') != run.get('head_sha')
            or job.get('name') not in ROLES):
        return False
    role = ROLES[job['name']]
    expected = {'self-hosted', 'Linux', 'X64', 'cindy-fork-cloud-' + role, run_label(run)}
    return set(job.get('labels', [])) == expected


def metadata(name, config, extra=None):
    return {'name': name, 'namespace': config['namespace'], 'labels': {LABEL: MANAGER, **(extra or {})}}


def job_manifest(config, state):
    role, name = state['role'], state['runnerName']
    labels = {LABEL: MANAGER, 'cindy-runner-role': role, 'cindy-actions-job': str(state['jobId'])}
    runner = {
        'name': 'runner', 'image': config['runnerImage'],
        'securityContext': {'runAsUser': 1001, 'runAsGroup': 1001, 'runAsNonRoot': True,
                            'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}},
        'volumeMounts': [{'name': 'ci', 'mountPath': '/ci'},
                         {'name': 'jit', 'mountPath': '/run/cindy-jit', 'readOnly': True}],
    }
    sizes = {'check': ('3750m', '15872Mi'), 'build': ('1750m', '3584Mi'), 'cache': ('750m', '1536Mi')}
    cpu, memory = sizes[role]
    runner['resources'] = {'requests': {'cpu': cpu, 'memory': memory}, 'limits': {'cpu': cpu, 'memory': memory}}
    dns = {'name': 'dns', 'image': config['runnerImage'],
           'command': ['python3', '/opt/cindy-runner-dns.py'],
           'env': [{'name': 'GITHUB_SNI_FORWARD_IP', 'value': config['sniForwardIp']},
                   {'name': 'DNS_UPSTREAMS', 'value': config['dnsUpstreams']},
                   {'name': 'SNI_FORWARD_DOMAINS', 'value': 'github.com,githubusercontent.com,ghcr.io,nodejs.org'}],
           'resources': {'requests': {'cpu': '250m', 'memory': '512Mi'}, 'limits': {'cpu': '250m', 'memory': '512Mi'}},
           'securityContext': {'runAsUser': 0, 'readOnlyRootFilesystem': True, 'allowPrivilegeEscalation': False,
                               'capabilities': {'drop': ['ALL'], 'add': ['NET_BIND_SERVICE', 'SETGID']}},
           'volumeMounts': [{'name': 'ci', 'mountPath': '/ci', 'readOnly': True}]}
    pod = {'automountServiceAccountToken': False, 'restartPolicy': 'Never', 'dnsPolicy': 'Default',
           'terminationGracePeriodSeconds': 60, 'securityContext': {'fsGroup': 1001},
           'containers': [runner, dns],
           'volumes': [{'name': 'ci', 'emptyDir': {}},
                       {'name': 'jit', 'secret': {'secretName': name + '-jit', 'defaultMode': 0o440}}]}
    if role == 'build':
        bootstrap = {'name': 'bootstrap', 'mountPath': '/bootstrap', 'readOnly': True}
        pod_ip = {'name': 'POD_IP', 'valueFrom': {'fieldRef': {'fieldPath': 'status.podIP'}}}
        runner['command'] = ['python3', '/bootstrap/preflight.py']
        runner['env'] = [{'name': 'DOCKER_HOST', 'value': 'unix:///ci/socket/docker.sock'}]
        runner['volumeMounts'].append(copy.deepcopy(bootstrap))
        dns['env'][-1]['value'] += ',docker.io,production.cloudflare.docker.com,dl.google.com,snapshot.debian.org,artifacts.electronjs.org'
        dns['env'].append(pod_ip)
        pod['containers'].append({
            'name': 'dind', 'image': config['dindImage'], 'command': ['sh', '/bootstrap/daemon.sh'],
            'securityContext': {'privileged': True, 'runAsUser': 0}, 'env': [pod_ip],
            'resources': {'requests': {'cpu': '6', 'memory': '28Gi'}, 'limits': {'cpu': '6', 'memory': '28Gi'}},
            'volumeMounts': [{'name': 'ci', 'mountPath': '/ci'}, {'name': 'docker-data', 'mountPath': '/var/lib/docker'}, bootstrap]})
        pod['volumes'] += [{'name': 'docker-data', 'emptyDir': {}},
                           {'name': 'bootstrap', 'configMap': {'name': config['bootstrapConfigMap']}}]
    return {'apiVersion': 'batch/v1', 'kind': 'Job', 'metadata': metadata(name, config, labels),
            'spec': {'backoffLimit': 0, 'activeDeadlineSeconds': DEADLINES[role], 'ttlSecondsAfterFinished': 3600,
                     'template': {'metadata': {'labels': {**labels, 'alibabacloud.com/eci': 'true'},
                        'annotations': {'k8s.aliyun.com/eci-extra-ephemeral-storage': '150Gi' if role == 'build' else '100Gi',
                                        'k8s.aliyun.com/eci-image-cache': 'false',
                                        'k8s.aliyun.com/eci-custom-dnsconfig': '{"nameservers":"127.0.0.1","options":"ndots:1,timeout:2,attempts:2"}'}},
                                  'spec': pod}}}
