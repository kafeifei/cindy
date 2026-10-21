# cloud.2 delivery and authorized-instance acceptance — 2026-10-21

This record covers one owner-requested runtime upgrade and one existing native
instance's init-image repair. The other ten instances and new-claim defaults were
unchanged. This is not a fleet promotion or a new OAuth/DeviceLink end-to-end pass.

## Delivered artifact

| Field | Verified value |
| --- | --- |
| Recipe commit | `fff2f92044a4c4ad8a77b751a699d94b5b732737` |
| Frozen application source | `d4b39020bf083d79b352fcb56ea5a4941432fb39` |
| Upstream / cloud revision | `0.1.108` / `2` |
| Application version | `0.1.108-cloud.2` |
| Image tag | `0.1.108-cloud.2-cn-amd64` |
| Registry manifest digest | `sha256:d821e2ca053c9020936d64a662639bd506363496f2a475731f0ae7665f759cd7` |
| Image config ID | `sha256:4d19d7db622c6722fcfbd48b161fcb9c1f26d7afcbc803b0a27b866ccd55862d` |
| Application ASAR SHA-256 | `82757eeccc021b54698caad8ecf20c5aa9517de5460be5ad8f152c3886dcd5cf` |
| Uncompressed size / layers | `3,704,673,554` bytes / 2 |

[GitHub Actions run 39587950156](https://github.com/zhuoshaojian/cindy/actions/runs/39587950156)
passed verification, complete Dockerfile build, native Linux smoke, candidate
publication and ACS cache preparation on repository-only self-hosted ECI runners.
The exact candidate and cache artifacts were downloaded and cross-checked against
the run's commit and digest. This run is not evidence of a fully warm build; see
[the separate cache benchmark and its limits](delivery/BUILD-CACHE-BENCHMARK.md).

The smoke used disposable data, no network, a read-only root and UID 10001. It
verified Xfce/Plank startup, sandboxed renderers, the historical root-owned HOME
directory condition and orderly shutdown. It reads the package version from
app.asar and requires the combined version; changing only the image tag is no
longer sufficient. Ordinary desktop source versions remain unchanged.

## Real cloud verification

Before switching, a disposable Pod with the production cache/network annotations
verified exact cache hits for the candidate main/init image and the actual
historical init variant. All init containers exited zero without restart. The
upgraded business Pod then independently reported a hit for the candidate cache.

The logged-in owner clicked **立即升级** on the CIS webpage outside the configured
maintenance window. A single durable request progressed through stop, encrypted
read-only OSS backup, image switch, release and health observation to `completed`.
Reloading the page preserved progress. At completion it showed one ready instance,
the cloud.2 version, and no further available upgrade. Auto-update preferences
were not changed.

- The backup contained 3,205 files; encrypted payload: 436,795,905 bytes.
- Main and actual init image references both match the candidate digest; the main
  container is ready with zero restarts and the init completed successfully.
- Authentication, database, binaries, Maker and DeviceLink readiness all passed.
- The actual cloud client sidebar displayed **CN · 0.1.108-cloud.2 Beta**, matching
  the package and delivery version. The existing Beta channel suffix was retained.
- Native personal-Chrome text input passed 512 Chinese characters, Emoji,
  Shift/Caps-lock preservation and rejection after keyboard focus changed.
  Native terminal input preserved Chinese, Emoji and literal shell metacharacters.
- Launching Terminal and Chrome from their fixed Dock icons grouped the windows
  correctly. Terminal, Chrome and Cindy minimized and restored through the Dock
  before and after a supervised Dock restart. Cindy's real minimize button worked.
- Maximized Cindy respected the 56-pixel reserved bottom area; fullscreen covered
  the entire display above the Dock. Alt+F4 was intercepted without restarting
  Cindy. The locale and Noto Color Emoji were present.
- SQLite quick-check, existing conversation counts and schedule-table hashes were
  unchanged. No additional crash dump appeared. Instance/device identity, PVC
  binding, resource configuration, auto-update and next-wake preferences remained.
- The other ten instances kept their templates and Pod identities; the stopped
  instance remained stopped. New-claim defaults stayed on the prior R7 image.

These input checks invoked the packaged native Linux adapter on the real cloud
display. They do **not** certify a fresh Mac/phone DeviceLink transport, clipboard
round trip or third-party OAuth flow. Earlier R7 acceptance remains historical.
Temporary windows/files, cache probes and one-job delivery runners were cleaned up.

## Init repair and CIS compatibility

The native instance with main R7 and init `0.1.103` was backed up before its init
changed to the same pinned R7 image. Its backup contained 452 files and 1,563,593
encrypted bytes. Data and schedule checks matched, runtime health passed and the
maintenance lock was released. Future CI cache inventory now uses R7 for that
actual template; old receipts are retained as historical evidence.

An initial attempt was rejected before stopping the source because the original
hash-bound template itself had different main/init images. Source maintenance was
canceled safely. The corrected v2 binding validates the unique controller-owned
init in the original template while retaining checks on command, mounts, security
and live drift. The subsequent normal maintenance attempt passed.

CIS implementation: [686f038e](https://github.com/zhuoshaojian/cindy-server/commit/686f038e94d924343bc973cf190218135fbbdc59),
including the earlier dual-version selector and owner queue. API and orchestrator
were built from clean committed source and deployed compatibly before v2 migration.
No database schema or runtime wire change was introduced. CIS typecheck passed;
79 test files / 1,672 tests passed, with 394 opt-in tests skipped. The targeted
browser suite separately passed 30 cases across five languages, three widths and
two themes, using real Chromium/TLS/PostgreSQL and a synthetic upgrade worker.
That browser suite is separate from the real owner request described above.

Stable catalog/signatures/promotion, new-claim catalog consumption and the native
client's dedicated upgrade button remain future work. See
[dual-version behavior and boundaries](DUAL-VERSION-UPDATES.md).
