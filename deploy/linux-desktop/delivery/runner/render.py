#!/usr/bin/env python3
"""Render isolated controller/RBAC/config. Credential Secret is provisioned separately."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
from provision import validate

HERE = Path(__file__).resolve().parent
NAME = 'cindy-fork-autosupply'


def render(settings):
    settings = validate(copy.deepcopy(settings))
    ns = settings['namespace']
    source = {f: (HERE / f).read_text() for f in ['controller.py', 'provision.py', 'daemon.sh', 'preflight.py']}
    version = hashlib.sha256(json.dumps([source, settings], sort_keys=True).encode()).hexdigest()[:12]
    cm_name = NAME + '-' + version
    settings['bootstrapConfigMap'] = cm_name
    source['config.json'] = json.dumps(settings)
    meta = {'name': NAME, 'namespace': ns, 'labels': {'app.kubernetes.io/name': NAME}}
    context = {'runAsNonRoot': True, 'runAsUser': 1001, 'runAsGroup': 1001, 'allowPrivilegeEscalation': False,
               'readOnlyRootFilesystem': True, 'capabilities': {'drop': ['ALL']}}
    runner_context = copy.deepcopy(context)
    volume = {'name': 'source', 'mountPath': '/controller', 'readOnly': True}
    return {'apiVersion': 'v1', 'kind': 'List', 'items': [
        {'apiVersion': 'v1', 'kind': 'ServiceAccount', 'metadata': meta, 'automountServiceAccountToken': False},
        {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'Role', 'metadata': meta, 'rules': [
            {'apiGroups': [''], 'resources': ['configmaps'], 'verbs': ['get', 'list', 'create', 'update', 'delete']},
            {'apiGroups': [''], 'resources': ['secrets'], 'verbs': ['get', 'create', 'delete']},
            {'apiGroups': ['batch'], 'resources': ['jobs'], 'verbs': ['get', 'create', 'delete']},
            {'apiGroups': ['coordination.k8s.io'], 'resources': ['leases'], 'verbs': ['get', 'create', 'update']}]},
        {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'RoleBinding', 'metadata': meta,
         'subjects': [{'kind': 'ServiceAccount', 'name': NAME, 'namespace': ns}],
         'roleRef': {'kind': 'Role', 'name': NAME, 'apiGroup': 'rbac.authorization.k8s.io'}},
        {'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': {**meta, 'name': cm_name}, 'immutable': True, 'data': source},
        {'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': meta, 'spec': {
            'replicas': 1, 'strategy': {'type': 'Recreate'}, 'revisionHistoryLimit': 2,
            'selector': {'matchLabels': {'app.kubernetes.io/name': NAME}},
            'template': {'metadata': {'labels': {'app.kubernetes.io/name': NAME}}, 'spec': {
                'serviceAccountName': NAME, 'automountServiceAccountToken': False,
                'dnsPolicy': 'None', 'dnsConfig': {'nameservers': ['127.0.0.1'], 'options': [{'name': 'ndots', 'value': '1'}]},
                'securityContext': {'fsGroup': 1001}, 'terminationGracePeriodSeconds': 30,
                'containers': [
                    {'name': 'controller', 'image': settings['runnerImage'],
                     'command': ['python3', '/controller/controller.py', '--config', '/controller/config.json'],
                     'env': [{'name': 'PYTHONDONTWRITEBYTECODE', 'value': '1'}],
                     'securityContext': runner_context,
                     'resources': {'requests': {'cpu': '100m', 'memory': '128Mi'}, 'limits': {'cpu': '500m', 'memory': '256Mi'}},
                     'readinessProbe': {'exec': {'command': ['python3', '-c',
                        "import time; from pathlib import Path; assert time.time()-float(Path('/tmp/controller-ready').read_text())<180"]},
                        'initialDelaySeconds': 10, 'periodSeconds': 30},
                     'volumeMounts': [volume, {'name': 'credentials', 'mountPath': '/credentials', 'readOnly': True},
                         {'name': 'kube-api', 'mountPath': '/var/run/cindy-kubernetes', 'readOnly': True},
                         {'name': 'tmp', 'mountPath': '/tmp'}]},
                    {'name': 'dns', 'image': settings['runnerImage'], 'command': ['python3', '/opt/cindy-runner-dns.py'],
                     'env': [{'name': 'GITHUB_SNI_FORWARD_IP', 'value': settings['sniForwardIp']},
                             {'name': 'DNS_UPSTREAMS', 'value': settings['dnsUpstreams']}],
                     'securityContext': {'runAsUser': 0, 'readOnlyRootFilesystem': True, 'allowPrivilegeEscalation': False,
                         'capabilities': {'drop': ['ALL'], 'add': ['NET_BIND_SERVICE', 'SETGID']}},
                     'resources': {'requests': {'cpu': '50m', 'memory': '32Mi'}, 'limits': {'cpu': '100m', 'memory': '64Mi'}},
                     'volumeMounts': [{'name': 'ci', 'mountPath': '/ci', 'readOnly': True}]}],
                'volumes': [{'name': 'source', 'configMap': {'name': cm_name}},
                            {'name': 'credentials', 'secret': {'secretName': NAME + '-github', 'defaultMode': 0o440}},
                            {'name': 'kube-api', 'projected': {'defaultMode': 0o440, 'sources': [
                                {'serviceAccountToken': {'path': 'token', 'expirationSeconds': 3600}},
                                {'configMap': {'name': 'kube-root-ca.crt', 'items': [{'key': 'ca.crt', 'path': 'ca.crt'}]}}]}},
                            {'name': 'tmp', 'emptyDir': {}}, {'name': 'ci', 'emptyDir': {}}]}}}}]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(render(json.loads(args.config.read_text())), indent=2))
