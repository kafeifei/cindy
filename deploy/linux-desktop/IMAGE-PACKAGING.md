# Cloud runtime image packaging

The released image must contain one dependency filesystem and one application
payload, not the entire chain of earlier full application releases. A Docker
`COPY` or `chmod` on top of an old application image retains the old bytes in
lower layers. Deleting them in another layer does not recover that space.

## Compact an already validated release

`compact-runtime.py` preserves the current merged filesystem of an immutable,
locally available, validated Linux image. It generates a multi-stage Dockerfile:

1. Use the validated image as a read-only build input.
2. Copy its filesystem **except `/opt/cindy`** into a `FROM scratch` dependency
   base. The old image layers are not inherited.
3. Copy `/opt/cindy` exactly once and restore the original runtime metadata.

No packages are upgraded or removed. Electron, agent CLIs, Chromium, fonts,
GNOME Keyring, the seccomp launcher, preflight/maintenance helpers and supervisor
are preserved. BuildKit frontend 1.19 or later is required for `COPY --exclude`.
The build uses no `RUN` instructions and needs no architecture emulation.
See the [Dockerfile reference](https://docs.docker.com/reference/dockerfile/#copy---exclude).

Example (replace the placeholder digest and use unused local tags):

```sh
python3 deploy/linux-desktop/compact-runtime.py \
  --source 'registry.example.invalid/cindy/runtime@sha256:<validated-digest>' \
  --base-tag cindy-runtime-base:release-id \
  --tag cindy-runtime:release-id \
  --output /private/cache/cindy-image-release-id
```

The output directory must not exist. It contains the exact generated Dockerfile,
source/output image metadata, build logs, filesystem manifests and
`verification.json`. No user HOME, tokens, Keyrings or PVCs are read or mounted.
Temporary containers are created only to export filesystems; they are never
started and are removed by container ID. The tool does not push images, restart
clients or update Kubernetes.

For an unpublished local build, `--source sha256:<full-image-ID>` is also accepted.
The tool reserves a temporary local build alias, checks its identity before and
after building, and removes only that alias. Filesystem comparison still reads
the immutable source image ID. Mutable source tags remain rejected; a local
candidate does not need to be published before it can pass packaging validation.

The verification must pass before publication:

- Every image file has identical bytes, type, owner, group, mode, link target,
  hardlink group and exported xattrs/ACLs. This includes setuid/setgid modes.
- Runtime config and platform match. Omitted working directory and `/` are
  equivalent. Other unfamiliar config fields fail closed for explicit review.
- The dependency base contains no `/opt/cindy`, has exactly one layer, and
  equals the source filesystem outside that path.
- The final image has exactly two layers and begins with that dependency layer.
- Four Docker-generated container files are excluded from comparison:
  `/etc/hostname`, `/etc/hosts`, `/etc/resolv.conf`, `/.dockerenv`.
  Timestamps and inode numbers are not runtime equivalence guarantees.

This is a packaging check, not a substitute for runtime acceptance. Run the
existing candidate preflight in the actual target platform/security context;
verify sandboxed renderers, missing-key/canonical fail-closed behavior, and
safe-storage operation. See [runtime observation](PROFILE-OBSERVATION.md).
Use synthetic credentials for isolated preflight and retain the old image digest.
Filesystem equivalence does not authorize rollout or change its instance scope.

## Subsequent releases

Reuse the **dependency-base** output when building the next application release;
do not use the previous full application image as the release base. Copy the
new packaged application once with its final ownership/permissions already set.
Update the supervisor and its wire bundle together when they change. The base
itself deliberately has no application command; the final release must restore
and verify the validated runtime config.

Run compaction/equivalence as the final packaging step for every release,
including compatibility releases still built from historical full-image inputs.
Only its verified two-layer output is publishable. Intermediate build caches may
still occupy disk locally; deleting shared Docker caches is unrelated to fixing
the released image size and must not be done automatically by this tool.

Tests:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s deploy/linux-desktop -p test_compact_runtime.py -v
```

Record both uncompressed layer bytes and compressed registry layer bytes; they
measure disk footprint and cold download size respectively. Do not report one
as the other. This compaction preserves the validated package set; replacing
the full Node base with a minimal base is a separate dependency change requiring
its own compatibility checks.
