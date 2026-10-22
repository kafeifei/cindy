// Run under the exact, checksum-locked Electron used to package the application.
// The shipped Cindy fuse stays unchanged; no debug entry is added to the product.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [electron, packaged, output] = process.argv.slice(2);
if (!electron || !packaged || !output) throw Error('NATIVE_PROBE_ARGUMENTS');
const program = `
const root=process.argv[1]+'/resources/app.asar/node_modules/';
const Database=require(root+'better-sqlite3');
const db=new Database(':memory:');
if(db.prepare('select 42 as value').get().value!==42)throw Error('SQLITE_NATIVE_FAILED');
db.close();
const pty=require(root+'node-pty').spawn('/bin/sh',['-c','printf CINDY_PTY_OK'],{cwd:'/tmp',env:{TERM:'xterm',PATH:'/usr/bin:/bin'}});
let data='', exitCode=null;
const timer=setTimeout(()=>{pty.kill();process.exit(2)},5000);
function complete(){
  if(exitCode===null)return;
  if(exitCode!==0){clearTimeout(timer);process.exit(3)}
  if(!data.includes('CINDY_PTY_OK'))return;
  clearTimeout(timer);
  console.log(JSON.stringify({passed:true,sqlite:true,pty:true,electronVersion:process.versions.electron,abi:process.versions.modules}));
}
pty.onData(chunk=>{data+=chunk;complete()});
pty.onExit(result=>{exitCode=result.exitCode;complete()});
`;

const result = spawnSync(electron, ['-e', program, path.resolve(packaged)], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 10000,
});
if (result.status !== 0) throw Error(`PACKAGED_NATIVE_PROBE_FAILED:${result.stderr}`);
const proof = JSON.parse(result.stdout.trim());
if (!proof.passed || proof.electronVersion !== '42.11.12') throw Error('PACKAGED_NATIVE_ABI_MISMATCH');
fs.writeFileSync(output, JSON.stringify(proof));
console.log('PACKAGED_SQLITE_PTY_VERIFIED');
