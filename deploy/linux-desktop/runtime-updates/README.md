# Cloud-managed application updates

Apply `cloudManagedUpdatesPlugin({ sourceRoot })` only when building the cloud
runtime, together with `runtime-window-controls`. Native desktop source and
ordinary builds remain unchanged. Runtime activation additionally requires Linux
and a validated instance configuration.

CIS owns cloud application upgrades. This overlay suppresses the desktop updater's
startup/background checks, staged-patch restoration, installer/relaunch paths and
automatic beta enrollment. The cloud main window does not show the automatic
release-notes dialog or desktop auto-update preference. The cloud build also omits
that preference from the static settings-search catalog, including its deep-link
aliases, in every language. Manual release history and
agent/plugin updates remain separate capabilities. No new environment variables,
stored preferences or wire protocol are introduced.

Every source anchor is checked; drift fails the build. Run the tests with
`CLOUD_UPDATE_TEST_SOURCE=/path/to/client node --test deploy/linux-desktop/runtime-updates/overlay.test.mjs`.
Verify the final cloud image before approving it for any instance. A single-instance
acceptance does not authorize changing other instances or fleet defaults.
