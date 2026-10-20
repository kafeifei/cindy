# CN native input acceptance — 2026-10-20

R4 fixes the personal Chrome and terminal text failures found in the
[R2 DeviceLink acceptance](ACCEPTANCE-20261020.md#real-oauth-and-devicelink-follow-up).
The final image was built from the complete Dockerfile chain, qualified in
isolated native Linux, and upgraded on the same single authorized cloud instance.
The other eleven instances and new-claim defaults remain unchanged. This is a
candidate acceptance, not a fleet release or an implemented CI/CD pipeline.

## Artifact and source

| Field | Value |
| --- | --- |
| Candidate tag | `0.1.108-source-r4.20261020` |
| Registry manifest digest | `sha256:bb6d028c0650e4094d4064ede2d572bb8835c4abb73f6fe8e061d8ec5a030887` |
| Image config ID | `sha256:dc1ed92e6d6e8ec226fbefd2493512a79fc9877f7f58a94f312e329aa91f538c` |
| Build recipe commit | `24f14036911e63b986dca732f2ab9bcad0ffe8b3` |
| Runtime fixes through | `9ad4bdf15b086bfb1d57b6014102cdd4a5d7d691` |
| Frozen upstream | `v0.1.108`, `d4b39020bf083d79b352fcb56ea5a4941432fb39` |
| Application ASAR SHA-256 | `992f1695b7cac7862a5dab88aa3adfee123ec4e6bef0c5dd5e6af171f431f951` |
| Uncompressed image size | 3,704,830,394 bytes, two layers |

[SOURCE-BUILD.md](SOURCE-BUILD.md) remains the reproduction entry. The build uses
pinned OS/snapshot packages, Chrome/assets and frozen source patches; it does not
inherit an older Cindy runtime image. The slim base contains 603 packages, with
duplicate Chromium removed. Local compilation ran under Linux amd64 Rosetta on
Apple Silicon. Native runtime qualification is a separate test below, not a
claimed emulated Mac runtime pass. The UID 10001 payload audit read and hashed
820 files and verified permissions, parent traversal, architecture and layers.

## Input change

Previously, non-Cindy text was routed to an owned managed-browser CDP adapter.
Personal Dock Chrome and the terminal were outside that adapter's ownership
scope, so committed text failed and control ended. The managed cloud X11 receiver
now uses native XTest/libxdo for Cindy, Chrome address bars and pages, and terminals.
There is no application-specific text route, DOM injection or clipboard mutation.
Peer authorization, leases, queue ordering, display identity and focused-window
checks remain in force; the wire protocol is unchanged.

Long Unicode qualification also found that libxdo's transient key mappings could
be reused before Chrome consumed them. The final helper retains bounded mappings
in unused keycodes and restores only mappings it still owns on exit. It does not
overwrite physical key bindings. The earlier failing candidate was not deployed.
Implementation and boundaries are described in
[X11 native input](../../docs/remote-desktop.md#x11-native-input).

## Isolated final-image qualification

All fourteen checks passed on native Linux amd64 using the installed final-image
helper: legacy HOME, sandbox/keyring, Dock launch, minimize/restore and Dock
restart, fullscreen stacking, Cindy close protection, launcher migration, text,
long text, composed text, cancellation, pointer input, authorization-browser
lifecycle and orderly shutdown.

The fixture used disposable emptyDir data, synthetic identity/keyring material,
no business PVC or service-account token, and a private application network with
loopback only. Application/renderers retained seccomp, no-new-privileges and no
effective capabilities. Root-owned `.local/share` permissions were unchanged.

Text checks compared consumed values, including 4096 UTF-16 units, repeated
distinct CJK characters, Emoji/ZWJ sequences, combining characters and literal
terminal punctuation. Focus changes rejected further text. Cancellation released
held modifiers and restored key mappings; the helper exited successfully.
Three real Chrome authorization-browser cycles used synthetic URLs, preserved
unrelated tabs and reclaimed owned tabs/processes. They did not exchange tokens.
Normal shutdown completed without a new crash dump. Both isolated fixtures were
removed after evidence collection.

Source checks passed: Desktop typecheck; 20 Linux remote-desktop test files with
143 tests; 16 Python input-helper tests; 24 image-recipe tests. Documentation checks
also passed. These are targeted checks, not a claim that the complete upstream
test suite or CI ran.

## Cache and one-instance upgrade

The exact candidate ACS cache reached Ready. A disposable probe verified actual
cache hits for both the main image and the real `prepare-profile-status`
initContainer at the same pinned digest; the probe was then removed.

The existing CIS maintenance flow sealed task admission, stopped the instance
and completed the encrypted, read-only PVC backup to OSS before switching images.
The backup covered 3,203 files and 144 SQLite files, with 436,381,931 encrypted
bytes. Sealed database integrity/counts, scheduled-task hashes and crash inventory
matched across the switch. All five readiness components passed and maintenance
released successfully. Two advancing released heartbeats were checked by the
dedicated operator; the shared CIS implementation was unchanged.

Only this instance's image approval was added. All eleven peer templates and Pod
identities, all twelve PVCs, identities, resource settings, automatic-update
preferences and schedules were preserved. The stopped instance was not awakened.
New-claim defaults were unchanged. No formal version tag was published.

## Real DeviceLink acceptance

The controlling endpoint was the isolated macOS Dev client
`0.1.108-dev.cloud.20261016.1`, opened through Settings → Cloud instances → Remote
desktop. Trusted mouse/keyboard events entered that real viewer through its local
debug connection and crossed DeviceLink to the cloud. Cloud-side X11 inspection
was read-only; it did not inject the input being qualified.

| Check | Result |
| --- | --- |
| Personal Chrome address bar | Passed; typed and navigated to a local fixture path containing Chinese and Emoji |
| Chrome page text | Passed; exact consumed text/hash matched Chinese, Emoji, accented/combining characters and a family ZWJ sequence |
| Editing and pointer | Passed; selection, deletion, arrow keys, single/double click, 140-pixel drag and scrolling; key down/up counts matched |
| Terminal text | Passed; native terminal `read` consumed exact UTF-8 text including Chinese, Emoji and shell punctuation without executing that punctuation |
| Cindy text | Passed; Chinese and Emoji appeared in the search field; no task was submitted |
| Foreground video | Passed at 1280×800, approximately 30 fps with advancing decoded frames |
| Held-input release | Passed; Ctrl/Shift reached X11, opening close confirmation released them, and confirmed disconnect left no held keys/buttons or input helper |
| Ordinary reconnect | Passed; reopening through the real settings entry restored video and Chinese/Emoji input |
| Window controls through DeviceLink | Passed; Cindy, terminal and Chrome minimize/Dock restore, Chrome fullscreen toggle without Dock overlay, and Cindy native close protection |

The first Dev connection attempt reused a stale link after an earlier relay
restart and stalled before writing frames. Explicitly closing only that Dev
client's outbound link to the target and reopening the viewer restored it.
Neither the cloud instance nor the hosting Cindy application was restarted.
This is evidence of scoped manual recovery, **not** a pass for automatic recovery
after relay/network outages. A test assertion also initially checked helper exit
before confirming the viewer's disconnect dialog; after the actual confirmation,
the helper exited and the check passed. Both earlier observations remain archived.

Afterward, only the owned terminal and fixture browser tab were closed, test search
text was cleared, exact fixture files were removed after content/owner checks,
and the viewer was disconnected. The completed operator Pod and its script
ConfigMap were removed; active policy ConfigMaps and the image cache were kept.
The final instance check showed all readiness components ready, maintenance
released, no active/queued work, no container restart and no new crash dump.

## Scope limits

- Fresh OpenAI OAuth, credential persistence and callback/process cleanup passed
  on R2, as recorded separately. R4 preserves the same authorization-browser
  source hash and repeats its isolated lifecycle tests; a fresh R4 OAuth exchange
  was not repeated. Other providers and model inference are not covered here.
- The real controlling device was a Mac, not an iPhone. Synthetic committed-text
  events verify the transport and receiver, not a physical IME composition UI.
- Cross-device clipboard synchronization, Xfce window-list/workspace actions,
  privacy/lock/resize controls and background/occluded video were not qualified
  by this work. This is not a claim that every remote-desktop toolbar feature has
  an Xfce backend. Wayland and macOS/Windows receiver adapters are unchanged.

Raw screenshots, fixture results, backup/cache receipts and infrastructure
identifiers remain in the private acceptance archive, outside the repository.
