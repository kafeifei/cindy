# Linux cloud client image

This directory belongs to the **Cindy client**. It owns the Linux application
package, cloud-only build overlays, runtime entrypoints, desktop, fonts and image
release checks. Ordinary desktop builds do not enable these overlays.

| Material | Purpose |
| --- | --- |
| [BUILD-V0108.md](BUILD-V0108.md), `source-freeze.json` | Historical v0.1.108 application build inputs and limitations |
| `prepare-linux.sh`, `prepare-codex.mjs`, `prepare-other-assets.mjs` | Prepare the isolated Linux builder and verify external assets |
| `stage-cloud-overlays.mjs`, `build-runtime.sh` | Apply the cloud transforms to a disposable source export and package it |
| `runtime-activity/`, `runtime-maintenance/` | Runtime task activity, maintenance gate and clean shutdown evidence |
| `runtime-guidance/`, `runtime-updates/`, `runtime-window-controls/` | Cloud configuration guidance, managed updates and main-window controls |
| `runtime-entrypoint/`, `runtime-desktop-xfce/` | Historical Openbox entrypoint and current Xfce/Plank sources |
| `runtime-fonts/` | Verified emoji font staging and permission checks |
| `release_guard.py` | Offline application payload, permissions, image metadata and startup-evidence gates |
| [IMAGE-PACKAGING.md](IMAGE-PACKAGING.md), `compact-runtime.py` | Final two-layer packaging and filesystem equivalence checks |
| [PROFILE-OBSERVATION.md](PROFILE-OBSERVATION.md), `profile-supervisor.mjs` | Runtime supervision and profile observation contract |

The published R5 digest, ASAR hash, frozen client patch hashes and final desktop
source hashes are recorded in
[`runtime-desktop-xfce/source-manifest.json`](runtime-desktop-xfce/source-manifest.json).
That is historical artifact provenance, not proof that the current branch HEAD
was built or deployed. The native cloud settings UI and the runtime image are
different build outputs of this repository.

## Release pipeline ownership

**ACS image cache automation is a future client image CI/CD step. It is not
implemented by these scripts or by a workflow in this change.** The intended
client release sequence is:

1. Freeze the client source, upstream version, dependency inputs and target
   platform; build and audit the application and image permissions.
2. Produce the compact two-layer candidate and qualify normal startup, identity,
   sandbox, keyring, desktop/input and orderly shutdown in isolated Linux.
3. Publish a unique immutable image digest. Enumerate the main image and **every
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

`cindy-server` owns instance placement, admission, task protection, upgrade
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
```

The entrypoint shutdown harness needs Bash >= 5.1 and Python 3; its Node test
reports a skip when unavailable. The Dock migration test requires an isolated
Linux image with the packaged desktop dependencies; see its README. Neither
offline source checks nor native X11 tests prove DeviceLink cross-device E2E.
