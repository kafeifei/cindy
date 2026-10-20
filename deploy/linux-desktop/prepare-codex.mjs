import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { extractArchive, validateCodexPackageDirectory } from '/workspace/source/tools/codex-package/update.mjs';
import { writeDirDistManifest, verifyDirDistManifest } from '/workspace/source/tools/shared/dir-dist-manifest.mjs';
const archive='/workspace/codex-package-linux-x64.tar.gz';
const digest='9e2d29a713b94478b240dec2f10e11324cd05fad76dc43e7c639bdf8a1337a6b';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(sha(archive)!==digest)throw Error('archive digest mismatch');
const dir='/workspace/source/apps/codex-package-bin/linux-x64';
if(fs.existsSync(dir))throw Error('destination already exists');
fs.mkdirSync(dir,{recursive:true}); await extractArchive(archive,dir);
const v=validateCodexPackageDirectory(dir,{version:'0.159.2',target:'x86_64-unknown-linux-musl',entrypoint:'bin/codex'});
for(const p of [v.entrypointPath,v.codeModeHostPath,v.ripgrepPath])fs.chmodSync(p,0o755);
function executableTree(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())executableTree(p);else if(e.isFile())fs.chmodSync(p,0o755);}}
executableTree(v.resourcesPath);
fs.writeFileSync(v.entrypointPath+'.sha256.bin',sha(v.entrypointPath)+'\n');
fs.writeFileSync(dir+'/.asset-digest.bin',digest+'\n'); fs.writeFileSync(dir+'/.version','0.159.2\n');
writeDirDistManifest(dir);if(!verifyDirDistManifest(dir))throw Error('manifest mismatch');
console.log('Codex official package and directory manifest verified');
