# Linux cloud client image

The current development entry is [`zhuoshaojian/cindy`,
`feat/cloud-settings-native-client`](https://github.com/zhuoshaojian/cindy/tree/feat/cloud-settings-native-client).
Its CIS counterpart is [`zhuoshaojian/cindy-server`,
`feat/cloud-settings-readonly`](https://github.com/zhuoshaojian/cindy-server/tree/feat/cloud-settings-readonly).

This directory belongs to the **`cindy` client repository**. It owns the Linux application
package, cloud-only build overlays, runtime entrypoints, desktop, fonts and image
release checks. Ordinary desktop builds do not enable these overlays.

| Material | Purpose |
| --- | --- |
| [runtime-base/README.md](runtime-base/README.md), `runtime-base/Dockerfile`, `runtime-base/packages.lock` | Build the third-party CN dependency base from pinned OS, package and asset inputs; no Cindy application or helpers |
| [BUILD-V0108.md](BUILD-V0108.md), `source-freeze.json` | Historical v0.1.108 application build inputs and limitations |
| `prepare-linux.sh`, `prepare-codex.mjs`, `prepare-other-assets.mjs` | Prepare the isolated Linux builder and verify external assets |
| `stage-cloud-overlays.mjs`, `build-runtime.sh` | Apply the cloud transforms to a disposable source export and package it |
| `runtime-activity/`, `runtime-maintenance/` | Runtime task activity, maintenance gate and clean shutdown evidence |
| `runtime-guidance/`, `runtime-updates/`, `runtime-window-controls/` | Cloud configuration guidance, managed updates and main-window controls |
| `runtime-entrypoint/`, `runtime-desktop-xfce/` | Historical Openbox entrypoint and current Xfce/Plank sources |
| `runtime-fonts/` | Verified emoji font staging and permission checks |
| `release_guard.py` | Offline application payload, permissions, image metadata and startup-evidence gates |
| [IMAGE-PACKAGING.md](IMAGE-PACKAGING.md), `compact-runtime.py` | Source-build requirements and the historical filesystem compaction tool |
| [PROFILE-OBSERVATION.md](PROFILE-OBSERVATION.md), `profile-supervisor.mjs` | Runtime supervision and profile observation contract |

The published R5 digest, ASAR hash, frozen client patch hashes and final desktop
source hashes are recorded in
[`runtime-desktop-xfce/source-manifest.json`](runtime-desktop-xfce/source-manifest.json).
That is historical artifact provenance, not proof that the current branch HEAD
was built or deployed. The native cloud settings UI and the runtime image are
different build outputs of this repository.

`cindy-server` is the server repository; `cloud-instance-server` (CIS) is a
service inside it. A checkout directory name is not a repository or service name.

## Build status and remaining work

The dependency base is now independently buildable with the committed
[base Dockerfile](runtime-base/README.md#build). It installs the pinned third-party
dependencies, Xfce/Plank, Chrome and fonts. Its output deliberately has no Cindy
application, runtime helpers or startup command; it is not a runnable cloud image.

The **complete client source-to-image chain is still incomplete**:

- The archived application scripts require a prepared `/workspace` and Electron
  assets; a committed builder recipe must create those inputs from the frozen
  source, lockfile and verified downloads.
- `cindy-seccomp`, the health probe, profile maintenance/preflight launchers and
  their keyring/CDP helpers still need tracked source and installation rules.
- The final runtime Dockerfile must assemble that application and those helpers
  with the freshly built base, then pass isolated startup and shutdown checks.

`runtime-desktop-xfce/Dockerfile.r5` remains a historical R4-to-R5 repair layer.
It is not that final assembly recipe. Do not use an old application image or a
compacted filesystem export to stand in for these missing inputs. Successful
base builds, offline tests or CIS tests do not qualify a complete cloud image.

The replacement chain must include the complete builder, dependency-base and
runtime Dockerfiles (or named stages in one Dockerfile), with a documented
build-context entry point. Record the base OS digest, client/upstream and recipe
commits, dependency lockfiles, package versions, external asset checksums and
explicit region/platform. Build the application, helpers and runtime filesystem
from these inputs without extracting them from a previous Cindy image or relying
on an operator's prepared workspace. Do not mark this requirement complete until
the exact committed recipe has successfully built and its output has been tested.

Local acceptance delivers a loadable image archive and checksum, image config ID,
complete Dockerfiles/build inputs, build logs and test records. Test with disposable
data and synthetic credentials; record native versus emulated execution and
untested production behavior. The local result is reviewed before registry
publication or changes to cloud instances. A local image ID or archive checksum
is not a registry manifest digest.

## Release pipeline ownership

**The paired cloud image/CIS CI/CD pipeline is not implemented.** Existing
workflows for other client/server features do not provide this release pipeline.
ACS image cache automation is a future client image CI/CD step; it is not
implemented by these scripts or by a workflow in this change. The intended
client release sequence is:

1. Freeze the client source, upstream version, complete Dockerfile chain,
   dependency inputs and target platform; build from source and audit permissions.
2. Qualify the final locally built candidate for normal startup, identity,
   sandbox, keyring, desktop/input and orderly shutdown in isolated Linux.
3. After publication is authorized, publish a unique immutable image digest.
   Enumerate the main image and **every
   actual initContainer image** required by the supported deployment templates.
4. Create their ACS caches in each target Region/cluster network. Verify `Ready`
   and actual cache hits using those exact pinned image references; an older
   init image still requires its own verification. A matching mutable tag alone
   is insufficient.
5. Hand CIS the qualified version and its release evidence only after all
   prerequisites pass. No ready cache means the release is not ready for rollout.

The future pipeline must retain source/digest mappings, the complete image list,
platform, cache identity/Region, readiness and hit evidence, and rollback digest.
This document assigns responsibilities; it does not introduce a new wire schema
or claim that CIS already consumes an automated release manifest.

The `cloud-instance-server` service in `cindy-server` owns instance placement,
admission, task protection, upgrade
orchestration, pre-upgrade backup and failure recovery. It consumes qualified
images. It does not build client images or create their ACS caches. Credentials,
real instance/PVC identities, deployment configuration, backup data and one-off
operator scripts remain outside both source trees.

## Local source checks

From the client repository root (these do not build or publish an image):

```sh
CINDY_TEST_CLIENT_SOURCE="$PWD" CINDY_ACTIVITY_TEST_SOURCE="$PWD" \
  CLOUD_UPDATE_TEST_SOURCE="$PWD" CLOUD_WINDOW_TEST_SOURCE="$PWD" \
  node --test deploy/linux-desktop/runtime-*/*.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s deploy/linux-desktop -p 'test_*.py' -v
PYTHONDONTWRITEBYTECODE=1 python3 deploy/linux-desktop/runtime-fonts/test_stage_emoji_font.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s deploy/linux-desktop/runtime-base -p 'test_*.py' -v
```

The entrypoint shutdown harness needs Bash >= 5.1 and Python 3; its Node test
reports a skip when unavailable. The Dock migration test requires an isolated
Linux image with the packaged desktop dependencies; see its README. Neither
offline source checks nor native X11 tests prove DeviceLink cross-device E2E.
