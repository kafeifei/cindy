# Cloud runtime dependency base

`Dockerfile` rebuilds the **third-party** filesystem of the qualified CN runtime
`0.1.108-xfce-dock-r5.20261019` (manifest
`sha256:472134a7ea610497c71d1692ae1aca8f41ef842daf39d92bac298c6e0cf1c647`) from pinned
inputs only. The output is a single-layer `linux/amd64` base without `/opt/cindy`
and without Cindy-owned programs; the application layer adds both. It replaces the
historical practice of compacting a previously published image whose build steps
were no longer recorded.

## Pinned inputs

| Input | Pin |
| --- | --- |
| Dockerfile frontend | `docker/dockerfile:1.10@sha256:865e5dd0…` |
| Base image | `node:24.19.0-bookworm@sha256:4196d66a…` (2026-08-25; amd64 `sha256:107ceb6a…`). Its 413 packages, Node 24.19.0, Yarn 1.22.22 and `docker-entrypoint.sh` are byte-identical to the qualified base |
| Debian archive | snapshot.debian.org `debian/20260905T205002Z` (bookworm, bookworm-updates) and `debian-security/20260905T234553Z`, verified with the image's Debian archive keyring |
| Debian packages | `packages.lock`: all 606 installed packages with version, architecture and manual/auto mark, captured from the published R5 image. Every entry is pinned at priority 1001 while installing |
| Files from Debian packages that are not installed | `arc-theme 20221218-1` (Arc, Arc-Dark, Arc-Darker), `papirus-icon-theme 20230104-2` (Papirus, -Dark, -Light), `fonts-noto-color-emoji 2.042-0+deb12u1`, `libturbojpeg0 1:2.1.5-2` and `libjson-c5 0.16-2` (one soname each), `locales 2.36-9+deb12u14` (zh_CN.UTF-8 compiled by the image's `localedef`). Each `.deb` SHA-256 is listed in the Dockerfile |
| Google Chrome | `google-chrome-stable 155.0.8059.84-1`, `.deb` SHA-256 `8fbd2ae6…` from Google's signed index |
| GitHub CLI | `gh 2.100.0` release tarball SHA-256 `e4d4bb44…`; only `bin/gh` is installed |

The installed set is then checked against `packages.lock` exactly: any missing,
extra or different package, version, architecture, install state or manual mark
fails the build. The account (`cindy`, UID/GID 10001, `/usr/sbin/nologin`), its
password-age record, `corepack enable` shims and the D-Bus machine ID match the
qualified base. The final apt sources point at the canonical snapshot URLs.

## Build

Use a native `linux/amd64` builder with network access to the pinned sources.
The context is `deploy/linux-desktop`; `Dockerfile.dockerignore` limits it to the
three tracked inputs. `CINDY_SOURCE_COMMIT` must be the full commit of this recipe.

```sh
cd deploy/linux-desktop
docker buildx build --platform linux/amd64 -f runtime-base/Dockerfile \
  --build-arg CINDY_SOURCE_COMMIT="$(git rev-parse HEAD)" \
  --build-arg SOURCE_DATE_EPOCH=1789344000 --target runtime-base \
  --output type=docker,name=cindy-runtime-base-cn:<unused-local-tag>,rewrite-timestamp=true .
```

The fixed epoch and timestamp rewrite remove build time from the layer. The
recipe also pins the font-directory mtimes recorded by fontconfig, restores the
base image's logs and drops ldconfig's inode cache, so the remaining payload
depends only on the pinned inputs.

`DEBIAN_SNAPSHOT_URL`, `CHROME_DEB_URL` and `GH_TARBALL_URL` may point at a
controlled mirror of the same artifacts. Mirrors change transport only: the
Debian signatures, every SHA-256 and the lock still apply. Google keeps only
recent Chrome builds, so archive this `.deb` before it disappears upstream, and
mirror the base image by digest rather than relying on Docker Hub retention.

An Apple Silicon build runs under emulation. Use it to check the recipe only;
it is not a release artifact.

## Equivalence check

Compare the rebuilt base with the published runtime (both by immutable ID or
digest). Containers are created but never started:

```sh
python3 runtime-base/compare-base.py --reference <qualified-runtime-id> \
  --candidate <rebuilt-base-id> --output /private/cache/base-compare-<id>
```

Every path must match in type, bytes, mode, owner, link target, hardlink group and
xattrs, except these explicit categories in `compare-base.py`:

- `release-layer`: `/opt/cindy` and Cindy-owned files (`/usr/local/bin/cindy-*`,
  `claude`/`codex` links, `/usr/local/lib/cindy`, `/usr/local/share/cindy`,
  `com.cindy.*.desktop`, the `Cindy-Cloud` theme, `/run/cindy-profile-check`).
  They may only be absent from the base. The application layer must ship them.
- `build-leftover`: `/root/.cache` (corepack cache in a home UID 10001 cannot
  read), `/home/cindy/.cache` (Rosetta translation cache), `/home/cindy/.local`
  (a GitHub CLI device ID) and `/tmp` (a Node compile cache). Earlier builds left
  these; the base omits them and may not add any.
- `changed-by-design`: `debian.sources` names the snapshot instead of a mirror.
- `order-insensitive`: apt's `extended_states`, dpkg's `triggers/File` and
  `bamf-2.index` are written in installation order. Their sorted records must be
  identical; dpkg's `status` database itself has no exemption.
- `transient`: `dpkg/status-old`, dpkg's backup from before its last transaction.
- `regenerated`: `/var/log` and `/var/cache` (fontconfig, ldconfig), whose bytes
  record the build. Type, owner and mode must match.

A passing comparison proves filesystem equivalence only. Runtime acceptance of a
release built on this base is still required.

## Not changed here

These are reproduced as they are in the qualified base and need their own review:
Chromium 152 is installed next to Chrome 155; the two remote-desktop libraries are
copied sonames rather than installed packages; the base keeps the full
`buildpack-deps` toolchain. The Cindy-owned files listed above are not yet all
tracked in this repository, and `release_guard.py` must accept them in the
application layer before a release uses this base.

To update a package, choose new snapshot runs, change the versions in the lock
deliberately, rebuild and compare against the previous base; review every changed
path before qualifying the new base.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy/linux-desktop/runtime-base -p 'test_*.py' -v
```
