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
| [SOURCE-BUILD.md](SOURCE-BUILD.md), [0.1.113 instance acceptance](ACCEPTANCE-0113-20261022.md) | Complete source-build entry and the separate tested-instance result |
| [Clipboard and recovery follow-up](ACCEPTANCE-CLIPBOARD-RECOVERY-20261020.md) | R7 source-build and Mac clipboard acceptance, rollout results, and explicit phone-test limits |
| [Candidate delivery](delivery/README.md) | Fork-only self-hosted source build, isolated smoke, candidate publication and ACS cache preparation |
| [Dual-version updates](DUAL-VERSION-UPDATES.md), [cloud.2 acceptance](ACCEPTANCE-CLOUD2-20261021.md) | Implemented CIS selection and owner-requested upgrades, application version display, live acceptance and remaining promotion work |
| [runtime-base/README.md](runtime-base/README.md), `runtime-base/Dockerfile`, `runtime-base/packages.lock` | Build the third-party CN dependency base from pinned OS, package and asset inputs; no Cindy application or helpers |
| `source-freeze.json` | Current frozen application commit, upstream version and runtime patch inputs |
| [BUILD-V0108.md](BUILD-V0108.md) | Historical v0.1.108 application build inputs and limitations |
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

## Complete source build

The [source build entry](SOURCE-BUILD.md) exports the frozen client and recorded
runtime fixes from Git, builds the pinned dependency base, compiles the application
and context/wire bundles, and installs the tracked runtime programs into one
application layer. `Dockerfile.r5` is retained only as a historical repair recipe.

The source build and slim base require fresh isolated acceptance before use. A
successful Docker build is not startup, authorization, input or rollout acceptance.
The source builder does not publish images or operate instances.

Local acceptance delivers a loadable image archive and checksum, image config ID,
complete Dockerfiles/build inputs, build logs and test records. Test with disposable
data and synthetic credentials; record native versus emulated execution and
untested production behavior. Review the local result before an authorized candidate
upload for native Linux qualification; promotion and instance changes require the
completed qualification. A local image ID or archive checksum
is not a registry manifest digest.

## Release pipeline ownership

**Client candidate delivery is implemented and has run on fork-only self-hosted
runners, with automatic per-job provisioning and cleanup; see [the workflow records](delivery/README.md).**
Operator documentation-only pushes do not trigger delivery or provision runners.
Packaged runtime guidance remains a build input; a release still requires a version change.
It produces candidates and cache readiness receipts, not stable release admission.
CIS qualified-version selection and owner-requested upgrades are implemented.
Actual cache hits and one authorized instance upgrade were separately verified in
[cloud.2 acceptance](ACCEPTANCE-CLOUD2-20261021.md); complete product qualification,
stable promotion and automatic cache-hit testing remain separate work. The full release sequence is:

1. Freeze the client source, upstream version, complete Dockerfile chain,
   dependency inputs and target platform; build from source and audit permissions.
2. Qualify the final locally built candidate for normal startup, identity,
   sandbox, keyring, desktop/input and orderly shutdown in isolated Linux.
3. After publication is authorized, publish a unique immutable image digest.
   An upload solely for isolated native qualification may precede step 2; it
   remains an unqualified candidate until that test passes.
   Enumerate the main image and **every
   actual initContainer image** required by the supported deployment templates.
4. Create their ACS caches in each target Region/cluster network. Verify `Ready`
   and actual cache hits using those exact pinned image references; an older
   init image still requires its own verification. A matching mutable tag alone
   is insufficient.
5. Hand CIS the qualified version and its release evidence only after all
   prerequisites pass. No ready cache means the release is not ready for rollout.

The completed delivery chain must retain source/digest mappings, the complete image list,
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
