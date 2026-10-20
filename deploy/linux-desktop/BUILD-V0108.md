# Historical v0.1.108 application build recipe

The adjacent build scripts preserve the application recipe used for
`0.1.108-xfce-dock-r5.20261019`. They were previously held outside Git. They are
version-specific **Linux builder** programs, not commands to run on a developer's
Mac or against an existing client checkout.

This is an application build record, not a complete source-to-image entry point.
The [dependency base Dockerfile](runtime-base/README.md) is now committed. The
application builder, remaining runtime helper sources and final assembly recipe
are still missing. The current requirements are in [README.md](README.md).

## Source and builder layout

Create a disposable Linux builder with this layout and no user HOME, cloud
credentials or business PVC mounted:

| Path | Input/output |
| --- | --- |
| `/workspace/source` | Export `source-freeze.json.commit` with `git archive`; replace only the six `includedPatch` files from the recorded `clientRuntimeFixCommit`, verifying every SHA-256 |
| `/workspace/recipe` | Export this `deploy/linux-desktop/` directory, including all `runtime-*` directories, from one recorded client commit |
| `/workspace/debs`, `/workspace/sysroot` | Empty temporary Debian package extraction directories |
| `/workspace/artifact` | New application package and matching maintenance/wire bundles |
| `/workspace/*-linux-x64.tar.gz` | Verified Codex package, Pi and ripgrep archives listed below |
| `/workspace/electron-v42.11.12-linux-x64.zip` | Verified Electron distribution |
| `/workspace/electron-v42.11.12-headers.tar.gz` | Electron headers from the same release, verified against its official checksums before staging |

The source base is `d4b39020bf083d79b352fcb56ea5a4941432fb39`. The six patch
files can be read from `8db3e0683c3db8244ac1d39df2ac897482a95307`; their hashes
and source/artifact mapping are also in
[`runtime-desktop-xfce/source-manifest.json`](runtime-desktop-xfce/source-manifest.json).
Do not substitute the whole current branch: it includes later native client UI
work that was not part of this frozen ASAR. `source-freeze.json` is a historical
build record, not a current deployment authorization.

The original builder supplied Node 22, pnpm, a C/C++ toolchain, Python, Debian
bookworm package sources and the frozen workspace dependencies before running
`prepare-linux.sh`. That script expects `node_modules/electron` to exist so it
can install the verified offline Electron archive. `prepare-linux.sh` downloads
development packages into the disposable sysroot and prepares the agent assets;
`build-runtime.sh` then applies the overlays and packages Linux x64. The latter
also builds the maintenance context and runtime wire bundles from the same source.
The hardcoded `/home/cindy/.cache/node-gyp` is the **disposable builder account**.

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

This archive does **not** claim a clean Debian-to-runtime reproducible build.
The historical prepared workspace and application assets are not supplied by the
new dependency-base Dockerfile. The old operational
`kubectl` builders and publication scripts contained deployment-specific paths
and are intentionally not source dependencies. Future CI must replace that
external application-build setup with pinned, reproducible inputs, rather than relying
on an operator's filesystem.

The next release must rebuild the dependency base from its complete Dockerfile
and recorded OS/package inputs, then build the application and helpers from the
recorded source. It must not reuse the historical application image or a base
extracted from that image as a substitute. Normalize directory/executable
permissions with `release_guard.py`; audit hashes, runtime command, non-root user,
source labels, external agent assets and font/license files. Build the supervisor
and wire bundle together and include the desktop sources in the base recipe.

[Filesystem compaction](IMAGE-PACKAGING.md) only compares an output to its input;
it does not prove where that input came from. A fresh build and isolated local
acceptance must precede review of the image and its records. Registry publication,
ACS cache creation and per-instance rollout are separate later stages described
in [README.md](README.md). Archiving these files does not complete the build chain.
