#!/bin/sh
set -eu
mkdir -p /ci/socket
chown 1001:1001 /ci/socket
addgroup -g 1001 ci
# A manual ECI ImageCache can expand the container root but leave emptyDir on
# the 30 GiB system disk. Check the actual DinD mount, not Pod annotations.
mkdir -p /var/lib/docker
available_kib=$(df -Pk /var/lib/docker | awk 'END {print $4}')
case "$available_kib" in ''|*[!0-9]*) echo DIND_STORAGE_UNVERIFIED >&2; exit 1 ;; esac
if [ "$available_kib" -lt 83886080 ]; then
  echo "DIND_STORAGE_INSUFFICIENT: available_kib=$available_kib required_kib=83886080" >&2
  exit 1
fi
echo "DIND_STORAGE_READY: available_kib=$available_kib"
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
