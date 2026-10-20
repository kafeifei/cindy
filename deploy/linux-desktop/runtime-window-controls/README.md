# Cloud main-window controls

This cloud-only Vite packaging overlay keeps the Linux cloud runtime's Cindy main
window available. For Xfce/Plank images it hides close and guards main-window close IPC and
window-manager events. Minimize, taskbar restore, maximize and orderly shutdown
remain available. These sources require a working taskbar/Dock; old Openbox
images used a different minimize policy. Browser authorization windows and auxiliary Cindy windows are untouched.

The overlay never writes to the native client checkout and is not imported by
ordinary client builds. Include `cloudMainWindowControlsPlugin({ sourceRoot })`
only when packaging a cloud image. It uses the existing instance configuration;
there is no new environment variable, remote protocol, credential or data change.
Each source integration point is checked for uniqueness; source drift stops the
build instead of silently shipping a partial patch.

Run the policy tests with `node --test deploy/linux-desktop/runtime-window-controls/overlay.test.mjs`.
Set `CLOUD_WINDOW_TEST_SOURCE` to a native source checkout to additionally validate
and compile all transformed integration points. Review the cloud image diff,
ordinary-client source hashes, auxiliary-window behavior and graceful shutdown
before enabling it on an instance. Rollout scope is controlled by instance image
approval; do not change the fleet default as part of a single-instance acceptance.
