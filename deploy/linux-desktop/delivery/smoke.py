#!/usr/bin/env python3
"""Disposable native-amd64 desktop smoke; not OAuth or DeviceLink acceptance."""
import argparse
import json
import platform
import subprocess
import time
import uuid
from pathlib import Path

# Bootstrap owns only tmpfs fixtures. The actual runtime drops every capability
# and installs its shipped seccomp filter before starting the shipped entrypoint.
BOOTSTRAP = r'''
import os,pathlib,secrets
h=pathlib.Path('/home/cindy');os.chown(h,10001,10001);h.chmod(0o2700)
for n in ['.local','.local/share']:
 p=h/n;p.mkdir();os.chown(p,0,10001);p.chmod(0o2755)
for n in ['.local/share/keyrings','.config']:
 p=h/n;p.mkdir();os.chown(p,10001,10001);p.chmod(0o2700)
p=pathlib.Path('/run/secrets/credential-store-key');p.write_text(secrets.token_urlsafe(32)+'\n');p.chmod(0o440);os.chown(p,10001,10001)
os.execv('/usr/bin/setpriv',['setpriv','--reuid=10001','--regid=10001','--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/usr/local/bin/cindy-seccomp','/usr/local/bin/cindy-linux-desktop','/bin/sh','-c','exec /opt/cindy/Cindy --password-store=gnome-libsecret --disable-dev-shm-usage --cindy-cloud-main-window'])
'''
CHECK = r'''
import pathlib,subprocess,os,stat,json
p=pathlib.Path('/home/cindy/.local/share')
assert (p.stat().st_uid,p.stat().st_gid,stat.S_IMODE(p.stat().st_mode))==(0,10001,0o2755)
assert not os.access(p,os.W_OK)
r=next(p for p in pathlib.Path('/tmp').glob('cindy-runtime-*') if (p/'desktop-ready').is_file())
os.environ['DISPLAY']=':'+ (r/'display-number').read_text().strip()
os.environ['DBUS_SESSION_BUS_ADDRESS']='unix:path='+str(r/'bus')
for name in ['xfwm4','xfdesktop','plank']:
 subprocess.run(['pgrep','-x',name],stdout=subprocess.DEVNULL,check=True)
assert b'window id' in subprocess.check_output(['xprop','-root','_NET_SUPPORTING_WM_CHECK'])
subprocess.run(['xdotool','search','--onlyvisible','--class','Cindy'],stdout=subprocess.DEVNULL,check=True)
renderers=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  cmd=(p/'cmdline').read_bytes()
  if b'--type=renderer' in cmd and b'/opt/cindy/' in cmd:
   fields=dict(l.split(':',1) for l in (p/'status').read_text().splitlines() if ':' in l)
   assert fields['Uid'].split()[0]=='10001' and int(fields['CapEff'],16)==0
   assert fields['NoNewPrivs'].strip()=='1' and fields['Seccomp'].strip()=='2'
   renderers.append(p.name)
 except (FileNotFoundError,ProcessLookupError):pass
assert renderers
for n in ['com.cindy.cloud-terminal.desktop','com.cindy.cloud-chrome.desktop']:
 assert (pathlib.Path('/usr/share/applications')/n).is_file()
print(json.dumps({'desktopReady':True,'sandboxedRenderers':True,'legacyHome':True}))
'''


def command(*args, **kwargs):
    return subprocess.run(['docker', *args], text=True, capture_output=True, timeout=90, **kwargs)


def smoke(image, output):
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise ValueError('NATIVE_LINUX_AMD64_REQUIRED')
    daemon = json.loads(command('info', '--format', '{{json .}}', check=True).stdout)
    if daemon['Architecture'] not in ['x86_64', 'amd64'] or daemon['OSType'] != 'linux':
        raise ValueError('NATIVE_DOCKER_DAEMON_REQUIRED')
    image_id = json.loads(command('image', 'inspect', image, check=True).stdout)[0]['Id']
    name = 'cindy-delivery-smoke-' + uuid.uuid4().hex[:12]
    report = {'schemaVersion': 1, 'imageId': image_id, 'nativeArchitecture': 'x86_64', 'passed': False}
    try:
        command('run', '-d', '--name', name, '--network=none', '--read-only', '--pids-limit=1024',
                '--memory=4g', '--cpus=2', '--shm-size=512m', '--user=0:0', '--cap-drop=ALL',
                '--cap-add=CHOWN', '--cap-add=FOWNER', '--cap-add=SETUID', '--cap-add=SETGID', '--cap-add=SETPCAP',
                '--security-opt=no-new-privileges', '--security-opt=seccomp=unconfined', '--security-opt=apparmor=unconfined',
                '--tmpfs=/tmp:rw,nosuid,nodev,mode=1777,size=512m',
                '--tmpfs=/home/cindy:rw,nosuid,nodev,size=512m',
                '--tmpfs=/run/secrets:rw,noexec,nosuid,nodev,size=1m',
                '--tmpfs=/var/lib/cindy:rw,nosuid,nodev,uid=10001,gid=10001,size=512m',
                '-e', 'XDT_USER_DATA_DIR=/var/lib/cindy/user-data',
                '-e', 'CINDY_POD_KEYRING_PASSWORD_FILE=/run/secrets/credential-store-key',
                '--entrypoint=python3', image_id, '-c', BOOTSTRAP, check=True)
        deadline = time.monotonic() + 150
        while True:
            state = json.loads(command('inspect', name, check=True).stdout)[0]
            if not state['State']['Running']:
                raise ValueError('SMOKE_RUNTIME_EXITED')
            check = command('exec', '--user=10001:10001', name, 'python3', '-c', CHECK)
            if check.returncode == 0:
                report.update(json.loads(check.stdout)); break
            if time.monotonic() >= deadline:
                raise ValueError('SMOKE_DESKTOP_TIMEOUT')
            time.sleep(2)
        report.update(networkIsolated=state['HostConfig']['NetworkMode'] == 'none',
                      readOnlyRoot=state['HostConfig']['ReadonlyRootfs'] is True)
        command('stop', '--time=60', name, check=True)
        state = json.loads(command('inspect', name, check=True).stdout)[0]['State']
        if state['ExitCode'] != 0 or state['OOMKilled']:
            raise ValueError('SMOKE_SHUTDOWN_FAILED')
        report.update(shutdown=True, passed=True)
    finally:
        output.write_text(json.dumps(report, indent=2) + '\n')
        command('rm', '-f', name)
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--image', required=True)
    p.add_argument('--output', required=True, type=Path)
    args = p.parse_args()
    smoke(args.image, args.output)
