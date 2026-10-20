// CDP transport never binds a socket. Only the launched browser inherits these FDs.
export function cdpPipe(child) {
 let next=0,buffer=Buffer.alloc(0),closed=false;const pending=new Map();
 const close=()=>{closed=true;for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(new Error('PROFILE_CDP_CLOSED'));}pending.clear();};
 child.stdio[4].on('data',chunk=>{
 buffer=Buffer.concat([buffer,chunk]);if(buffer.length>1048576){close();child.kill('SIGTERM');return;}
 let end;while((end=buffer.indexOf(0))>=0){const bytes=buffer.subarray(0,end);buffer=buffer.subarray(end+1);
 try{const value=JSON.parse(bytes.toString());const item=pending.get(value.id);if(!item)continue;
 pending.delete(value.id);clearTimeout(item.timer);value.error?item.reject(new Error('PROFILE_CDP_REJECTED')):item.resolve(value.result);
 }catch{close();}}
 });child.stdio[4].on('error',close);child.stdio[4].on('end',close);child.on('exit',close);
 return (method,params={},sessionId)=>new Promise((resolve,reject)=>{
 if(closed){reject(new Error('PROFILE_CDP_CLOSED'));return;}
 const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('PROFILE_CDP_TIMEOUT'));},5000);
 pending.set(id,{resolve,reject,timer});
 child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0',error=>{if(error){clearTimeout(timer);pending.delete(id);reject(new Error('PROFILE_CDP_WRITE_FAILED'));}});
 });
}
