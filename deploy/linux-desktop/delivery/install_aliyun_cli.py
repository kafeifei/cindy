#!/usr/bin/env python3
"""Install the pinned Linux CLI into a disposable, unprivileged job directory."""
import argparse
import hashlib
import io
from pathlib import Path
import platform
import subprocess
import tarfile
import urllib.request

VERSION = '3.5.0'
URL = f'https://aliyuncli.alicdn.com/aliyun-cli-linux-{VERSION}-amd64.tgz'
SHA256 = 'f97640bd11002f26e19c4f0b4725a3695e37b43499268837f35dd938cbe043aa'
MAX_BYTES = 128 * 1024 * 1024


def install(data, directory, expected=SHA256):
    if len(data) > MAX_BYTES or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('ALIYUN_CLI_CHECKSUM_MISMATCH')
    # Only read the expected regular file, never extract archive paths or links.
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        members = archive.getmembers()
        if len(members) != 1 or members[0].name not in ('aliyun', './aliyun') or not members[0].isfile():
            raise ValueError('ALIYUN_CLI_INVALID_ARCHIVE')
        if members[0].size > MAX_BYTES:
            raise ValueError('ALIYUN_CLI_TOO_LARGE')
        binary = archive.extractfile(members[0]).read()
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    target = directory / 'aliyun'
    with target.open('xb') as out:
        out.write(binary)
    target.chmod(0o755)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args()
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        parser.error('ALIYUN_CLI_REQUIRES_LINUX_AMD64')
    if not args.directory.is_absolute():
        parser.error('ALIYUN_CLI_REQUIRES_ABSOLUTE_DIRECTORY')
    with urllib.request.urlopen(URL, timeout=60) as response:
        data = response.read(MAX_BYTES + 1)
    target = install(data, args.directory)
    result = subprocess.run([str(target), 'version'], capture_output=True, text=True, timeout=10, check=True)
    if result.stdout.strip() != VERSION:
        raise ValueError('ALIYUN_CLI_VERSION_MISMATCH')
    print(f'ALIYUN_CLI_READY {VERSION}')


if __name__ == '__main__':
    main()
