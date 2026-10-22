"""Log in using a Registry password or an AK-exchanged short-lived ACR token.

Credential values and CLI error bodies are never printed. The caller must give
Docker a job-private DOCKER_CONFIG outside the checkout and clean it afterward.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from versioning import validate_push_repository


class LoginError(RuntimeError):
    pass


def checked_run(command, *, execute, env, input=None):
    try:
        result = execute(command, input=input, env=env, capture_output=True,
                         text=True, timeout=60, check=False)
    except (OSError, subprocess.SubprocessError):
        raise LoginError('REGISTRY_LOGIN_COMMAND_FAILED') from None
    if result.returncode:
        # Neither response bodies nor stderr are safe: they may contain tokens.
        raise LoginError('REGISTRY_LOGIN_COMMAND_FAILED')
    return result.stdout


def login(env, *, execute=subprocess.run, now=time.time):
    mode = env.get('REGISTRY_AUTH', 'password')
    repository = env.get('IMAGE_REPOSITORY', '')
    host, slash, path = repository.partition('/')
    if not slash or not path or not re.fullmatch(r'[a-z0-9][a-z0-9.-]*', host):
        raise LoginError('INVALID_REGISTRY_HOST')
    try:
        transport = validate_push_repository(repository, env.get('IMAGE_PUSH_REPOSITORY'))
    except ValueError as error:
        raise LoginError(str(error)) from None
    hosts = list(dict.fromkeys([host, transport.split('/', 1)[0]]))
    config = env.get('DOCKER_CONFIG', '')
    if not config or not Path(config).is_absolute():
        raise LoginError('JOB_PRIVATE_DOCKER_CONFIG_REQUIRED')
    # Do not pass Alibaba keys or the original Registry password into Docker.
    clean_env = {k: v for k, v in env.items()
                 if not k.startswith('ALIBABA_CLOUD_')
                 and k not in ('REGISTRY_PASSWORD', 'REGISTRY_USER')}
    if mode == 'acr-ak':
        instance = env.get('ACR_INSTANCE_ID', '')
        if not host.endswith('.cn-shanghai.cr.aliyuncs.com') or not re.fullmatch(r'cri-[a-z0-9]+', instance):
            raise LoginError('INVALID_ACR_TARGET')
        keys = {k: env.get(k, '') for k in ('ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET')}
        if not all(keys.values()):
            raise LoginError('ACR_AK_REQUIRED')
        # CLI 3.5 validates its profile before AK environment loading. Give it
        # a job-private vendor-format profile, deleted immediately after the
        # exchange; never read or change the machine's ~/.aliyun profile.
        with tempfile.TemporaryDirectory(prefix='cindy-acr-', dir=env.get('RUNNER_TEMP') or None) as folder:
            profile = Path(folder) / 'config.json'
            with profile.open('x') as file:
                profile.chmod(0o600)
                json.dump({'current': 'default', 'profiles': [{
                    'name': 'default', 'mode': 'AK', 'region_id': 'cn-shanghai',
                    'access_key_id': keys['ALIBABA_CLOUD_ACCESS_KEY_ID'],
                    'access_key_secret': keys['ALIBABA_CLOUD_ACCESS_KEY_SECRET'],
                }]}, file)
            output = checked_run(['aliyun', 'cr', 'GetAuthorizationToken', '--InstanceId', instance,
                                  '--ExpiresInHours', '1', '--region', 'cn-shanghai',
                                  '--config-path', str(profile), '--profile', 'default'],
                                 execute=execute, env=clean_env)
        try:
            data = json.loads(output)
            expiry = data.get('ExpireTime')
            valid = (data.get('IsSuccess') is True and data.get('Code') == 'success'
                     and type(expiry) is int and expiry > (now() + 60) * 1000)
            username, password = data.get('TempUsername'), data.get('AuthorizationToken')
        except (ValueError, AttributeError, TypeError):
            raise LoginError('INVALID_ACR_TOKEN_RESPONSE') from None
        if not valid:
            raise LoginError('INVALID_ACR_TOKEN_RESPONSE')
    elif mode == 'password':
        username, password = env.get('REGISTRY_USER'), env.get('REGISTRY_PASSWORD')
    else:
        raise LoginError('INVALID_REGISTRY_AUTH_MODE')
    if not isinstance(username, str) or not username or username.startswith('-') or '\n' in username:
        raise LoginError('REGISTRY_CREDENTIALS_REQUIRED')
    if not isinstance(password, str) or not password:
        raise LoginError('REGISTRY_CREDENTIALS_REQUIRED')
    for target in hosts:
        checked_run(['docker', 'login', target, '--username', username, '--password-stdin'],
                    execute=execute, env=clean_env, input=password)


def main():
    try:
        login(os.environ)
    except LoginError as error:
        print(str(error), file=sys.stderr)
        return 1
    print('REGISTRY_LOGIN_OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
