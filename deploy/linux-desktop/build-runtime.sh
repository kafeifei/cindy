#!/bin/sh
set -eu
cd /workspace/source
export TAR_OPTIONS=--no-same-owner
export CI=1 NODE_OPTIONS=--max-old-space-size=6144
export CINDY_AUTH_REGION=cn VITE_CINDY_AUTH_REGION=cn APP_VERSION=0.1.108
export PATH=/workspace/sysroot/usr/bin:$PATH
export PKG_CONFIG_SYSROOT_DIR=/workspace/sysroot
export PKG_CONFIG_LIBDIR=/workspace/sysroot/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig
export LD_LIBRARY_PATH=/workspace/sysroot/usr/lib/x86_64-linux-gnu
cd /workspace/debs
apt-get -o APT::Sandbox::User=root download libxkbcommon0=1.5.0-1 libwayland-client0=1.21.0-1
for f in libxkbcommon0_*.deb libwayland-client0_*.deb; do dpkg-deb -x "$f" /workspace/sysroot; done
cd /workspace/source
# Overlays resolve typescript from the frozen client workspace.
test -e /workspace/recipe/node_modules || ln -s /workspace/source/node_modules /workspace/recipe/node_modules
node /workspace/recipe/stage-cloud-overlays.mjs
pnpm --filter desktop package --platform=linux --arch=x64
mkdir -p /workspace/artifact
pnpm --filter desktop exec esbuild src/main/instance-runtime/profile-maintenance-context.ts --bundle --platform=node --format=esm --outfile=/workspace/artifact/profile-maintenance-context.mjs
pnpm --filter desktop exec esbuild src/main/instance-runtime/profile-runtime-wire.ts --bundle --platform=node --format=esm --outfile=/workspace/artifact/profile-runtime-wire.mjs
test ! -e /workspace/artifact/cindy
cp -a apps/desktop/out/Cindy-linux-x64 /workspace/artifact/cindy
chmod -R a+rX /workspace/artifact
printf 'CLOUD_PACKAGE_COMPLETE\n'
