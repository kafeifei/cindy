#!/usr/bin/env python3
"""Publish the already tested local image. Never rebuild, promote or touch CIS."""
import argparse
import hashlib
import json
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from versioning import REPOSITORY, image_tag, validate, cloud_version, source_tag, validate_push_repository


def run(*args):
    started = time.monotonic()
    result = subprocess.check_output(args, text=True).strip()
    if args[:2] == ('docker', 'push'):
        print(json.dumps({'operation': 'push', 'seconds': round(time.monotonic() - started, 3)}), flush=True)
    return result


def registry_manifest(reference):
    started = time.monotonic()
    result = subprocess.run(['docker', 'buildx', 'imagetools', 'inspect', '--raw', reference],
                            text=True, capture_output=True, timeout=60)
    print(json.dumps({'operation': 'inspect', 'seconds': round(time.monotonic() - started, 3)}), flush=True)
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
    required = ['runtime-layer-audit.json', 'agent-source-proof.json', 'overlay-application.json', 'build-inputs.json', 'native-modules.json']
    hashes = {name: hashlib.sha256((records / name).read_bytes()).hexdigest() for name in required}
    native = json.loads((records / 'native-modules.json').read_text())
    if (native.get('passed') is not True or native.get('sqlite') is not True or native.get('pty') is not True
            or native.get('electronVersion') != '42.11.12' or not str(native.get('abi', '')).isdigit()):
        raise ValueError('PACKAGED_NATIVE_PROBE_MISSING')
    inputs = json.loads((records / 'build-inputs.json').read_text())
    if inputs.get('recipeCommit') != plan['recipeCommit'] or inputs.get('version') != version:
        raise ValueError('BUILD_RECORD_IDENTITY_MISMATCH')
    return hashes


def transport_reference(reference, push_repository):
    repository, tag = reference.rsplit(':', 1)
    return validate_push_repository(repository, push_repository) + ':' + tag


def publish(reference, image_id, inspect=registry_manifest, execute=run, push_repository=None, source=None):
    transport = transport_reference(reference, push_repository)
    existing = inspect(reference)
    if existing is not None and existing.get('config', {}).get('digest') != image_id:
        raise ValueError('IMMUTABLE_TAG_CONFLICT')
    if existing is None:
        if source is None:
            execute('docker', 'tag', image_id, transport)
            execute('docker', 'push', transport)
        else:
            execute('docker', 'buildx', 'imagetools', 'create', '--prefer-index=false',
                    '--tag', transport, source)
    remote = inspect(reference)
    if not remote or remote.get('config', {}).get('digest') != image_id:
        raise ValueError('PUBLISHED_CONFIG_MISMATCH')
    # Docker returns a parsed manifest above; obtain raw bytes separately. JSON
    # reserialization would give the wrong registry digest.
    return remote


def existing_manifest_source(reference, push_repository):
    raw = subprocess.check_output(['docker', 'buildx', 'imagetools', 'inspect', '--raw', reference])
    repository = transport_reference(reference, push_repository).rsplit(':', 1)[0]
    return repository + '@sha256:' + hashlib.sha256(raw).hexdigest()


