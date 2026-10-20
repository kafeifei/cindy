#!/bin/bash
set -euo pipefail
[ "$#" = 0 ] || exit 1
exec /usr/local/bin/cindy-seccomp /usr/local/lib/cindy/profile-preflight.mjs
