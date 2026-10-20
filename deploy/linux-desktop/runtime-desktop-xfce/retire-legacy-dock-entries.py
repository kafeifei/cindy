"""Archive exact legacy managed launchers before a manual cloud desktop upgrade.

Run as the desktop user with its test Terminal/Chrome windows closed. This is an
explicit migration tool, not a login hook; it does not change directory ownership,
custom launchers, Dock preferences, browser profiles or application processes.
"""
import hashlib
import json
import pathlib


def retire(home, applications=pathlib.Path('/usr/share/applications')):
    result = {'archived': [], 'preserved': []}
    for name in ('terminal', 'chrome'):
        source = home / '.local/share/applications' / f'cindy-dock-{name}.desktop'
        if source.is_symlink():
            result['preserved'].append(source.name)
            continue
        if not source.exists():
            continue
        expected = applications / f'com.cindy.cloud-{name}.desktop'
        content = source.read_bytes()
        if content != expected.read_bytes():
            result['preserved'].append(source.name)
            continue
        digest = hashlib.sha256(content).hexdigest()
        backup = home / '.config/cindy-desktop/legacy-user-desktop-entries'
        backup.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = backup / f'{source.name}.{digest}.bak'
        if target.exists() or target.is_symlink():
            raise RuntimeError('Legacy launcher backup already exists: ' + source.name)
        # Both paths are in the same persistent HOME. Rename retains file metadata
        # and removes the obsolete entry from the application matcher's search path.
        source.rename(target)
        result['archived'].append({'name': source.name, 'sha256': digest})
    return result


if __name__ == '__main__':
    print(json.dumps(retire(pathlib.Path.home())))
