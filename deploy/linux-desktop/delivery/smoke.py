#!/usr/bin/env python3
"""Disposable native-amd64 desktop smoke; not OAuth or DeviceLink acceptance."""
import argparse
import json
import platform
import subprocess
import sys
import time
import uuid
from pathlib import Path

# Bootstrap owns only tmpfs fixtures. The actual runtime drops every capability
# and installs its shipped seccomp filter before starting the shipped entrypoint.
BOOTSTRAP = r'''
import os,pathlib,secrets
# Match the fixture group before chmod: without FSETID, Linux otherwise clears
# the setgid bit for a group the bootstrap process does not belong to.
os.setgid(10001)
h=pathlib.Path('/home/cindy')
for n in ['.local','.local/share']:
 p=h/n;p.mkdir();os.chown(p,0,10001);p.chmod(0o2755)
for n in ['.local/share/keyrings','.config']:
 p=h/n;p.mkdir();os.chown(p,10001,10001);p.chmod(0o2700)
p=pathlib.Path('/run/secrets/credential-store-key');p.write_text(secrets.token_urlsafe(32)+'\n');p.chmod(0o440);os.chown(p,10001,10001)
# Complete the root-owned fixture before handing HOME to the runtime. Bootstrap
# deliberately lacks DAC_OVERRIDE and cannot traverse a UID 10001 mode-2700 HOME.
os.chown(h,10001,10001);h.chmod(0o2700)
os.execv('/usr/bin/setpriv',['setpriv','--reuid=10001','--regid=10001','--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/usr/local/bin/cindy-seccomp','/usr/local/bin/cindy-linux-desktop','/bin/sh','-c','exec /opt/cindy/Cindy --password-store=gnome-libsecret --disable-dev-shm-usage --cindy-cloud-main-window'])
'''
CHECK = r'''
import pathlib,subprocess,os,stat,json,struct
def is_cindy_renderer(cmdline):
 args=[a for a in cmdline.split(b'\x00') if a]
 # Chromium may rewrite argv into one space-separated process title. Match its
 # executable and a whole flag, never the Python probe's embedded source text.
 if len(args)==1:args=args[0].split()
 return bool(args) and args[0]==b'/opt/cindy/Cindy' and b'--type=renderer' in args
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
  if is_cindy_renderer(cmd):
   fields=dict(l.split(':',1) for l in (p/'status').read_text().splitlines() if ':' in l)
   assert fields['Uid'].split()[0]=='10001' and int(fields['CapEff'],16)==0
   assert fields['NoNewPrivs'].strip()=='1' and fields['Seccomp'].strip()=='2'
   renderers.append(p.name)
 except (FileNotFoundError,ProcessLookupError):pass
assert renderers
for n in ['com.cindy.cloud-terminal.desktop','com.cindy.cloud-chrome.desktop']:
 assert (pathlib.Path('/usr/share/applications')/n).is_file()
with open('/opt/cindy/resources/app.asar','rb') as archive:
 prefix=archive.read(16)
 header_size=struct.unpack_from('<I',prefix,4)[0];json_size=struct.unpack_from('<I',prefix,12)[0]
 assert 0<json_size<=header_size<64*1024*1024
 header=json.loads(archive.read(json_size));package=header['files']['package.json']
 assert not package.get('unpacked') and 0<package['size']<1024*1024
 archive.seek(8+header_size+int(package['offset']))
 version=json.loads(archive.read(package['size']))['version']
print(json.dumps({'desktopReady':True,'sandboxedRenderers':True,'legacyHome':True,'applicationVersion':version}))
'''


def command(*args, **kwargs):
    return subprocess.run(['docker', *args], text=True, capture_output=True, timeout=90, **kwargs)


def smoke(image, output):
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise ValueError('NATIVE_LINUX_AMD64_REQUIRED')
    daemon = json.loads(command('info', '--format', '{{json .}}', check=True).stdout)
    if daemon['Architecture'] not in ['x86_64', 'amd64'] or daemon['OSType'] != 'linux':
        raise ValueError('NATIVE_DOCKER_DAEMON_REQUIRED')
    image_info = json.loads(command('image', 'inspect', image, check=True).stdout)[0]
    image_id = image_info['Id']
    expected_version = image_info['Config']['Labels']['org.opencontainers.image.version']
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
                report['exitCode'] = state['State']['ExitCode']
                report['oomKilled'] = state['State']['OOMKilled']
                raise ValueError('SMOKE_RUNTIME_EXITED')
            check = command('exec', '--user=10001:10001', name, 'python3', '-c', CHECK)
            if check.returncode == 0:
                report.update(json.loads(check.stdout)); break
            if time.monotonic() >= deadline:
                report['lastCheckError'] = check.stderr[-2000:]
                raise ValueError('SMOKE_DESKTOP_TIMEOUT')
            time.sleep(2)
        if report.get('applicationVersion') != expected_version:
            raise ValueError('APPLICATION_VERSION_MISMATCH')
        report.update(networkIsolated=state['HostConfig']['NetworkMode'] == 'none',
                      readOnlyRoot=state['HostConfig']['ReadonlyRootfs'] is True)
        command('stop', '--time=60', name, check=True)
        state = json.loads(command('inspect', name, check=True).stdout)[0]['State']
        if state['ExitCode'] != 0 or state['OOMKilled']:
            raise ValueError('SMOKE_SHUTDOWN_FAILED')
        report.update(shutdown=True, passed=True)
    except Exception as exc:
        report['error'] = str(exc)
        # This container has only synthetic tmpfs fixtures and no network or user
        # account. Preserve its startup failure before the mandatory cleanup.
        try:
            logs = command('logs', '--tail=40', name)
            print(logs.stdout + logs.stderr, file=sys.stderr)
        except Exception:
            pass  # Keep the original qualification error.
        raise
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
