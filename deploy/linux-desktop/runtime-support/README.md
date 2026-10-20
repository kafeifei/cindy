# Runtime programs

These tracked sources implement the existing non-root seccomp entry, health
probe, managed keyring checks and profile maintenance/preflight commands. Their
initial bytes are recorded in `source-sha256.json`; the source build installs
them directly and builds the context/wire bundles from the frozen client source.
No previous Cindy image supplies executable build inputs.

`chromium-compat` preserves `/usr/bin/chromium` for the frozen authorization
browser/CDP code while forwarding its unchanged arguments to the pinned Google
Chrome. The slim base removes only the duplicate Chromium packages. Sandbox
flags, private debugging pipes and authorization cleanup remain unchanged.