def publish_tags(references, image_id, inspect=registry_manifest, execute=run, push_repository=None,
                 export_tested=None, existing_source=existing_manifest_source):
    # Inspect every tag before the first write: a source-tag conflict must not
    # leave a newly published version pointing to an unpaired release.
    # Check both endpoints before any write. The optional route cannot change
    # the instance, region, repository, tag or canonical public read-back.
    transports = [transport_reference(ref, push_repository) for ref in references]
    checks = list(dict.fromkeys([*references, *transports]))
    # These reads are independent. Finish all checks before any tag can be
    # written; a slow or failed endpoint must not become permission to publish.
    with ThreadPoolExecutor(max_workers=4) as pool:
        existing_tags = list(pool.map(inspect, checks))
    for existing in existing_tags:
        if existing is not None and existing.get('config', {}).get('digest') != image_id:
            raise ValueError('IMMUTABLE_TAG_CONFLICT')
    source = None
    if export_tested and any(existing_tags[checks.index(ref)] is None for ref in references):
        # The exporter uploads no version tag. Only the tested config digest may
        # be copied into the immutable version/source tags below.
        present = next((ref for ref in references if existing_tags[checks.index(ref)] is not None), None)
        # Resume a partially published pair from its exact existing manifest.
        # Equivalent configs may have different compressed-layer digests; a
        # new export must not give the missing alias a different manifest.
        source = existing_source(present, push_repository) if present else export_tested()
        repository = transports[0].rsplit(':', 1)[0]
        if not re.fullmatch(re.escape(repository) + r'@sha256:[a-f0-9]{64}', source):
            raise ValueError('EXPORTED_REFERENCE_MISMATCH')
        exported = inspect(source)
        if not exported or exported.get('config', {}).get('digest') != image_id:
            raise ValueError('EXPORTED_CONFIG_MISMATCH')
    for reference in references:
        publish(reference, image_id, inspect=inspect, execute=execute, push_repository=push_repository, source=source)


def export_tested_image(build, image_id, repository):
    """Reuse this job's compressed BuildKit result after smoke, without tag writes."""
    result = json.loads((build / 'result.json').read_text())
    if result.get('imageId') != image_id or not re.fullmatch(r'[a-zA-Z0-9_.-]+', result.get('builder', '')):
        raise ValueError('TESTED_BUILDER_REQUIRED')
    metadata = json.loads((build / 'build-metadata.json').read_text())
    if metadata['runtime'].get('containerimage.config.digest') != image_id:
        raise ValueError('TESTED_EXPORT_MISMATCH')
    graph = json.loads((build / 'docker-bake.json').read_text())
    runtime = graph['target']['runtime']
    # No cache import/export, application changes, or timestamp rewriting.
    # Even if the local cache is lost, different bytes cannot receive a tag:
    # compare the exported config and remote digest to the tested image below.
    runtime['cache-from'] = []
    runtime['no-cache'] = False
    runtime.pop('cache-to', None)
    runtime['attest'] = ['type=provenance,disabled=true']
    runtime['output'] = ['type=image,name=' + repository
        + ',push=true,push-by-digest=true,oci-mediatypes=false,rewrite-timestamp=false']
    output = build / 'publish-bake.json'
    output.write_text(json.dumps({'target': {'runtime': runtime}}, indent=2) + '\n')
    receipt = build / 'publish-metadata.json'
    started = time.monotonic()
    with (build / 'publish-build.log').open('w') as log:
        subprocess.run(['docker', 'buildx', 'bake', '--builder', result['builder'], '--progress=plain',
                        '-f', str(output), '--metadata-file', str(receipt), 'runtime'],
                       cwd=build / 'context', stdout=log, stderr=subprocess.STDOUT, check=True)
    print(json.dumps({'operation': 'export-push', 'seconds': round(time.monotonic() - started, 3)}), flush=True)
    exported = json.loads(receipt.read_text())['runtime']
    if exported.get('containerimage.config.digest') != image_id:
        raise ValueError('EXPORTED_CONFIG_MISMATCH')
    digest = exported.get('containerimage.digest', '')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise ValueError('EXPORTED_DIGEST_MISSING')
    return repository + '@' + digest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--build', required=True, type=Path)
    parser.add_argument('--smoke', required=True, type=Path)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--push-repository', help='Optional same-repository ACR VPC transport')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--reuse-buildkit-export', action='store_true',
                        help='Upload the tested BuildKit result by digest before writing version tags')
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
    transport = validate_push_repository(args.repository, args.push_repository)
    exporter = (lambda: export_tested_image(args.build.resolve(), image_id, transport)) if args.reuse_buildkit_export else None
    publish_tags([reference, alias], image_id, push_repository=args.push_repository, export_tested=exporter)
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
