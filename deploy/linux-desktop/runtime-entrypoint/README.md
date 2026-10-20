# Cloud runtime entrypoint

`cindy-linux-desktop` is the container's PID 1 in the cloud runtime image. It
starts the session bus, the keyring (managed instances), Xvfb, openbox and then
the application (directly, or through `profile-supervisor.mjs`).

The file was previously carried only inside the image base layer
(sha256 `74b945114911aae5c675970a59d4f34bc05646fabb71af9cc211f7981f824914`).
It is now maintained here; the only change is the shutdown order.

## Shutdown order

The original `cleanup` sent TERM to every child at once. The application lost
its display, bus and keyring while running its quit chain and crashed, so a
stopped instance never completed an orderly shutdown and the maintenance
overlay never issued clean-shutdown evidence. Now:

1. TERM to the application; wait up to 45 s (Pod grace period is 60 s), then KILL.
2. Only then stop openbox, Xvfb, the keyring and the bus, up to 5 s each.

## Packaging

Ship it in the application layer together with `/opt/cindy` (one `COPY`), as
`/usr/local/bin/cindy-linux-desktop`, owned by root, mode 0755. Do not add a
separate layer for it.

## Qualification

`shutdown-order.test.sh <wrapper>` replaces the dependencies with stubs and
asserts the order; it needs bash ≥ 5.1 and python3 (the runtime image has both)
and runs via `node --test deploy/linux-desktop/runtime-entrypoint/entrypoint.test.mjs`
from the client repository root where available. On a real instance, an
orderly maintenance stop must leave
`/var/lib/cindy/user-data/.cis-maintenance/shutdown.json`.
