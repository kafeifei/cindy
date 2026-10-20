# CN source image acceptance — 2026-10-20

This records the **R2** candidate. The later [R4 native input acceptance](ACCEPTANCE-NATIVE-INPUT-20261020.md)
records the current one-instance candidate and resolves the personal Chrome and
terminal input gap found below. R2 results remain scoped to their original image.

The complete Dockerfile build was qualified on isolated native Linux and then
upgraded on one authorized existing cloud instance. The other eleven instances
and new-claim defaults were unchanged. This is a candidate acceptance record,
not a fleet release or an implemented CI/CD pipeline.

## Artifact

| Field | Value |
| --- | --- |
| Candidate tag | `0.1.108-source-r2.20261020` |
| Registry manifest digest | `sha256:cbe53e2fdbb8dd46270c19b24d5258f7ef279aa8181336632c21b30fb9930ea0` |
| Image config ID | `sha256:78060843a9db92045362fe1fa49025fb4b14dbd0577e39c610ebe301a0d503db` |
| Build recipe commit | `71c751a535dc164549cc48df57d239cfcd8aa707` |
| Frozen upstream | `v0.1.108`, `d4b39020bf083d79b352fcb56ea5a4941432fb39` |
| Application ASAR SHA-256 | `c13c0198ae9ced1d108d23bee6ac520615cdbcdacdea480a2fd2c805381bf434` |
| Uncompressed image size | 3,704,825,613 bytes, two layers |
| Local compressed Docker archive | 1,581,844,175 bytes; this is not a registry transfer-size measurement |
| Archive SHA-256 | `07e7eff52e5137521f00d9eeee2aa6f575941f825fba36262873e70383564b51` |

[SOURCE-BUILD.md](SOURCE-BUILD.md) is the build entry point. The recipe builds the
base from its pinned OS, snapshot packages and verified downloads, then compiles
the frozen application with the six recorded fixes and cloud overlays. It does
not use an existing Cindy runtime image. The slim base has 603 packages after
removing the three duplicate Chromium packages. Chrome, fonts, Xfce/Plank and
Agent development tools remain available. The separately developed native cloud
settings client is not the source revision packaged into this frozen cloud ASAR.

## Results and environment

- **Build and payload:** local Linux amd64 build under Rosetta on Apple Silicon;
  820 payload files read and hashed as UID 10001, permissions and parent directory
  traversal checked, two layers verified. Claude and the complete Codex package
  passed the download checks and started with `--version` on the cloud instance.
- **Isolated runtime:** native Linux amd64, disposable emptyDir data and synthetic
  keyring, read-only root, no service-account token or business PVC, private
  network with loopback only. Cindy and its renderers ran with seccomp and
  no-new-privileges. Legacy root-owned `.local/share` permissions stayed intact.
  Normal shutdown exited successfully without a new crash dump.
- **Desktop:** real Dock launch of Terminal/Chrome, minimize and Dock restore of
  all three applications before and after Dock restart, fullscreen stacking above
  the Dock, native minimize control, Cindy close protection, keyboard/mouse input
  and visible Chinese/color Emoji passed. Existing size/zoom preferences and
  custom pins were preserved by the isolated migration tests.
- **Authorization browser lifecycle:** three real Chrome cycles using the frozen
  authorization-browser module passed blank-tab cleanup, independent authorization
  tabs, preservation of a user-created tab, and exit after the last owned tab.
  URLs were synthetic; this did not exchange real third-party credentials.
- **ACS and upgrade:** exact candidate cache was Ready and hit by the main image
  and the actual `prepare-profile-status` initContainer. The existing CIS flow
  sealed tasks, stopped the instance and completed an encrypted, read-only PVC
  backup to OSS before starting the candidate. Database integrity/counts,
  scheduled-task hashes and crash-dump inventory matched during the sealed
  transition. Auth, database, binaries, maker and DeviceLink readiness all passed;
  maintenance completed and released the instance.
- **Scope and preservation:** one existing instance updated; all eleven peer
  instance templates and Pod identities were unchanged, including the stopped
  instance. PVCs, user/device identity, resources, auto-update preferences and
  schedules were preserved. New-claim defaults were unchanged.

## Existing-profile repair

