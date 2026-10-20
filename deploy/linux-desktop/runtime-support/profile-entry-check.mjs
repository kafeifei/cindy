import { profileMount } from './profile-runtime-wire.mjs';
try {process.exitCode=profileMount()?0:1;}catch{process.exitCode=2;}
