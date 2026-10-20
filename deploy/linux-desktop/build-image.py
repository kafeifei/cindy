#!/usr/bin/env python3
"""Build a local CN image from committed sources. Never publish or deploy."""
import argparse
import hashlib
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

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
    if freeze['packagingAllowed'] is not True or freeze['upstream'] != 'v0.1.108':
        raise ValueError('SOURCE_NOT_QUALIFIED')
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
              'runtimeFixCommit': manifest['clientRuntimeFixCommit'],
              'patches': freeze['includedPatch'], 'region': 'cn', 'platform': 'linux/amd64',
              'lockSha256': digest((source / 'pnpm-lock.yaml').read_bytes()),
              'recipeFiles': {p.relative_to(recipe).as_posix(): digest(p.read_bytes())
                              for p in sorted(recipe.rglob('*')) if p.is_file()}}
    (recipe / 'build-inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    return context, inputs

def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()

def run_build(output, name, args, cwd):
    (output / (name + '-command.json')).write_text(json.dumps(args, indent=2) + '\n')
    with (output / (name + '.log')).open('w') as log:
        result = subprocess.run(args, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f'{name} failed; see {output / (name + ".log")}')

def bake_plan(output, tag, revision, entrypoint_sha, no_cache):
    """Connect both Dockerfiles without publishing an intermediate base image."""
    common = {'CINDY_SOURCE_COMMIT': revision, 'SOURCE_DATE_EPOCH': '1789344000'}
    base = {'context': 'recipe', 'dockerfile': 'runtime-base/Dockerfile',
            'target': 'runtime-base-slim', 'args': common,
            'platforms': ['linux/amd64'], 'no-cache': no_cache,
            'output': [f'type=docker,name={tag}-base,rewrite-timestamp=true']}
    runtime = {'context': '.', 'dockerfile': 'recipe/Dockerfile',
               'contexts': {'cindy-source-base': 'target:base'},
               'args': {**common, 'BASE_IMAGE': 'cindy-source-base',
                        'CINDY_RUNTIME_VERSION': tag.rsplit(':', 1)[1],
                        'CINDY_ENTRYPOINT_SHA256': entrypoint_sha},
               'platforms': ['linux/amd64'], 'no-cache': no_cache, 'target': 'runtime',
               'output': [f'type=docker,name={tag},rewrite-timestamp=true']}
    records = {**runtime, 'target': 'build-records',
               'output': ['type=local,dest=' + str(output / 'records')]}
    return {'target': {'base': base, 'runtime': runtime, 'records': records}}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--tag', required=True, help='new local image tag; never a formal X.Y.Z tag')
    parser.add_argument('--no-cache', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--builder', help='existing native amd64 Buildx builder; exports images to local Docker')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9._/-]+:[a-zA-Z0-9_.-]+', args.tag) or re.search(r':\d+\.\d+\.\d+$', args.tag):
        parser.error('use a unique candidate tag')
    if git('status', '--porcelain', '--', 'deploy/linux-desktop').strip():
        parser.error('commit the recipe before building; tracked and untracked recipe changes are rejected')
    revision = git('rev-parse', 'HEAD').decode().strip()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    context, inputs = prepare(output, revision)
    (output / 'build-inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    if args.prepare_only: return
    base_tag = args.tag + '-base'
    for tag in (args.tag, base_tag):
        if subprocess.run(['docker', 'image', 'inspect', tag], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            raise ValueError('LOCAL_TAG_EXISTS:' + tag)
    flags = ['--no-cache'] if args.no_cache else []
    build = ['docker', 'buildx', 'build', '--platform', 'linux/amd64', '--progress=plain', *flags]
    common = ['--build-arg', 'CINDY_SOURCE_COMMIT=' + revision, '--build-arg', 'SOURCE_DATE_EPOCH=1789344000']
    entrypoint_sha = digest((context / 'recipe/runtime-desktop-xfce/cindy-linux-desktop').read_bytes())
    if args.builder:
        plan = output / 'docker-bake.json'
        plan.write_text(json.dumps(bake_plan(output, args.tag, revision, entrypoint_sha, args.no_cache), indent=2) + '\n')
        run_build(output, 'full-build', ['docker', 'buildx', 'bake', '--builder', args.builder,
                  '--allow=fs.write=' + str(output / 'records'),
                  '--progress=plain', '-f', str(plan), '--metadata-file', str(output / 'build-metadata.json'),
                  'base', 'runtime', 'records'], context)
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
    run_build(output, 'base-build', build + ['-f', 'runtime-base/Dockerfile', *common,
              '--target', 'runtime-base-slim', '--output', f'type=docker,name={base_tag},rewrite-timestamp=true', '.'], context / 'recipe')
    base = json.loads(docker('image', 'inspect', base_tag))[0]
    (output / 'base-image.json').write_text(json.dumps(base, indent=2) + '\n')
    runtime_args = ['-f', 'recipe/Dockerfile', *common, '--build-arg', 'BASE_IMAGE=' + base_tag,
                    '--build-arg', 'CINDY_RUNTIME_VERSION=' + args.tag.rsplit(':', 1)[1],
                    '--build-arg', 'CINDY_ENTRYPOINT_SHA256=' + digest((context / 'recipe/runtime-desktop-xfce/cindy-linux-desktop').read_bytes())]
    run_build(output, 'runtime-build', build + runtime_args + ['--target', 'runtime', '--output',
              f'type=docker,name={args.tag},rewrite-timestamp=true', '.'], context)
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
