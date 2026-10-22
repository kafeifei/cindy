#!/usr/bin/env python3
"""Build a local CN image from Git; optionally export build cache, never publish a runtime."""
import argparse
import hashlib
import io
import json
import re
import shutil
import subprocess
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BASE_INPUTS = ('runtime-base/Dockerfile', 'runtime-base/packages.lock',
               'runtime-base/base_lock.py', 'runtime-fonts/stage-emoji-font.py',
               'normalize-timestamps.py')

def stage_recipe_contexts(context):
    """Keep unrelated docs/delivery metadata out of expensive filesystem inputs."""
    recipe = context / 'recipe'
    for name in BASE_INPUTS:
        target = context / 'base-recipe' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(recipe / name, target)
    for source in recipe.rglob('*'):
        relative = source.relative_to(recipe)
        if relative.parts[0] in ('delivery', 'runtime-base') or not source.is_file():
            continue
        if (source.name == 'build-inputs.json' or source.name.startswith('test_')
                or '.test.' in source.name or source.name.endswith('.pyc')
                or source.name == 'README.md'
                or (len(relative.parts) == 1 and source.suffix == '.md')):
            continue
        target = context / 'build-recipe' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

def write_combined_dockerfile(context):
    """Use one stage graph; target:base loses application cache on fresh builders.

    The two checked-in recipes remain authoritative. Only source paths and the
    base provenance argument are adapted; no downloaded Cindy image is used.
    """
    base = (context / 'recipe/runtime-base/Dockerfile').read_text()
    app = (context / 'recipe/Dockerfile').read_text()
    base = base.replace('CINDY_SOURCE_COMMIT', 'CINDY_BASE_SOURCE_COMMIT')
    base = base.replace('type=bind,source=', 'type=bind,from=base-recipe,source=')
    app = '\n'.join(line for line in app.splitlines()
                    if not line.startswith('# syntax=') and line != 'ARG BASE_IMAGE')
    if app.count('FROM ${BASE_IMAGE}') != 2:
        raise ValueError('APPLICATION_BASE_STAGES_CHANGED')
    app = app.replace('FROM ${BASE_IMAGE}', 'FROM runtime-base-slim')
    (context / 'Dockerfile.combined').write_text(base + '\n' + app + '\n')
    shutil.copyfile(context / 'recipe/Dockerfile.dockerignore',
                    context / 'Dockerfile.combined.dockerignore')

