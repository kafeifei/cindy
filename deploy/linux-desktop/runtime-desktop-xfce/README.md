# Xfce / Plank cloud desktop sources

These desktop sources are assembled by the [complete source build](../SOURCE-BUILD.md),
based on Cindy upstream `v0.1.108`.
`source-manifest.json` retains historical R5 comparison metadata: image digest,
ASAR hash, frozen client patch hashes, package versions and source hashes. Current
source-build acceptance is linked from `SOURCE-BUILD.md`. Registry credentials, deployment
addresses, instance identities, profiles, backups and operator programs are not
part of this source archive.

## Runtime composition

- `cindy-linux-desktop` is the Xfce-specific PID 1 wrapper. It waits for desktop
  readiness before Cindy and stops Cindy before the display, keyring and bus.
  The sibling `runtime-entrypoint/` retains the Openbox wrapper for old builds.
- `xfce-session` starts xfsettingsd, xfwm4, xfdesktop and Plank. It publishes final
  DISPLAY to D-Bus activation and waits for the WM/Dock strut. Dock restart recovery
  is bounded; failure of a critical desktop process stops the session.
- `apply-appearance.py` selects packaged Arc and Papirus. `apply-dock.py` selects
  packaged Plank Matte and Xfce wallpaper, with desktop icons disabled. These are
  one-time migrations; they preserve unrelated configuration.
- `apply-dock-apps.py` seeds Terminal and Chrome pins. New pins use system desktop
  files, never `~/.local/share/applications`: old homes can have root-owned
  `.local/share` mode 2755. No chmod/chown of that directory is needed. Existing
  pins are backed up, custom pins retained, and reruns are idempotent. Fresh users
  receive 40px/no zoom; existing v2 users keep subsequent size/zoom preferences.
- The Chrome launcher uses a separate personal browser profile and retains its
  sandbox and Secret Service password store. Terminal explicitly starts bash,
  because the container account has a noninteractive passwd shell.
- `seccomp.json` is the verified runtime allowlist including `close_range`, needed
  by GLib process spawning. Do not replace the profile with Unconfined.
- `../runtime-window-controls/` is the cloud-only source transform used to build
  the ASAR: native minimization stays available, main-window closing is blocked,
  and orderly shutdown remains allowed. Plank's stock close menu can still be
  visible; Cindy intercepts its request. Auxiliary and authorization windows keep
  their normal close behavior.

The image has Xfce 4.18 components, Plank, xfce4-terminal, Chrome, packaged Arc and
Papirus resources, X11 tools, D-Bus and the existing managed-keyring runtime.
Theme resources are third-party packages, not vendored binaries here. The native
client source and its cloud packaging overlays are separate inputs: this archive
is not a claim that the whole native-client branch was bundled into the ASAR.

## Existing user launchers

When validating an upgraded desktop, inspect `~/.local/share/applications` for the
managed `cindy-dock-terminal.desktop` and `cindy-dock-chrome.desktop` entries.
They can take precedence over the new system launcher and cause duplicate Dock
icons. With the user's test Terminal/Chrome windows closed, run
`retire-legacy-dock-entries.py` as the desktop user, then restart the Dock and
verify launch/minimize/restore. The tool archives only files whose entire content
matches the corresponding system launcher. Custom entries and symlinks remain
unchanged; absent legacy directories are not created and no ownership is changed.
Backups are under `~/.config/cindy-desktop/legacy-user-desktop-entries/`.

This is an explicit data migration tool, not an automatic login hook. A successful
image build alone does not prove an existing user's Dock matching is correct.
Run its filesystem regression with `python3 test_retire_legacy_dock_entries.py`.

## Historical R5 repair layer

`Dockerfile.r5` is retained for artifact provenance, not as the next release build
entry point. It is the published R4 → R5 recipe with only its local FROM reference
replaced by a required build argument. Supply the R4 image by immutable digest
from the manifest, not a mutable latest tag:

```sh
docker build --platform linux/amd64 -f Dockerfile.r5   --build-arg BASE_RUNTIME_IMAGE="${R4_IMAGE_BY_DIGEST}"   -t cloud-runtime:0.1.108-xfce-dock-r5.20261019 .
```

This is a repair-layer recipe, not a clean Debian-to-runtime build. The R4 base
already contains the application ASAR, Xfce, themes, browser, fonts, launch
supervisor and seccomp runner. The other final scripts here document those base
inputs and must be included when rebuilding that base. Rebuilding can produce a
new image digest; use fresh publication checks and cache validation rather than
assuming equivalence from the tag. No application binary, Debian package or
production configuration is committed.

For the next release, include these desktop files in a complete source-build
Dockerfile chain as required by [the client image entry point](../README.md).
Installing the packages, compiling the application/helpers and preparing the
runtime base must be defined without an existing R4/R5 image. Local isolated
acceptance of that rebuilt image is a new result; the historical checks below
cannot be reused as its acceptance record.

## Checks

The migration test runs in an isolated Linux container containing the required
packages. It uses temporary homes and the keyfile GSettings backend; it does not
mount a user home, PVC, credentials, or network. As root it runs the migration as
UID/GID 10001 against root-owned legacy `.local/share` and verifies metadata and
custom settings stay intact:

```sh
docker run --rm --platform linux/amd64 --network none --read-only --user 0 --tmpfs /tmp   --entrypoint python3 -v "$PWD:/source:ro" "$QUALIFIED_DESKTOP_IMAGE"   /source/test-dock-migration.py
```

The 2026-10-19 isolated Linux acceptance covered startup, legacy-home permissions,
real Terminal/Chrome launch, minimization/restore, Dock restart, fullscreen
avoidance, Cindy close protection, migration idempotency and orderly shutdown.
These were native X11 tests, not DeviceLink cross-device E2E. R5 had not been rolled
out fleet-wide when this source snapshot was committed. Publication is separate
from deployment; main and actual init images still require ready ACS caches and
verified cache hits, backups and per-instance task protection before promotion.
