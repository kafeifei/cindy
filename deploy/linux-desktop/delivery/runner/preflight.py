import json,os,pathlib,subprocess,time
try:
 for _ in range(120):
  p=subprocess.run(['docker','info','--format','{{json .}}'],capture_output=True,text=True)
  if p.returncode==0:break
  time.sleep(2)
 else:raise RuntimeError('DIND_NOT_READY')
 info=json.loads(p.stdout);assert info['Driver']=='overlay2' and info['Architecture']=='x86_64'
 print('DIND_RUNNER_PREFLIGHT_OK',flush=True)
 os.execv('/usr/bin/python3',['python3','/opt/cindy-runner-entrypoint.py'])
except Exception:
 pathlib.Path('/ci/runner.done').write_text('preflight-failed')
 raise
