#!/bin/sh
set -eu
exec /usr/local/bin/cindy-seccomp /usr/local/lib/cindy/profile-helper.mjs "$@"
