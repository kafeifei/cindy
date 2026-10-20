#!/bin/sh
set -eu
cd /workspace/source
export TAR_OPTIONS=--no-same-owner
test -d apps/codex-package-bin/linux-x64 || node /workspace/recipe/prepare-codex.mjs
test -d apps/pi-bin/linux-x64 || node /workspace/recipe/prepare-other-assets.mjs
# Offline Electron asset is pinned and verified against official release checksums.
printf '%s  %s\n' '1f17c115389c6395ce4b19b29ee2ec4be2208257514d61e269f1c0a7323bd45d' '/workspace/electron-v42.11.12-linux-x64.zip' | sha256sum -c -
node - <<'JS'
const fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('node_modules/electron/install.js'));
const {extract}=req('@electron-internal/extract-zip');
(async()=>{
 await extract('/workspace/electron-v42.11.12-linux-x64.zip',{dir:path.resolve('node_modules/electron/dist')});
 const dir=path.resolve('node_modules/electron');
 if(fs.existsSync(dir+'/dist/electron.d.ts'))fs.renameSync(dir+'/dist/electron.d.ts',dir+'/electron.d.ts');
 fs.writeFileSync(dir+'/path.txt','electron');
 if(fs.readFileSync(dir+'/dist/version','utf8').replace(/^v/,'')!=='42.11.12')throw Error('Electron version mismatch');
})().catch(e=>{console.error(e);process.exit(1)});
JS
CI=1 npm_config_nodedir=/usr/local pnpm install --frozen-lockfile
apt-get -o APT::Sandbox::User=root update
cd /workspace/debs
apt-get -o APT::Sandbox::User=root download \
  libjson-c-dev=0.16-2 libjson-c5=0.16-2 \
  libturbojpeg0-dev=1:2.1.5-2 libturbojpeg0=1:2.1.5-2 \
  libxkbcommon-dev=1.5.0-1 libxkbcommon0=1.5.0-1 \
  libwayland-dev=1.21.0-1 libwayland-bin=1.21.0-1 libwayland-client0=1.21.0-1 \
  libpng-dev=1.6.39-2+deb12u5 libpng16-16=1.6.39-2+deb12u5 libpng-tools=1.6.39-2+deb12u5
for f in *.deb; do dpkg-deb -x "$f" /workspace/sysroot; done
mkdir -p /root/.cache/node-gyp/42.11.12 /root/.electron-gyp/42.11.12
tar --no-same-owner -xzf /workspace/electron-v42.11.12-headers.tar.gz -C /root/.cache/node-gyp/42.11.12 --strip-components=1
printf '11\n' > /root/.cache/node-gyp/42.11.12/installVersion
cp -a /root/.cache/node-gyp/42.11.12/. /root/.electron-gyp/42.11.12/
printf 'PREPARED_0108\n'
