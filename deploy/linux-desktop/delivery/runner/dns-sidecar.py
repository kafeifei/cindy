"""Optional, Pod-local DNS forwarding; no cluster DNS changes or TLS interception."""
import ipaddress
import os
from pathlib import Path
import re
import signal
import subprocess
import time


def command(env):
    # An operator-provided SNI forwarding endpoint, not a public CDN IP.
    target = str(ipaddress.IPv4Address(env['GITHUB_SNI_FORWARD_IP']))
    upstreams = [str(ipaddress.IPv4Address(v.strip())) for v in env['DNS_UPSTREAMS'].split(',')]
    if not upstreams or '127.0.0.1' in upstreams:
        raise ValueError('DNS_UPSTREAM_LOOP')
    names = env.get('SNI_FORWARD_DOMAINS', 'github.com,githubusercontent.com,ghcr.io').split(',')
    if any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+', n) for n in names):
        raise ValueError('INVALID_FORWARD_DOMAIN')
    domains = '/' + '/'.join(names) + '/'
    # Only build Pods need a listener reachable from their nested containers.
    # POD_IP must come from the Downward API, never a host IP or wildcard bind.
    listen = '127.0.0.1'
    if env.get('POD_IP'):
        pod_ip = ipaddress.IPv4Address(env['POD_IP'])
        if pod_ip.is_unspecified or pod_ip.is_loopback or pod_ip.is_multicast:
            raise ValueError('INVALID_POD_IP')
        listen += ',' + str(pod_ip)
    return ['/usr/sbin/dnsmasq', '--keep-in-foreground', '--conf-file=',
            '--no-resolv', '--no-hosts', '--bind-interfaces', '--listen-address=' + listen,
            '--user=root', '--group=root', '--pid-file=', '--cache-size=256',
            '--log-facility=-', '--local-ttl=30', f'--address={domains}{target}', f'--local={domains}',
            *[f'--server={v}' for v in upstreams]]


def main():
    child = subprocess.Popen(command(os.environ))
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while not stopping and not Path('/ci/runner.done').exists():
            code = child.poll()
            if code is not None:
                return code or 1
            time.sleep(1)
        return 0
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == '__main__':
    raise SystemExit(main())