def registry_cache(repository):
    # No tag, digest, URL credentials, or Buildx CSV options in the input.
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]+(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+', repository):
        raise ValueError('INVALID_BUILD_CACHE_REPOSITORY')
    return {'base': repository + ':fork-cloud-settings-cn-amd64-v2-base',
            'prepared': repository + ':fork-cloud-settings-cn-amd64-v4-prepared'}

def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def export(revision, destination, *paths):
    destination.mkdir(parents=True, exist_ok=True)
    data = git('archive', revision, *paths)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        archive.extractall(destination, filter='data')

def prepare(output, revision):
    context = output / 'context'
    export(revision, output / 'recipe-export', 'deploy/linux-desktop')
    recipe = output / 'recipe-export/deploy/linux-desktop'
    freeze = json.loads((recipe / 'source-freeze.json').read_text())
    manifest = json.loads((recipe / 'runtime-desktop-xfce/source-manifest.json').read_text())
    from delivery.versioning import load as load_version
    version = load_version(recipe / 'delivery/version.json')
    if freeze['packagingAllowed'] is not True or freeze['upstream'] != 'v' + version['upstreamVersion']:
        raise ValueError('SOURCE_NOT_QUALIFIED')
    if git('rev-parse', freeze['upstream'] + '^{commit}').decode().strip() != version['upstreamCommit']:
        raise ValueError('UPSTREAM_TAG_MISMATCH')
    git('merge-base', '--is-ancestor', version['upstreamCommit'], freeze['commit'])
    source = context / 'source'
    export(freeze['commit'], source)
    for path, expected in freeze['includedPatch'].items():
        p = Path(path)
        if p.is_absolute() or '..' in p.parts: raise ValueError('INVALID_PATCH_PATH')
        data = git('show', manifest['clientRuntimeFixCommit'] + ':' + path)
        if digest(data) != expected: raise ValueError('PATCH_HASH_MISMATCH:' + path)
        (source / path).write_bytes(data)
    recipe.rename(context / 'recipe')
    recipe = context / 'recipe'
    inputs = {'recipeCommit': revision, 'sourceCommit': freeze['commit'],
              'runtimeFixCommit': manifest['clientRuntimeFixCommit'] if freeze['includedPatch'] else freeze['commit'],
              'patches': freeze['includedPatch'], 'region': 'cn', 'platform': 'linux/amd64',
              'lockSha256': digest((source / 'pnpm-lock.yaml').read_bytes()),
              'recipeFiles': {p.relative_to(recipe).as_posix(): digest(p.read_bytes())
                              for p in sorted(recipe.rglob('*')) if p.is_file()}}
    (recipe / 'build-inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    inputs['baseRecipeCommit'] = git('log', '-1', '--format=%H', revision, '--',
        *('deploy/linux-desktop/' + p for p in BASE_INPUTS)).decode().strip()
    if not re.fullmatch('[a-f0-9]{40}', inputs['baseRecipeCommit']):
        raise ValueError('BASE_RECIPE_COMMIT_REQUIRED')
    inputs['baseInputs'] = {p: inputs['recipeFiles'][p] for p in BASE_INPUTS}
    stage_recipe_contexts(context)
    write_combined_dockerfile(context)
    return context, inputs

def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()

def run_build(output, name, args, cwd):
    (output / (name + '-command.json')).write_text(json.dumps(args, indent=2) + '\n')
    with (output / (name + '.log')).open('w') as log:
        result = subprocess.run(args, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f'{name} failed; see {output / (name + ".log")}')

def bake_plan(output, tag, revision, entrypoint_sha, no_cache, cloud_revision=None,
              base_revision=None, cache_repository=None, upstream_version=None):
    """Share a single source graph and cache preparation, not packaging scratch."""
    common = {'CINDY_SOURCE_COMMIT': revision, 'SOURCE_DATE_EPOCH': '1789344000',
              'CINDY_BASE_SOURCE_COMMIT': base_revision or revision}
    if upstream_version is not None:
        common['CINDY_UPSTREAM_VERSION'] = upstream_version
    if cloud_revision is not None:
        common['CINDY_CLOUD_REVISION'] = str(cloud_revision)
    graph = {'context': '.', 'dockerfile': 'Dockerfile.combined',
             'contexts': {'base-recipe': './base-recipe'},
             'args': {**common, 'CINDY_RUNTIME_VERSION': tag.rsplit(':', 1)[1],
                      'CINDY_ENTRYPOINT_SHA256': entrypoint_sha},
             'platforms': ['linux/amd64'], 'no-cache': no_cache}
    base = {**graph, 'target': 'runtime-base-slim',
            'output': [f'type=docker,name={tag}-base,rewrite-timestamp=false']}
    runtime = {**graph, 'target': 'runtime',
               'output': [f'type=docker,name={tag},rewrite-timestamp=false']}
    records = {**graph, 'target': 'build-records',
               'output': ['type=local,dest=' + str(output / 'records')]}
    targets = {'base': base, 'runtime': runtime, 'records': records}
    if cache_repository:
        refs = registry_cache(cache_repository)
        prepared = {**graph, 'target': 'prepared', 'output': ['type=cacheonly']}
        targets['prepared'] = prepared
        targets['materialize'] = {**graph, 'target': 'prepared-materialized',
                                  'output': ['type=cacheonly']}
        # The base max history and prepared min chain describe overlapping
        # ancestors. Importing both can select a different parent and re-run
        # preparation even when the complete prepared result exists remotely.
        # Hydrate only the prepared chain first. Runtime/records then consume
        # that local snapshot; only the base exporter imports its max history.
        for target in targets.values():
            target['cache-from'] = []
        if not no_cache:
            base['cache-from'] = ['type=registry,ref=' + refs['base']]
            prepared['cache-from'] = ['type=registry,ref=' + refs['prepared']]
            targets['materialize']['cache-from'] = list(prepared['cache-from'])
        # Base history rarely changes; preserve its existing max cache. Export
        # only the prepared filesystem chain for the application. Packaging
        # scratch and /layer duplicate the final bytes and are rebuilt per version.
        for name, mode in [('base', 'max'), ('prepared', 'min')]:
            targets[name]['cache-to'] = ['type=registry,ref=' + refs[name]
                + ',mode=' + mode + ',image-manifest=true,oci-mediatypes=true']
    return {'target': targets}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--tag', required=True, help='new local image tag; never a formal X.Y.Z tag')
    parser.add_argument('--no-cache', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--builder', help='existing native amd64 Buildx builder; exports images to local Docker')
    parser.add_argument('--cache-repository', help='dedicated mutable Registry cache repository, requires --builder')
    args = parser.parse_args()
    if args.cache_repository:
        registry_cache(args.cache_repository)
        if not args.builder: parser.error('--cache-repository requires --builder')
    if not re.fullmatch(r'[a-z0-9._/-]+:[a-zA-Z0-9_.-]+', args.tag) or re.search(r':\d+\.\d+\.\d+$', args.tag):
        parser.error('use a unique candidate tag')
    if git('status', '--porcelain', '--', 'deploy/linux-desktop').strip():
        parser.error('commit the recipe before building; tracked and untracked recipe changes are rejected')
    revision = git('rev-parse', 'HEAD').decode().strip()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    context, inputs = prepare(output, revision)
    from delivery.versioning import load as load_version
    version = load_version(context / 'recipe/delivery/version.json')
    inputs['version'] = version
    (context / 'recipe/build-inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    (output / 'build-inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    if args.prepare_only: return
    base_tag = args.tag + '-base'
    for tag in (args.tag, base_tag):
        if subprocess.run(['docker', 'image', 'inspect', tag], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            raise ValueError('LOCAL_TAG_EXISTS:' + tag)
    flags = ['--no-cache'] if args.no_cache else []
    build = ['docker', 'buildx', 'build', '--platform', 'linux/amd64', '--progress=plain', *flags]
    common = ['--build-arg', 'CINDY_SOURCE_COMMIT=' + revision, '--build-arg', 'SOURCE_DATE_EPOCH=1789344000',
              '--build-arg', 'CINDY_CLOUD_REVISION=' + str(version['cloudRevision']),
              '--build-arg', 'CINDY_UPSTREAM_VERSION=' + version['upstreamVersion']]
    entrypoint_sha = digest((context / 'recipe/runtime-desktop-xfce/cindy-linux-desktop').read_bytes())
    if args.builder:
        plan = output / 'docker-bake.json'
        plan.write_text(json.dumps(bake_plan(output, args.tag, revision, entrypoint_sha, args.no_cache,
            version['cloudRevision'], inputs['baseRecipeCommit'], args.cache_repository, version['upstreamVersion']), indent=2) + '\n')
        command = ['docker', 'buildx', 'bake', '--builder', args.builder,
                   '--allow=fs.write=' + str(output), '--progress=plain', '-f', str(plan)]
        # Metadata-only cache hits do not restore the prepared filesystem. Mount
        # its chain in a separate network-free solve before parallel exporters;
        # max/min parent selection has otherwise re-executed installation.
        # Explicit cold builds retain no-cache for the entire graph.
        if args.cache_repository and not args.no_cache:
            run_build(output, 'prepare-build', command + ['--metadata-file',
                str(output / 'prepare-metadata.json'), 'prepared'], context)
            run_build(output, 'materialize-build', command + ['--metadata-file',
                str(output / 'materialize-metadata.json'), 'materialize'], context)
        run_build(output, 'full-build', command + ['--metadata-file',
                  str(output / 'build-metadata.json'), 'base', 'runtime', 'records',
                  *(['prepared'] if args.cache_repository and args.no_cache else [])], context)
        base = json.loads(docker('image', 'inspect', base_tag))[0]
        info = json.loads(docker('image', 'inspect', args.tag))[0]
        (output / 'base-image.json').write_text(json.dumps(base, indent=2) + '\n')
        (output / 'runtime-image.json').write_text(json.dumps(info, indent=2) + '\n')
        import release_guard
        release_guard.audit_image(info, base, revision, entrypoint_sha)
        (output / 'result.json').write_text(json.dumps({'imageId': info['Id'], 'baseImageId': base['Id'],
                  'recipeCommit': revision, 'builder': args.builder, 'bytes': info['Size'], 'published': False,
                  'runtimeAcceptance': 'pending', 'buildOnly': True}, indent=2) + '\n')
        print(json.dumps({'imageId': info['Id'], 'output': str(output), 'runtimeAcceptance': 'pending'}))
        return
    run_build(output, 'base-build', build + ['-f', 'runtime-base/Dockerfile',
              '--build-arg', 'CINDY_SOURCE_COMMIT=' + inputs['baseRecipeCommit'], '--build-arg', 'SOURCE_DATE_EPOCH=1789344000',
              '--target', 'runtime-base-slim', '--output', f'type=docker,name={base_tag},rewrite-timestamp=false', '.'], context / 'base-recipe')
    base = json.loads(docker('image', 'inspect', base_tag))[0]
    (output / 'base-image.json').write_text(json.dumps(base, indent=2) + '\n')
    runtime_args = ['-f', 'recipe/Dockerfile', *common, '--build-arg', 'BASE_IMAGE=' + base_tag,
                    '--build-arg', 'CINDY_RUNTIME_VERSION=' + args.tag.rsplit(':', 1)[1],
                    '--build-arg', 'CINDY_ENTRYPOINT_SHA256=' + digest((context / 'recipe/runtime-desktop-xfce/cindy-linux-desktop').read_bytes())]
    run_build(output, 'runtime-build', build + runtime_args + ['--target', 'runtime', '--output',
              f'type=docker,name={args.tag},rewrite-timestamp=false', '.'], context)
    if json.loads(docker('image', 'inspect', base_tag))[0]['Id'] != base['Id']:
        raise RuntimeError('BASE_IMAGE_CHANGED')
    info = json.loads(docker('image', 'inspect', args.tag))[0]
    (output / 'runtime-image.json').write_text(json.dumps(info, indent=2) + '\n')
    import release_guard
    release_guard.audit_image(info, base, revision, digest((context / 'recipe/runtime-desktop-xfce/cindy-linux-desktop').read_bytes()))
    run_build(output, 'build-records', ['docker', 'buildx', 'build', '--platform', 'linux/amd64',
              '--progress=plain', *runtime_args, '--target', 'build-records', '--output',
              'type=local,dest=' + str(output / 'records'), '.'], context)
    (output / 'result.json').write_text(json.dumps({'imageId': info['Id'], 'baseImageId': base['Id'],
              'recipeCommit': revision, 'bytes': info['Size'], 'published': False,
              'runtimeAcceptance': 'pending', 'buildOnly': True}, indent=2) + '\n')
    print(json.dumps({'imageId': info['Id'], 'output': str(output), 'runtimeAcceptance': 'pending'}))

if __name__ == '__main__':
    main()
