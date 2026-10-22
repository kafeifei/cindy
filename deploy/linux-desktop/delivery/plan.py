#!/usr/bin/env python3
"""Validate committed dual version and export a credential-free delivery plan."""
import argparse
import json
import os
import subprocess
from pathlib import Path
from versioning import COMMIT, cloud_version, image_tag, source_tag, load, require_successor

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
VERSION_PATH = 'deploy/linux-desktop/delivery/version.json'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO, text=True).strip()


def plan(previous=None, fetch_upstream=False):
    value = load(HERE / 'version.json')
    freeze = json.loads((HERE.parent / 'source-freeze.json').read_text())
    if freeze['upstream'] != 'v' + value['upstreamVersion'] or not freeze['packagingAllowed']:
        raise ValueError('FROZEN_SOURCE_VERSION_MISMATCH')
    if fetch_upstream:
        # The fork need not carry upstream tags. Never infer provenance from its
        # default branch or force-replace an existing local tag.
        git('fetch', '--no-tags', 'https://github.com/makecindy/cindy.git',
            'refs/tags/' + freeze['upstream'] + ':refs/tags/' + freeze['upstream'])
    if git('rev-parse', freeze['upstream'] + '^{commit}') != value['upstreamCommit']:
        raise ValueError('UPSTREAM_TAG_COMMIT_MISMATCH')
    changed = True
    if previous and previous != '0' * 40:
        if not COMMIT.fullmatch(previous):
            raise ValueError('PREVIOUS_MUST_BE_COMMIT_SHA')
        # Missing baseline objects are errors; only an absent file means first delivery.
        git('cat-file', '-e', previous + '^{commit}')
        files = git('ls-tree', '--name-only', previous, VERSION_PATH)
        if files:
            changed = require_successor(json.loads(git('show', previous + ':' + VERSION_PATH)), value)
    result = {'schemaVersion': 1, 'version': value, 'cloudVersion': cloud_version(value),
              'imageTag': image_tag(value), 'sourceTag': source_tag(git('rev-parse', 'HEAD')),
              'recipeCommit': git('rev-parse', 'HEAD'),
              'sourceCommit': freeze['commit'], 'releaseChanged': changed,
              'channel': 'candidate', 'releaseApproved': False}
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--previous')
    parser.add_argument('--fetch-upstream', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = plan(args.previous, args.fetch_upstream)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
            out.write('changed=' + str(result['releaseChanged']).lower() + '\n')
            out.write('tag=' + result['imageTag'] + '\n')
