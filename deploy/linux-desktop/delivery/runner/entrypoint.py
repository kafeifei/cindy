"""One repository-scoped JIT job; signal DinD to exit afterward.

The Kubernetes job must use an emptyDir working disk, no service-account token,
and a short active deadline. The controller removes its JIT Secret after startup.
"""
import os
from pathlib import Path
import signal
import subprocess
import sys


def run(env, *, spawn=subprocess.Popen, config_path=Path('/run/cindy-jit/config')):
    child_env = dict(env)
    # The official listener consumes and removes this input before spawning jobs.
    # Keep it out of argv and avoid printing the runner's diagnostic log stream.
    child_env.pop('ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT', None)
    child_env['ACTIONS_RUNNER_INPUT_JITCONFIG'] = config_path.read_text().strip()
    if not child_env['ACTIONS_RUNNER_INPUT_JITCONFIG']:
        raise RuntimeError('JIT_CONFIG_REQUIRED')
    child = spawn(['/home/runner/run.sh'], env=child_env, start_new_session=True)
    child_env.pop('ACTIONS_RUNNER_INPUT_JITCONFIG', None)

    def stop(signum, frame):
        if child.poll() is None:
            os.killpg(child.pid, signum)

    previous = {sig: signal.signal(sig, stop) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        return child.wait()
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    code = 1
    try:
        code = run(os.environ)
    except (OSError, RuntimeError):
        print('FORK_RUNNER_START_FAILED', file=sys.stderr)
    finally:
        Path('/ci/runner.done').write_text(str(code))
    sys.exit(code)
