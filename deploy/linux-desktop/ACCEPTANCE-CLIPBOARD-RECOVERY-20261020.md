# Managed X11 clipboard and peer recovery — 2026-10-20

This follow-up covers the clipboard and automatic recovery gaps left by
[R4 native-input acceptance](ACCEPTANCE-NATIVE-INPUT-20261020.md). The scope is
one authorized cloud instance. Physical iPhone input and system clipboard tests
require the user's real-device operation; no simulated test below is a phone pass.

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

## R6 full build and native qualification

The corrected R6 candidate was built from the complete Dockerfile chain, without
inheriting a previous Cindy runtime image. Recipe commit:
`2b430a20a47bed3d8da2ace6c1059b406c63d44c`; frozen application source includes
`93316f6d08`. Local compilation used Linux amd64 under Rosetta on Apple Silicon;
runtime qualification used a separate native Linux amd64 fixture.

| Artifact | Value |
| --- | --- |
| Candidate tag | `0.1.108-source-r6.20261020` |
| Registry manifest digest | `sha256:2a9c5d0f34c5ede4d32cdc09444409318d4f066d1de93e685a144b64ba2a7f03` |
| Image config ID | `sha256:384e81ab03b39129f26cc2e5263107357ddce494be0176338327de3eadfb5c49` |
| Application ASAR SHA-256 | `3d7d5f8f9f301c428f9e4d9c65bac1b6dcc745811d44f75ed2d2dbd13a48f8eb` |
| Uncompressed image size | 3,704,833,204 bytes |

The non-root audit verified 820 payload files, parent traversal and permissions.
The image retains two layers and 603 pinned packages, with duplicate Chromium
removed. ACS cache reached Ready; a disposable probe verified an exact cache hit
for both the main image and the actual `prepare-profile-status` init image and
command. The probe had no business PVC or service-account token and was removed.

All 21 native qualification steps passed on this exact R6 image, including:

- Startup with root-owned, non-writable legacy `.local/share`, without changing
  its ownership or permissions; runtime sandbox and system desktop launchers.
- Terminal/Chrome launch, minimize/restore, Dock restart, fullscreen avoidance,
  Cindy close protection and launcher migration.
- Native text, long text, composed Chinese/Emoji/ZWJ text, cancellation and pointer
  input; synthetic authorization-browser ownership and cleanup.
- Clipboard sync/read latency of 20–31 ms with an empty X11 clipboard; exact
  terminal/Chrome UTF-8 paste, CLIPBOARD rather than PRIMARY selection,
  text/HTML/RTF round trips and PNG normalization.
- Clipboard harness exit, one surviving application main process, then explicit
  SIGTERM: main-process exit in 0.1 seconds, container exit zero and no new crash
  dump. The fixture was removed after shutdown.

The clipboard harness was a separate Electron process compiled from the same
committed adapter source. These checks do not substitute for DeviceLink product-UI
clipboard acceptance or a real third-party OAuth exchange. A test-only process
parser initially counted Electron children as main processes because Linux
proctitle rewriting can place the arguments in one string; the parser was fixed
and the exact-main-process assertion then passed before shutdown.

R5 was withheld after finding a roughly ten-second empty-clipboard read during
ownership handover. The corrected guard avoids native content getters when no
formats exist; 16 focused tests and Desktop typecheck passed. Earlier R6 build
attempts exhausted VM memory or encountered an interrupted download. The successful
build retained Forge's required 6 GiB heap and used temporary VM swap, which was
removed afterward. Packaging now checks executable/ASAR output immediately; asset
downloads use bounded HTTPS/HTTP 1.1 retries and a SHA-256-verified BuildKit cache.
Five downloader tests cover cache reuse, corruption, interruption, checksum failure
and invalid pins. Failed-attempt evidence is retained privately.

## Own-instance deployment

Only the authorized own instance was upgraded from R4 to R6. The existing
maintenance path sealed the runtime, stopped it, mounted the PVC read-only and
completed an encrypted OSS backup (3,208 files; 436,502,030 ciphertext bytes)
before changing the main and init image. The new Pod hit the qualified ACS cache,
started with zero restarts and passed all five runtime readiness checks.

Sealed database integrity/counts, schedules and crash-dump comparisons passed.
Maintenance completed and the new runtime returned to `released` at epoch 81.
Xfce, Plank, the two pinned launchers, the 40 px Matte Dock and the Emoji font
were present; the application ASAR matched the audited R6 hash.

Final checks confirmed all other 11 instance images, Pod identities and
StatefulSet specs unchanged, including the stopped instance remaining stopped.
All 12 PVCs, instance identities, resources and update preferences were preserved.
New-claim defaults and the shared CIS maintenance implementation were unchanged;
there were no active maintenance operations. Temporary operator resources were
removed after verification.

