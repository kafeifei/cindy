"""Assemble one application layer from build outputs and tracked source only."""
import json
import shutil
import sys
from pathlib import Path

recipe = Path(__file__).resolve().parent
artifact, layer = map(Path, sys.argv[1:])
layer.mkdir(exist_ok=False)
shutil.copytree(artifact / 'cindy', layer / 'opt/cindy')

def install(source, destination, mode=0o644):
    out = layer / destination
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, out)
    out.chmod(mode)

for name, target in {
    'seccomp-launch.py': 'cindy-seccomp',
    'healthcheck.mjs': 'cindy-cloud-healthcheck.mjs',
    'profile-helper-entrypoint.sh': 'cindy-profile-maintenance',
    'profile-preflight-entrypoint.sh': 'cindy-profile-preflight',
}.items():
    install(recipe / 'runtime-support' / name, 'usr/local/bin/' + target, 0o755)
for name in ['keyring-check.mjs', 'profile-entry-check.mjs', 'profile-helper.mjs',
             'profile-preflight.mjs', 'cdp-pipe.mjs']:
    install(recipe / 'runtime-support' / name, 'usr/local/lib/cindy/' + name, 0o755)
for name in ['profile-maintenance-context.mjs', 'profile-runtime-wire.mjs']:
    install(artifact / name, 'usr/local/lib/cindy/' + name)
install(recipe / 'profile-supervisor.mjs', 'usr/local/lib/cindy/profile-supervisor.mjs')
install(recipe / 'github-device-login.py', 'usr/local/lib/cindy/github-device-login.py', 0o755)
desktop = recipe / 'runtime-desktop-xfce'
for name in ['cindy-linux-desktop', 'cindy-dock-terminal', 'cindy-dock-chrome']:
    install(desktop / name, 'usr/local/bin/' + name, 0o755)
install(desktop / 'xfce-session', 'usr/local/lib/cindy/xfce-session', 0o755)
install(desktop / 'seccomp.json', 'usr/local/lib/cindy/seccomp.json')
for name in ['apply-appearance.py', 'apply-dock.py', 'apply-dock-apps.py']:
    install(desktop / name, 'usr/local/share/cindy/appearance/' + name)
for name in ['com.cindy.cloud-terminal.desktop', 'com.cindy.cloud-chrome.desktop']:
    install(desktop / name, 'usr/share/applications/' + name)
install(recipe / 'runtime-support/chromium-compat', 'usr/bin/chromium', 0o755)
(layer / 'usr/local/lib/cindy/profile-image.json').write_text('{"version":1,"realm":"cn"}\n')
for name, target in {'claude': '/opt/cindy/resources/cloud-runtimes/claude/claude',
                     'codex': '/opt/cindy/resources/cloud-runtimes/codex/bin/codex'}.items():
    if not (layer / target.lstrip('/')).is_file(): raise RuntimeError('MISSING_AGENT:' + name)
    (layer / 'usr/local/bin' / name).symlink_to(target)
(layer / 'run/cindy-profile-check/identity').mkdir(parents=True)
# Never inherit a build account's restrictive umask or setuid bits.
for file in layer.rglob('*'):
    if file.is_symlink(): continue
    file.chmod(0o755 if file.is_dir() or file.stat().st_mode & 0o111 else 0o644)
layer.chmod(0o755)
