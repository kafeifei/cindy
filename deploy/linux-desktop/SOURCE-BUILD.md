# Complete CN source build

The source target is selected by [`delivery/version.json`](delivery/version.json)
and [`source-freeze.json`](source-freeze.json), not by a version copied into this guide.
The current upstream is v0.1.113; the build uses the complete merged client commit,
not whole-file overlays from v0.1.108. See [candidate delivery](delivery/README.md)
for the latest built image and [0.1.113 instance acceptance](ACCEPTANCE-0113-20261022.md)
for the separate tested-instance result. A newer candidate does not mean an instance
was upgraded. Earlier acceptance records qualify only their exact artifacts.

Use the `feat/cloud-settings-native-client` branch of `zhuoshaojian/cindy`.
Required host tools: Git with full branch history, Python >= 3.12, and Docker
Buildx. The build targets Linux amd64; it can run on native amd64 or under Docker's
amd64 emulation on Apple Silicon. Record which environment produced the image.
An emulated build still requires acceptance of that exact image on native Linux
amd64 before promotion; successful compilation alone does not prove runtime health.

From the repository root, with a committed, clean `deploy/linux-desktop/`:

```sh
python3 deploy/linux-desktop/build-image.py \
  --tag cindy-runtime-cn:0.1.113-source-candidate-unique \
  --output /absolute/private/cache/cindy-source-build-unique
```

Use a new tag and output directory. `--no-cache` forces both Dockerfiles to run
again; `--prepare-only` exports the exact source context without starting Docker.
The script never publishes runtime images, creates ACS caches or updates instances.
Pass `--builder NAME` to use an existing native amd64 Buildx builder from a Mac
or another host. The exporter joins the two committed recipes into one
`Dockerfile.combined` stage graph (base, prepared application, runtime, records); it does not fetch a historical Cindy image or publish an
intermediate base. The resulting images and records are returned to the host.
With a protected, job-private Registry login, `--cache-repository REGISTRY/REPO`
exports/imports intermediate BuildKit layers between disposable builders. It
requires `--builder` and a separate private repository with mutable cache tags;
never use the immutable runtime release repository. See [build cache](delivery/README.md#构建缓存).
Network access is needed for pinned OS packages, npm dependencies and verified
Electron/agent assets. No user HOME, credentials, business data or Docker socket
is mounted into build stages. Retain full commit history; `blob:none` partial clones
are supported and fetch the frozen source bytes on demand. Frozen commits must be present.

## Inputs and outputs

- `delivery/version.json` records the complete upstream version, upstream commit and
  independent cloud revision; these become image labels and build records.
- `source-freeze.json` selects the complete merged client commit, which must contain
  the upstream commit recorded in `delivery/version.json`. The builder checks both
  the exact upstream tag and ancestry. `includedPatch` pins selected replacements
  from `runtime-desktop-xfce/source-manifest.json`'s `clientRuntimeFixCommit` by
  SHA-256. Cloud revision 27 replaces only `captureHost.ts` for input-overload
  recovery; the remaining application source stays at the frozen commit. Build
  records bind both the frozen source and the exact runtime patch.
- The upstream version and cloud revision are build arguments shared by the
  application, image labels and release records. The pinned dependency base has
  its own source identity, so an application version bump retains its build cache.
- `runtime-base/Dockerfile` fixes the OS digest, snapshot dates, package versions
  and external checksums. Its `runtime-base-slim` target removes only the three
  duplicate Chromium packages; all agent development tools are retained.
- `Dockerfile` compiles the frozen application in that base using its pnpm lock,
  pinned development headers and verified external assets. It applies the existing
  cloud overlays and builds maintenance/context bundles from the same source.
- `assemble-runtime.py` installs the application once, the tracked helpers,
  Xfce/Dock sources and the Chrome compatibility wrapper. It removes no user data.
- `stage-runtime-agents.py` bundles the frozen Claude binary and complete Codex
  package from their verified downloads. The standard desktop Forge output does
  not include these cloud CLI assets; their checksums and directory manifest are
  checked again before assembly.
- `audit-runtime-layer.py` verifies permissions, required entrypoints and the two
  explicit agent CLI links. `release_guard.py` checks architecture, non-root user,
  command, source labels and the base-plus-one-application layout.

The output contains clean source/recipe exports, their hashes and commits,
Docker commands/logs, image configs, overlay hashes and a payload permission audit.
`result.json` reports build success with runtime acceptance still pending. Image
config IDs are local identifiers, not registry manifest digests.

## Acceptance and promotion

Use disposable data and synthetic identity/keyring material. Test normal startup,
managed identity readiness, sandboxed renderers, Chrome authorization tab cleanup,
terminal/browser Dock launch, minimize/restore, fullscreen, native mouse/keyboard,
Chrome address-bar/page and terminal Unicode text, focus/cancellation boundaries,
Emoji, legacy HOME migration and orderly maintenance shutdown. For existing homes,
also check [legacy user launchers](runtime-desktop-xfce/README.md#existing-user-launchers)
and prove that launched windows merge into their pinned Dock icons. Native X11 tests
are not DeviceLink end-to-end tests. Compare the final image and application
payload with the accepted behavior and record any deliberate differences.

Promotion requires acceptance and the authorized scope. If native qualification
runs on a separate Linux host, an authorized upload of a unique candidate digest
may precede that test. It must remain outside formal version tags, CIS upgrade
approvals and new-claim defaults until qualification passes. Prepare ACS caches
for the main image and every actual initContainer image before updating an
instance. CIS owns task protection, stop/backup/upgrade/recovery. Runtime outputs from this command remain local;
[the candidate delivery workflow](delivery/README.md) composes it with isolated
smoke, candidate publication and ACS preparation. Stable promotion is not implemented.