A read-only request from the isolated Mac Dev client over real DeviceLink to the
R6 receiver returned text/inline/rich-content clipboard, clipboard sync, native
control and automatic-reconnect capabilities in 123 ms. It did not start a viewer
or access either device's clipboard; capability discovery is not a clipboard
transfer test.

## Real connection recovery and remaining device checks

The rebuilt isolated Mac Dev test package retains independent app/data/device/
credential identity. Its internal package version matches the Dev bundle version;
all other archive contents and unpack layout were checked unchanged, and signing
verification passed. The temporary Keychain wait ended before the following test.
Only this private Dev package enabled a loopback main-process inspector for fault
injection. After acceptance it quit normally, the original fuse values were
restored and code signing verification passed. The hosting application and release
build configuration were not changed; no local user clipboard content was read or
replaced by the deferred UI test.

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

### Mac product-UI follow-up

After the Mac was unlocked and the original Keychain request was authorized, the
Dev viewer connected to the R6 receiver. Pasting synthetic Chinese/Emoji text with
the actual **Clipboard → Paste to remote computer** button failed with
`DESKTOP_CLIPBOARD_UNAVAILABLE`; the cloud test field remained empty. This is a
failed transfer, not a pass based on advertised capabilities.

The local native clipboard-counter helper exited with code 77 before clipboard
transfer. The isolated, ad-hoc-signed Cloud Dev package had retained the production
helper, whose caller authentication only accepts the signed release identities.
The existing `DESKTOP_INPUT_DEVELOPMENT` build mode was used to rebuild the
unchanged helper sources for this private acceptance app, bound to its exact
executable path. An unrelated Node caller was still rejected with code 77 and no
output. Release helper authentication and source were not modified. This local
Dev fixture does not qualify a Developer ID-signed distribution package.

After the second Keychain authorization, both one-shot and persistent native
clipboard-counter requests from the Dev main process succeeded. The real R6
DeviceLink viewer then passed:

- **Mac → cloud Chrome:** the viewer's paste button delivered exact Chinese,
  Emoji and ZWJ text; cloud-side readback recorded one native input event.
- **Cloud Chrome → Mac:** the test page's select-all button and the viewer's
  copy button replaced a deliberately different Mac marker with the exact
  selected cloud text. Local inspection returned equality only.
- **Mac → cloud terminal:** the same product paste button delivered the exact
  UTF-8 marker to a raw terminal reader. No pasted shell command was executed.

These are real Mac-client-to-cloud transfers, with direct media available. The
Mac clipboard was restored, clipboard sync returned to its original off setting,
and the viewer was disconnected through its confirmation dialog before handing
the blank test page to the phone. The receiving Pod remained R6 with the same UID
and zero restarts. This does not qualify images, files or rich-text transfers.

### Automatic sync defect found during live follow-up

Manual transfer passed, but foreground automatic sync did not. Initial automation
also exposed a focus mistake: CDP focus alone left the native main window in front;
subsequent checks explicitly verified native viewer focus. Sync still failed.
The Linux adapter returned a hexadecimal SHA-256 clipboard generation, while the
existing shared Desktop/Mobile sync engine accepts decimal generation strings.
The old unit test asserted the incompatible hex format and therefore missed the
consumer failure.

The adapter now encodes all 256 fingerprint bits as a decimal string using
`BigInt`, retaining equality-based change detection without changing the wire
contract or either consumer's validator. A regression using the actual shared
sync engine reproduced `CLIPBOARD_UNSUPPORTED` before the fix and passed after it,
covering initial no-write behavior, both transfer directions and no repeated
write on an unchanged tick. All 34 focused clipboard/viewer tests and Desktop
typecheck passed. This is a **source fix**: the deployed R6 image still contains
the defect, and automatic sync is not recorded as a live pass.

### Physical iPhone status

The user confirmed that the installed **production iPhone app does not have
Device management**. The guidance above came from the development branch and
must not be presented as the production app's available navigation. This was an
acceptance setup error; no phone input or clipboard failure has been established.

The cloud device is online with control enabled, but its availability alone does
not prove that this phone build has a matching entry. The phone's installed build
must be identified before giving further navigation or deciding whether a test
build is required. Native keyboard composition and both phone clipboard
directions remain pending. No iPhone application update was installed, and
neither Mac input nor mobile unit tests substitute for hardware acceptance.

The private Mac Dev app has now quit normally; its original inspector fuse
settings were restored and code-signing verification passed. The test-only native
helper retains the documented exact-path development binding and is not a
release-signature qualification. The blank cloud test page remains available for
the phone follow-up; other cloud instances were not changed.

Raw logs, screenshots, synthetic fixtures and infrastructure receipts stay in the
private acceptance archive. No user clipboard contents or credentials are
included in this record.
