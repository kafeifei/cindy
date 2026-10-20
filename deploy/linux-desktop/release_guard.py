"""Offline permission/content gate for the cloud runtime application layer.

Operational build material; never reads instance credentials or business data.
The layer is a root-owned, read-only application distribution, not a data backup.
"""
import hashlib
import json
import os
import stat
from pathlib import Path

ENTRYPOINT = ['/usr/local/bin/cindy-seccomp', '/usr/local/bin/cindy-linux-desktop']
CMD = ['/opt/cindy/Cindy']

class ReleaseRejected(RuntimeError):
    pass

def require(ok, reason):
    if not ok:
        raise ReleaseRejected(reason)

def sha(file):
    with Path(file).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def canonical(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def expected_files(payload, frozen, wrapper, wrapper_sha):
    payload, wrapper = Path(payload), Path(wrapper)
    require(sha(wrapper) == wrapper_sha, 'ENTRYPOINT_CONTENT_CHANGED')
    result = {}
    for name, digest in frozen.items():
        relative = Path(name)
        require(not relative.is_absolute() and '..' not in relative.parts, 'INVALID_PAYLOAD_PATH')
        p = payload / relative
        require(p.is_file() and not p.is_symlink(), 'INVALID_PAYLOAD_FILE:' + name)
        require(sha(p) == digest, 'PAYLOAD_CONTENT_CHANGED:' + name)
        mode = 0o755 if p.stat().st_mode & 0o111 else 0o644
        result['opt/cindy/' + name] = {'sha256': digest, 'mode': mode}
    require({p.relative_to(payload).as_posix() for p in payload.rglob('*') if p.is_file()} == set(frozen),
            'PAYLOAD_FILE_SET_CHANGED')
    require(not any(p.is_symlink() for p in payload.rglob('*')), 'PAYLOAD_SYMLINK_UNREVIEWED')
    result['usr/local/bin/cindy-linux-desktop'] = {'sha256': wrapper_sha, 'mode': 0o755}
    for name in ['opt/cindy/Cindy', 'opt/cindy/chrome_crashpad_handler']:
        require(result.get(name, {}).get('mode') == 0o755, 'REQUIRED_EXECUTABLE_MISSING:' + name)
    return result

def paths(layer):
    layer = Path(layer)
    require(layer.is_dir() and not layer.is_symlink(), 'INVALID_LAYER_ROOT')
    return [layer, *sorted(layer.rglob('*'))]

def normalize_layer(layer, expected):
    """Explicit modes, independent of process umask; source artifacts unchanged."""
    layer = Path(layer)
    files = set()
    for p in paths(layer):
        require(not p.is_symlink(), 'LAYER_SYMLINK_UNREVIEWED:' + str(p))
        name = p.relative_to(layer).as_posix()
        if p.is_dir():
            os.chmod(p, 0o755)
        else:
            require(p.is_file() and name in expected, 'UNEXPECTED_LAYER_FILE:' + name)
            require(sha(p) == expected[name]['sha256'], 'LAYER_CONTENT_CHANGED:' + name)
            os.chmod(p, expected[name]['mode'])
            files.add(name)
    require(files == set(expected), 'LAYER_FILE_SET_CHANGED')

def audit_layer(layer, expected):
    layer = Path(layer)
    manifest, files = [], set()
    for p in paths(layer):
        name = p.relative_to(layer).as_posix()
        st = p.lstat()
        require(not stat.S_ISLNK(st.st_mode), 'LAYER_SYMLINK_UNREVIEWED:' + name)
        mode = stat.S_IMODE(st.st_mode)
        if stat.S_ISDIR(st.st_mode):
            require(mode == 0o755, 'DIRECTORY_PERMISSION:' + name + ':' + oct(mode))
            manifest.append({'path': name, 'kind': 'directory', 'mode': mode})
        else:
            require(stat.S_ISREG(st.st_mode) and name in expected, 'UNEXPECTED_LAYER_FILE:' + name)
            e = expected[name]
            require(mode == e['mode'], 'FILE_PERMISSION:' + name + ':' + oct(mode))
            require(sha(p) == e['sha256'], 'LAYER_CONTENT_CHANGED:' + name)
            files.add(name)
            manifest.append({'path': name, 'kind': 'file', **e})
    require(files == set(expected), 'LAYER_FILE_SET_CHANGED')
    return {'version': 1, 'layerSha256': canonical(manifest), 'entries': manifest,
            'files': len(files), 'directories': len(manifest) - len(files)}

def audit_image(info, base, source_commit, wrapper_sha):
    cfg = info['Config']
    require(info['Os'] == 'linux' and info['Architecture'] == 'amd64', 'IMAGE_PLATFORM')
    require(cfg.get('User') in ['cindy', '10001:10001'], 'IMAGE_USER')
    require(cfg.get('Entrypoint') == ENTRYPOINT and cfg.get('Cmd') == CMD, 'IMAGE_START_COMMAND')
    layers = info['RootFS']['Layers']
    require(len(base['RootFS']['Layers']) == 1 and len(layers) == 2
            and layers[0] == base['RootFS']['Layers'][0], 'IMAGE_LAYER_ACCUMULATION')
    labels = cfg.get('Labels', {})
    require(labels.get('io.cindy.source-commit') == source_commit, 'IMAGE_SOURCE_COMMIT')
    require(labels.get('io.cindy.entrypoint-sha256') == wrapper_sha, 'IMAGE_ENTRYPOINT_LABEL')
    return {'imageId': info['Id'], 'layers': len(layers), 'bytes': info['Size']}

def require_startup_proof(info, layer_audit, proof):
    require(proof.get('imageId') == info['Id'], 'STARTUP_PROOF_IMAGE_MISMATCH')
    require(proof.get('layerSha256') == layer_audit['layerSha256'], 'STARTUP_PROOF_LAYER_MISMATCH')
    require(proof.get('uid') == 10001 and proof.get('passed') is True, 'STARTUP_PROOF_FAILED')
    for field in ['isolatedData', 'networkIsolated', 'rootFilesystemReadOnly',
                  'sandboxVerified', 'rendererReady', 'shutdownVerified', 'keyringVerified']:
        require(proof.get(field) is True, 'STARTUP_PROOF_MISSING:' + field)

def require_promotion_base(current, previous, candidate):
    require(current in [previous, candidate], 'FORMAL_TAG_CHANGED')
