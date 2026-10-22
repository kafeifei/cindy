"""Cloud release identity. Never compare the combined tag with SemVer."""
import json
import re
from pathlib import Path

VERSION = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')
COMMIT = re.compile(r'[a-f0-9]{40}')
DIGEST = re.compile(r'sha256:[a-f0-9]{64}')
REPOSITORY = re.compile(r'[a-z0-9][a-z0-9.-]+(?::[0-9]{1,5})?(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+')
KEYS = {'schemaVersion', 'upstreamVersion', 'upstreamCommit', 'cloudRevision', 'region', 'platform'}


def validate_push_repository(repository, transport=None):
    """Keep release identity public; allow only that ACR repository's VPC alias."""
    if not REPOSITORY.fullmatch(repository):
        raise ValueError('INVALID_REPOSITORY')
    if not transport or transport == repository:
        return repository
    host, path = repository.split('/', 1)
    match = re.fullmatch(r'([a-z0-9][a-z0-9-]*)\.([a-z]+-[a-z]+-[0-9]+|cn-[a-z]+)\.cr\.aliyuncs\.com', host)
    if (not match or match[1].endswith('-vpc')
            or transport != f'{match[1]}-vpc.{match[2]}.cr.aliyuncs.com/{path}'):
        raise ValueError('INVALID_PUSH_REPOSITORY')
    return transport


def validate(value):
    if not isinstance(value, dict) or set(value) != KEYS or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
        raise ValueError('INVALID_RELEASE_SCHEMA')
    if not isinstance(value['upstreamVersion'], str) or not VERSION.fullmatch(value['upstreamVersion']):
        raise ValueError('INVALID_UPSTREAM_VERSION')
    if not isinstance(value['upstreamCommit'], str) or not COMMIT.fullmatch(value['upstreamCommit']):
        raise ValueError('INVALID_UPSTREAM_COMMIT')
    if type(value['cloudRevision']) is not int or not 1 <= value['cloudRevision'] <= 2147483647:
        raise ValueError('INVALID_CLOUD_REVISION')
    # The complete recipe is currently qualified only for this explicit identity.
    if value['region'] != 'cn' or value['platform'] != 'linux/amd64':
        raise ValueError('RECIPE_REGION_PLATFORM_UNSUPPORTED')
    return value


def load(path):
    return validate(json.loads(Path(path).read_text()))


def version_key(value):
    validate(value)
    return (*map(int, value['upstreamVersion'].split('.')), value['cloudRevision'])


def cloud_version(value):
    validate(value)
    return f"{value['upstreamVersion']}-cloud.{value['cloudRevision']}"


def image_tag(value):
    return cloud_version(value) + '-cn-amd64'


def source_tag(commit):
    if not isinstance(commit, str) or not COMMIT.fullmatch(commit):
        raise ValueError('INVALID_RECIPE_COMMIT')
    return 'sha-' + commit + '-cn-amd64'


def require_successor(previous, current):
    validate(previous)
    validate(current)
    if current == previous:
        return False
    old, new = version_key(previous), version_key(current)
    if new[:3] < old[:3]:
        raise ValueError('UPSTREAM_DOWNGRADE')
    if new[:3] == old[:3]:
        if current['upstreamCommit'] != previous['upstreamCommit']:
            raise ValueError('UPSTREAM_TAG_MOVED')
        if new[3] != old[3] + 1:
            raise ValueError('CLOUD_REVISION_MUST_INCREMENT_BY_ONE')
    elif new[3] != 1:
        raise ValueError('NEW_UPSTREAM_MUST_START_AT_CLOUD_ONE')
    return True


def require_same_release(existing, expected, digest):
    """Promotion consumers must bind the identity to exactly one registry digest."""
    if not DIGEST.fullmatch(digest):
        raise ValueError('INVALID_REGISTRY_DIGEST')
    if existing['version'] != expected or existing['image']['digest'] != digest:
        raise ValueError('RELEASE_IDENTITY_CONFLICT')
