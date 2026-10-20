# Historical v0.1.108 application build recipe

The adjacent build scripts preserve the application recipe used for
`0.1.108-xfce-dock-r5.20261019`. They were previously held outside Git. They are
version-specific **Linux builder** programs, not commands to run on a developer's
Mac or against an existing client checkout.

This is an application build record, not a complete source-to-image entry point.
The complete build entry is now [SOURCE-BUILD.md](SOURCE-BUILD.md). This page
records the frozen application inputs, not the current build command.

## Source and builder layout

Create a disposable Linux builder with this layout and no user HOME, cloud
credentials or business PVC mounted:

| Path | Input/output |
| --- | --- |
| `/workspace/source` | Export `source-freeze.json.commit` with `git archive`; replace only the explicit `includedPatch` files from the recorded `clientRuntimeFixCommit`, verifying every SHA-256 |
| `/workspace/recipe` | Export this `deploy/linux-desktop/` directory, including all `runtime-*` directories, from one recorded client commit |
| `/workspace/debs`, `/workspace/sysroot` | Empty temporary Debian package extraction directories |
| `/workspace/artifact` | New application package and matching maintenance/wire bundles |
| `/workspace/*-linux-x64.tar.gz` | Verified Codex package, Pi and ripgrep archives listed below |
| `/workspace/electron-v42.11.12-linux-x64.zip` | Verified Electron distribution |
| `/workspace/electron-v42.11.12-headers.tar.gz` | Electron headers from the same release, verified against its official checksums before staging |

The source base is `d4b39020bf083d79b352fcb56ea5a4941432fb39`. The recorded patch
files come from `clientRuntimeFixCommit` in the source manifest; their hashes
and source/artifact mapping are in
[`runtime-desktop-xfce/source-manifest.json`](runtime-desktop-xfce/source-manifest.json).
Do not substitute the whole current branch: it includes later native client UI
work that was not part of this frozen ASAR. `source-freeze.json` is a historical
build record, not a current deployment authorization.

The historical builder supplied Node 22, pnpm, a C/C++ toolchain, Python, Debian
bookworm package sources and the frozen workspace dependencies before running
`prepare-linux.sh`. That script expects `node_modules/electron` to exist so it
can install the verified offline Electron archive. `prepare-linux.sh` downloads
development packages into the disposable sysroot and prepares the agent assets;
`build-runtime.sh` then applies the overlays and packages Linux x64. The latter
also builds the maintenance context and runtime wire bundles from the same source.
The current Dockerfile runs the builder as root with disposable header caches;
no user HOME is mounted.

| Asset | Version | Archive SHA-256 |
| --- | --- | --- |
| Electron Linux x64 | 42.11.12 | `1f17c115389c6395ce4b19b29ee2ec4be2208257514d61e269f1c0a7323bd45d` |
| Codex package Linux x64 | 0.159.2 | `9e2d29a713b94478b240dec2f10e11324cd05fad76dc43e7c639bdf8a1337a6b` |
| Pi Linux x64 | 1.0.2 | `0d7687a6a9fcbaa88ff664cb6b28683ce9ee3e028931b55eb48a70ae9a285d18` |
| ripgrep Linux x64 | 15.1.0 | `1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599` |

The preparation scripts retain archive checks and the client's existing vendor
manifest validation. The staging step writes only the disposable source export,
fails on missing/duplicate transform anchors, and records before/after hashes.
Never run it with `/workspace/source` bound to a real worktree.

## Image inputs and publication limits

The application output is only one input to the runtime image. The new
`runtime-base/Dockerfile` provides third-party dependencies including Chrome,
GNOME Keyring, X11 and desktop packages. Cindy's supervisor, seccomp launcher,
maintenance helpers and packaged agent assets belong in the application/runtime
assembly, not in that base. The latest desktop source and package versions are
recorded under `runtime-desktop-xfce/`; its `Dockerfile.r5` is the historical
R4-to-R5 repair layer, not a complete runtime assembly.

The current source build supplies its own builder and runtime assembly from the
pinned dependency base and these frozen sources. It uses Node 24.19.0, pinned
Debian development packages, verified Electron archives and the frozen pnpm lock.
The old operational builders and private workspace are not build inputs.

[Filesystem compaction](IMAGE-PACKAGING.md) only compares an output to its input;
it does not prove where that input came from. A fresh build and isolated local
acceptance must precede review of the image and its records. Registry publication,
ACS cache creation and per-instance rollout are separate later stages described
in [README.md](README.md). Archiving these files does not complete the build chain.
