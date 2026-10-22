#!/usr/bin/env bash
# The digest-pinned Actions runner already ships Node/npm for its own actions.
# Reuse that toolchain for checks/cache only; runtime Node stays Dockerfile-locked.
set -euo pipefail
node_bin="$(cd "${RUNNER_TEMP:?}/../../externals/node24/bin" && pwd)"
"$node_bin/node" -e 'if (process.versions.node.split(".")[0] !== "24") process.exit(1)'
test -f "$node_bin/../lib/node_modules/npm/bin/npm-cli.js"
printf '%s\n' "$node_bin" >> "${GITHUB_PATH:?}"
"$node_bin/node" --version
"$node_bin/node" "$node_bin/../lib/node_modules/npm/bin/npm-cli.js" --version
