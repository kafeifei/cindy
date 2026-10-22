#!/usr/bin/env python3
"""Publish the already tested local image. Never rebuild, promote or touch CIS."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from versioning import REPOSITORY, image_tag, validate, cloud_version, source_tag, validate_push_repository


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def registry_manifest(reference):
    result = subprocess.run(['docker', 'buildx', 'imagetools', 'inspect', '--raw', reference],
                            text=True, capture_output=True, timeout=60)
    if result.returncode:
        # Authentication, timeout and DNS failures must never mean "tag absent".
        if ('manifest unknown' in result.stderr.lower() or 'MANIFEST_UNKNOWN' in result.stderr
                or result.stderr.strip() == 'ERROR: ' + reference + ': not found'):
            return None
        raise ValueError('REGISTRY_INSPECTION_FAILED (diagnostic output withheld)')
    return json.loads(result.stdout)


def check_build(plan, info, result, smoke, records):
    version = validate(plan['version'])
    if plan['imageTag'] != image_tag(version) or plan['channel'] != 'candidate' or plan['releaseApproved'] is not False:
        raise ValueError('INVALID_CANDIDATE_PLAN')
    if result['imageId'] != info['Id'] or result['recipeCommit'] != plan['recipeCommit']:
        raise ValueError('BUILD_IDENTITY_MISMATCH')
    labels = info['Config']['Labels']
    expected = {'io.cindy.source-commit': plan['recipeCommit'],
                'io.cindy.upstream-version': version['upstreamVersion'],
                'io.cindy.cloud-revision': str(version['cloudRevision']),
                'io.cindy.region': version['region'], 'io.cindy.target-architecture': 'amd64'}
    if any(labels.get(k) != v for k, v in expected.items()):
        raise ValueError('IMAGE_VERSION_LABEL_MISMATCH')
    if info['Os'] != 'linux' or info['Architecture'] != 'amd64' or len(info['RootFS']['Layers']) != 2:
        raise ValueError('IMAGE_PLATFORM_OR_LAYOUT_MISMATCH')
    if smoke.get('imageId') != info['Id'] or smoke.get('passed') is not True or smoke.get('nativeArchitecture') != 'x86_64':
        raise ValueError('NATIVE_SMOKE_MISSING')
    for check in ['networkIsolated', 'readOnlyRoot', 'sandboxedRenderers', 'legacyHome', 'desktopReady', 'shutdown']:
        if smoke.get(check) is not True:
            raise ValueError('NATIVE_SMOKE_INCOMPLETE:' + check)
    if smoke.get('applicationVersion') != cloud_version(version):
        raise ValueError('APPLICATION_VERSION_MISMATCH')
    required = ['runtime-layer-audit.json', 'agent-source-proof.json', 'overlay-application.json', 'build-inputs.json']
    hashes = {name: hashlib.sha256((records / name).read_bytes()).hexdigest() for name in required}
    inputs = json.loads((records / 'build-inputs.json').read_text())
    if inputs.get('recipeCommit') != plan['recipeCommit'] or inputs.get('version') != version:
        raise ValueError('BUILD_RECORD_IDENTITY_MISMATCH')
    return hashes


def transport_reference(reference, push_repository):
    repository, tag = reference.rsplit(':', 1)
    return validate_push_repository(repository, push_repository) + ':' + tag


def publish(reference, image_id, inspect=registry_manifest, execute=run, push_repository=None):
    transport = transport_reference(reference, push_repository)
    existing = inspect(reference)
    if existing is not None and existing.get('config', {}).get('digest') != image_id:
        raise ValueError('IMMUTABLE_TAG_CONFLICT')
    if existing is None:
        execute('docker', 'tag', image_id, transport)
        execute('docker', 'push', transport)
    remote = inspect(reference)
    if not remote or remote.get('config', {}).get('digest') != image_id:
        raise ValueError('PUBLISHED_CONFIG_MISMATCH')
    # Docker returns a parsed manifest above; obtain raw bytes separately. JSON
    # reserialization would give the wrong registry digest.
    return remote


def publish_tags(references, image_id, inspect=registry_manifest, execute=run, push_repository=None):
    # Inspect every tag before the first write: a source-tag conflict must not
    # leave a newly published version pointing to an unpaired release.
    # Check both endpoints before any write. The optional route cannot change
    # the instance, region, repository, tag or canonical public read-back.
    transports = [transport_reference(ref, push_repository) for ref in references]
    for reference in dict.fromkeys([*references, *transports]):
        existing = inspect(reference)
        if existing is not None and existing.get('config', {}).get('digest') != image_id:
            raise ValueError('IMMUTABLE_TAG_CONFLICT')
    for reference in references:
        publish(reference, image_id, inspect=inspect, execute=execute, push_repository=push_repository)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--build', required=True, type=Path)
    parser.add_argument('--smoke', required=True, type=Path)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--push-repository', help='Optional same-repository ACR VPC transport')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if not REPOSITORY.fullmatch(args.repository):
        raise ValueError('INVALID_REPOSITORY')
    validate_push_repository(args.repository, args.push_repository)
    plan = json.loads(args.plan.read_text())
    result = json.loads((args.build / 'result.json').read_text())
    image_id = result['imageId']
    info = json.loads(run('docker', 'image', 'inspect', image_id))[0]
    smoke = json.loads(args.smoke.read_text())
    hashes = check_build(plan, info, result, smoke, args.build / 'records')
    reference = args.repository + ':' + plan['imageTag']
    alias = args.repository + ':' + source_tag(plan['recipeCommit'])
    if plan.get('sourceTag') != source_tag(plan['recipeCommit']):
        raise ValueError('SOURCE_TAG_MISMATCH')
    publish_tags([reference, alias], image_id, push_repository=args.push_repository)
    raw = subprocess.check_output(['docker', 'buildx', 'imagetools', 'inspect', '--raw', reference])
    # imagetools prints the manifest bytes, without parsing or reformatting.
    digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
    alias_raw = subprocess.check_output(['docker', 'buildx', 'imagetools', 'inspect', '--raw', alias])
    if alias_raw != raw:
        raise ValueError('TAG_MANIFEST_MISMATCH')
    exact = reference + '@' + digest
    if registry_manifest(exact).get('config', {}).get('digest') != image_id:
        raise ValueError('REGISTRY_DIGEST_VERIFICATION_FAILED')
    manifest = {**plan, 'image': {'reference': exact, 'digest': digest, 'configId': image_id,
                                'bytes': info['Size'], 'layers': len(info['RootFS']['Layers']),
                                'tags': [plan['imageTag'], plan['sourceTag']],
                                'sourceReference': alias + '@' + digest},
                'recordsSha256': hashes, 'nativeSmoke': smoke,
                'qualification': {'productAcceptance': 'pending', 'deviceLink': 'pending', 'oauth': 'pending'},
                'acs': {'status': 'pending', 'podMatchVerified': False},
                'releaseApproved': False}
    args.output.write_text(json.dumps(manifest, indent=2) + '\n')
