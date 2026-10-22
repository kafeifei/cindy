#!/bin/sh
set -eu
mkdir -p /ci/socket
chown 1001:1001 /ci/socket
addgroup -g 1001 ci
export DOCKER_TLS_CERTDIR=''
dockerd-entrypoint.sh dockerd --host=unix:///ci/socket/docker.sock --group=ci --data-root=/var/lib/docker --feature=containerd-snapshotter=false --storage-driver=overlay2 --dns="$POD_IP" &
daemon_pid=$!
cleanup() { kill -TERM "$daemon_pid" 2>/dev/null || true; wait "$daemon_pid" || true; }
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
while [ ! -f /ci/runner.done ]; do
 if ! kill -0 "$daemon_pid" 2>/dev/null; then echo DIND_EXITED_BEFORE_RUNNER >&2; exit 1; fi
 sleep 2
done
echo DIND_RUNNER_FINISHED
