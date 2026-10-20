# Managed X11 clipboard and peer recovery — 2026-10-20

This follow-up covers the clipboard and automatic recovery gaps left by
[R4 native-input acceptance](ACCEPTANCE-NATIVE-INPUT-20261020.md). The scope is
one authorized cloud instance. Physical iPhone input and system clipboard tests
are deferred at the user's request; no simulated test below is a phone pass.

## Changes

Managed X11 now exposes the existing portable clipboard protocol through
Electron's native X11 clipboard. Text, HTML, RTF and bounded PNG content use the
same lease, conflict and payload checks as existing receivers. Copy prefers the
current selection and falls back to CLIPBOARD; paste uses Shift+Insert so it also
works in a terminal without treating Ctrl+V as a literal-input command. Clipboard
sync does not synthesize a key. File-backed flavors are excluded. This backend is
limited to the managed cloud Xvfb display, with display identity checked before
and after access; arbitrary Linux sessions and the Wayland lock policy are not
changed. No persistent clipboard store or new wire fields were added.

After a previously reliable peer goes down, fresh Desktop/Mobile requests and
subscriptions recover that peer's link before admitting new work. Cancellation,
explicit close and foreground ownership are rechecked after recovery. Existing
in-flight frames retain their identities: the recovery does not discard them or
reissue business writes. Listing-only subscriptions participate in recovery.
The shared relay and unrelated peers are not restarted.

## Source and targeted verification

- Runtime implementation: `7704a82c80`; empty-X11-clipboard guard: `93316f6d08`.
- R5 recipe: `e37f24427d01df1e45e058a0713c8d9eb2a244f4`; corrected source freeze: `b5f576f7e6`.
- Additional outage regression: `e0c6f22387`.
- Desktop: 51 related test files, 592 tests passed; typecheck passed.
- Shared DeviceLink: 43 files, 849 tests passed before strengthening the outage
  test; both strengthened cases then passed. Package typecheck passed.
- Mobile: 319 remote-viewer/clipboard/screen tests and 47 recovery/route tests
  passed (six callback tests overlap); typecheck passed. No native configuration
  or fingerprint inputs changed.
- Seven source-build checks passed. These are targeted local checks, not a claim
  that a release pipeline or the complete upstream test suite ran.

The in-memory relay regression uses two controllers and one host. It exercises
both abnormal network closure (1006) and service-restart closure (1012), including
an executed write whose reply is dropped before disconnection. The old write
executes once, its result is recovered, subsequent listing/input succeeds, and
the healthy controller and host keep their original connections. Production
Desktop/Mobile callback tests additionally cover cancellation and explicit-close
races. This verifies recovery logic; it is not a real relay outage acceptance.

## Native clipboard preflight

A disposable native Linux amd64 fixture used R4's Electron/Chrome/Xfce with the
new adapter compiled from the committed source. Native terminal and personal
Chrome consumed exact Chinese, Emoji and ZWJ text through X11 paste. A deliberately
different PRIMARY selection was not pasted. Text/HTML/RTF round trips, PNG
normalization, selection copy and empty-selection fallback passed.

The fixture had no business PVC, real credentials or service-account token and
was removed afterward. The clipboard harness was a separate Electron process;
this preflight is neither final-image acceptance nor DeviceLink end-to-end input.

## Outstanding acceptance

The full R5 candidate was built from the complete Dockerfile chain, without
inheriting a previous Cindy runtime image. The non-root audit verified 820
payload files, parent traversal and permissions; the image retains two layers
and 603 pinned packages, with duplicate Chromium removed.

| Artifact | Value |
| --- | --- |
| Candidate tag | `0.1.108-source-r5.20261020` |
| Registry manifest digest | `sha256:4483ca02a98e37bede2b76e8c57351dfbcde7de11c51a51d368e6269e5c2392d` |
| Image config ID | `sha256:9ab40eb1cdcf7bb0f60b4e2a16cb0c7146a5d0edb45a8c3d66173de2a6d8c78e` |
| Application ASAR SHA-256 | `adb21dd6fabadb50b9aad7325e7bcd0148278a978d11d13cd83781077bec758c` |
| Uncompressed image size | 3,704,833,152 bytes |

Local compilation used Linux amd64 under Rosetta on Apple Silicon. Final-image
native Linux checks passed the desktop/input cases, but found a roughly ten-second
empty-clipboard read during ownership handover. R5 was therefore not deployed. Its
ACS cache reached Ready and the main and actual init image both hit it.

The empty-format guard now returns an empty result without invoking native content
getters. Sixteen focused clipboard tests and Desktop typecheck passed. A patched
standalone Electron harness on R5 completed cold sync/read in 20–41 ms and passed
terminal/Chrome UTF-8 paste and rich-content checks. This is not a corrected-image
pass. The first R6 build exhausted the local VM memory during Forge compilation;
no runtime image was produced. A 4 GiB packaging heap retry also failed with V8 heap exhaustion. The recipe
retains its 6 GiB heap and now requires the executable and ASAR immediately
after packaging; the next local build uses temporary VM swap to provide
headroom without restarting or stopping existing services.
A subsequent download failed with curl error 18 (truncated HTTP/2 stream).
The downloader now retries stalled/partial transfers over HTTPS/HTTP 1.1 and
uses a SHA-256-verified BuildKit asset cache; five tests cover cache reuse,
corruption, interrupted downloads, checksum failure and invalid pins.
R6 full build and qualification are pending. The two R5 diagnostic fixtures
exited with code zero without a recorded normal-shutdown request; no normal-stop
acceptance is claimed for them, and the fresh-image run must capture the runtime
exit reason and complete an explicit shutdown check before any deployment.

## Real connection recovery and remaining device checks

The rebuilt isolated Mac Dev test package retains independent app/data/device/
credential identity. Its internal package version matches the Dev bundle version;
all other archive contents and unpack layout were checked unchanged, and signing
verification passed. The temporary Keychain wait ended before the following test.
Only this private Dev package enabled a loopback main-process inspector for fault
injection; the hosting application and release build configuration were not changed.

On the own-instance R4 receiver, one TLS socket belonging to the Dev client's
production relay connection was destroyed. The client reported connecting and
returned online after 904 ms without a manual reconnect. The viewer established
its stream again; two post-recovery samples advanced from 860 to 905 frames.
A new native input containing Chinese and Emoji matched the cloud Chrome test
page exactly. The cloud Pod UID stayed the same, and no held keys, modifiers or
mouse buttons remained. Input attempted during lease handover was rejected with
`DESKTOP_LEASE_EXPIRED` and was not replayed. Video counters reset when streams
are replaced, so the acceptance compares samples from the new stream.

This is a real **single-client connection fault**, with direct media available;
it does not represent a full production relay service outage. The shared relay,
cloud container and other clients were not restarted. Business-write deduplication
is covered by the separate synthetic tests, not by sending real user messages.

An additional local TCP/WebSocket fixture used the committed DeviceLink client,
two controllers and one host. Both socket termination (1006) and service-restart
closure (1012) recovered; a write whose response was dropped executed once, and
fresh listing/input requests succeeded. The healthy controller and host each
retained one connection. It used synthetic identities and accelerated 30–100 ms
reconnect timing, not production credentials or phone hardware.

Mac-to-cloud clipboard through the product UI remains pending the corrected R6
receiver. Physical iPhone keyboard composition and system clipboard remain
explicitly deferred at the user's request.

Raw logs, screenshots, synthetic fixtures and infrastructure receipts stay in the
private acceptance archive. No user clipboard contents or credentials are
included in this record.
