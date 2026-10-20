# Cloud maintenance build

This overlay is maintained in the client image sources and applied only when packaging a cloud
runtime. It does not modify the ordinary desktop source or credential migration
v3. Include `runtime-activity/overlay.mjs` before this plugin in the existing
desktop main-process Vite build.

Pass `expectedRegion: 'cn'` or `'global'` explicitly to
`cloudMaintenancePlugin`. The resolved main-process
`import.meta.env.VITE_CINDY_AUTH_REGION` definition must match. Use the existing
desktop build recipe's region configuration for all entries; rebuilding only
main with implicit defaults can produce a region that differs from the preserved
renderer and mounted endpoint manifest. The plugin rejects that build before
packaging. Never patch the deployed endpoint manifest to accommodate a wrongly
built application.

The former on-volume `maintenance-backup.py` helper is retired: do not package
or invoke it. Existing recovery archives are left untouched. Pre-upgrade backups,
when `upgradeBackup` is configured, run from CIS in a separate stopped-volume Pod.
This overlay supplies their precondition: it wires the desktop quit chain
(`lifecycle.ts`) so that a fault-free, orderly quit of a sealed operation writes
`/var/lib/cindy/user-data/.cis-maintenance/shutdown.json`. Roll this image out to
every instance before enabling `upgradeBackup` (see the service document).
Build the dependency base and application from the complete committed Dockerfile
chain and recorded source inputs; do not use an exported old runtime as the base.
Preserve native unpack flags,
preload/worker assets and the release's configured region.

Run the overlay tests against the actual target client checkout using
`CINDY_ACTIVITY_TEST_SOURCE`.
Qualify the packaged artifact in an isolated Linux environment. Synthetic
credential/preflight and `--smoke-test` checks do not exercise normal cloud
startup; the admitted instance must also pass normal startup against its existing
endpoint manifest, canonical account, device identity and sandbox evidence.

The mount qualification, persistent ledger and
explicit single-instance execution contract are documented in
the CIS service contract (`docs/cloud-instance-server.md` in the server repository).
The web API remains a configuration preview until an automatic worker is
separately qualified and enabled.
