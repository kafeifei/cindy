#!/bin/bash
# Shutdown-order qualification for cindy-linux-desktop (needs bash >= 5.1, python3).
# Dependencies are stubs that log when they receive TERM; the application logs
# the start and end of its own quit work. The application must finish before
# any dependency is stopped.
set -euo pipefail
wrapper=${1:?usage: shutdown-order.test.sh <path to cindy-linux-desktop>}
work=$(mktemp -d); trap 'rm -rf -- "$work"' EXIT
bin=$work/bin log=$work/order.log; mkdir -p "$bin"; : >"$log"
stub() { printf '#!/bin/bash\ntrap '"'"'echo %s >>"%s"; exit 0'"'"' TERM\n%s\nwhile :; do sleep 0.05; done\n' "$1" "$log" "${2:-}" >"$bin/$1"; chmod +x "$bin/$1"; }
printf '#!/bin/sh\nexit 0\n' >"$bin/unshare"; printf '#!/bin/sh\nexit 0\n' >"$bin/xdpyinfo"; chmod +x "$bin/unshare" "$bin/xdpyinfo"
stub dbus-daemon 'for a in "$@"; do case $a in --address=unix:path=*) python3 -c "import socket,sys;socket.socket(socket.AF_UNIX).bind(sys.argv[1])" "${a#--address=unix:path=}";; esac; done'
stub Xvfb 'echo 99 >&3; exec 3>&-'
stub openbox
cat >"$work/app" <<APP
#!/bin/bash
trap 'echo app-quit-start >>"$log"; sleep 1; echo app-quit-done >>"$log"; exit 0' TERM
echo ready >"$work/ready"
while :; do sleep 0.05; done
APP
chmod +x "$work/app"
env -i PATH="$bin:/usr/bin:/bin" TMPDIR="$work" HOME="$work" bash "$wrapper" "$work/app" &
pid=$!
for _ in $(seq 1 100); do [ -f "$work/ready" ] && break; sleep 0.05; done
[ -f "$work/ready" ] || { echo 'application did not start'; exit 1; }
kill -TERM "$pid"; wait "$pid" || true
expected=$'app-quit-start\napp-quit-done\nopenbox\nXvfb\ndbus-daemon'
actual=$(cat "$log")
if [ "$actual" != "$expected" ]; then printf 'unexpected shutdown order:\n%s\n' "$actual"; exit 1; fi
echo 'shutdown order ok'
