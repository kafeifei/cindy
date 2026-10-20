# CN source image acceptance — 2026-10-20

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
| Fresh OpenAI OAuth, local callback and cloud credential writeback | Pending; no fresh authorization was initiated |
| DeviceLink live frames, mouse and keyboard through the remote viewer | Pending; no cross-device input result was obtained |

The controlling Mac was screen-locked. The isolated client process started, but
its renderer was not available for interaction; a macOS SecurityAgent process
also appeared during startup. The existing remote viewer showed a disconnecting
state, which is not evidence of a new connection or a runtime regression. User
unlock is required before continuing the product-entry checks. No screen-lock
or credential protection was bypassed. These pending checks do not inherit a
pass from the earlier native X11 or synthetic authorization-browser tests.

Completion requires observing a fresh OpenAI operation reach success, connected
status after reloading cloud settings, and cleanup of its owned browser tabs and
login process. DeviceLink acceptance requires input through the actual macOS
viewer and independently observed changes on the cloud desktop, with live frame
updates. A macOS-to-cloud pass would not establish iPhone-to-cloud acceptance.

## Limits

The local Rosetta runtime attempt stopped at `INSTANCE_SECCOMP_UNAVAILABLE`;
sandboxing was not weakened. Runtime acceptance therefore uses the isolated
native Linux environment and the authorized cloud instance, not a claimed local
Mac runtime pass. Native X11 input tests are not DeviceLink cross-device E2E.
This run did not repeat third-party OAuth token exchange, model inference or
backup restoration. No formal version tag or fleet promotion was performed.

Operator receipts, raw screenshots and infrastructure identifiers remain in the
private acceptance archive; they are deliberately excluded from this repository.