Cloud acceptance found an old user-level `cindy-dock-chrome.desktop` taking
precedence over the system entry, producing a second Dock icon. The explicit
[legacy launcher migration](runtime-desktop-xfce/README.md#existing-user-launchers)
archived the exact old managed Terminal/Chrome entries, preserving their content
and metadata. No image files, browser profile or directory ownership were changed.
The migration tool is a follow-up source delivery, not a file bundled in the
recipe commit above. After migration, the matcher selected the system entries
and all desktop checks passed again on the cloud instance. Three filesystem
regressions cover archival/idempotence, custom files/symlinks and absent directories.

## Real OAuth and DeviceLink follow-up

The follow-up targets the same candidate on the same authorized instance, using
the isolated macOS client `0.1.108-dev.cloud.20261016.1`. No additional deployment
was performed. The cloud precheck confirmed the ASAR hash above, all five
readiness components ready, maintenance released at epoch 79, and the expected
Xfce/Plank processes and system launchers.

| Check | Result in this follow-up |
| --- | --- |
| Cloud runtime precheck | Passed |
| Fresh OpenAI OAuth and native callback forwarding | Passed; a new login reached `waiting → running → succeeded`, including a native `respond` request |
| Cloud credential persistence and reload | Passed; new account credentials were written during this attempt, and the provider remained connected after reloading the client |
| Authorization cleanup | Passed; login staging directory removed, login process and both port 1455 listeners gone, no cloud authorization-browser window remained |
| Mac viewer → cloud mouse | Passed; pointer movement, Dock launch/minimize/restore, and Cindy search-field clicks were independently observed on the cloud desktop |
| Mac viewer → Cindy keyboard | Passed; ASCII, Chinese and Emoji text, selection and deletion reached the cloud search field |
| Foreground live video | Passed at 1280×800; matching client/cloud screenshots showed the typed search text while decoded frames advanced at approximately 30 fps |
| Mac viewer → personal Dock Chrome text | **Failed**; entering committed text disconnected control |

After the user unlocked the Mac, the test used the native client provider card
and its existing callback forwarding. No operator-created port proxy, copied
callback URL or manual cloud `/success` request was used. An earlier attempt
expired waiting for a callback and is not counted as a pass. The successful
attempt wrote fresh `auth.json`, `account.json` and `config.toml` as UID 10001
with mode 0600; verification inspected metadata, not credential contents.
The cloud login child suppresses its own browser launch, so this path correctly
left no cloud Chrome window to reclaim.

DeviceLink was opened through Settings → Cloud instances → Remote desktop in
the isolated Mac client. Trusted mouse and keyboard events were delivered to
that viewer through its local debug connection, then traversed the real
DeviceLink control path. Cloud-side X11 inspection was read-only. Independent
cloud screenshots and the viewer both showed the test search text. Foreground
samples advanced from 4130 to 4194 decoded frames over about 2.1 seconds. Earlier
captures stalled while the test app was not reliably foregrounded; activating
the existing Dev app restored updates. Background/occlusion behavior remains
unqualified. Test text and the temporary fixture were removed; no task was sent.

The personal Chrome failure was an input capability gap in R2, so this is
**not an unrestricted whole-desktop DeviceLink pass**. The frozen application's
[Linux text adapter at the R2 recipe](https://github.com/zhuoshaojian/cindy/blob/71c751a535dc164549cc48df57d239cfcd8aa707/apps/desktop/src/main/remote-desktop/linuxInputHost.ts)
accepted Cindy's focused window and delegated other processes to the
[owned managed-browser check](../../apps/desktop/src/main/mcp-integrations/browser-focused-text.ts).
The separate Dock Chrome profile did not satisfy that check; input failure
ended the control session. [R4](ACCEPTANCE-NATIVE-INPUT-20261020.md) replaces that
text path with native X11 input and records its regression and real DeviceLink
results. No input ownership checks or sandbox restrictions were weakened for
this acceptance.
Terminal text and iPhone-to-cloud input were not qualified by this run.

## Limits

The local Rosetta runtime attempt stopped at `INSTANCE_SECCOMP_UNAVAILABLE`;
sandboxing was not weakened. Runtime acceptance therefore uses the isolated
native Linux environment and the authorized cloud instance, not a claimed local
Mac runtime pass. Native X11 input tests are not DeviceLink cross-device E2E.
Real OAuth above covers OpenAI only; other providers, model inference and backup
restoration were not repeated. No formal version tag or fleet promotion was performed.

Operator receipts, raw screenshots and infrastructure identifiers remain in the
private acceptance archive; they are deliberately excluded from this repository.
