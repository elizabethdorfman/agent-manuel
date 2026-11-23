import {spawn} from 'node:child_process';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export class CDP {
  constructor(socket) {
    this.socket=socket;this.next=1;this.pending=new Map();this.events=new Map();
    socket.addEventListener('message',event=>{
      const msg=JSON.parse(String(event.data));
      if(!msg.id){
        const key=(msg.sessionId??'')+':'+msg.method;
        const listeners=this.events.get(key)??[];
        this.events.delete(key);
        for(const p of listeners){clearTimeout(p.timer);p.resolve(msg.params);}
        return;
      }
      const p=this.pending.get(msg.id);if(!p)return;
      this.pending.delete(msg.id);clearTimeout(p.timer);
      msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result);
    });
    socket.addEventListener('close',()=>{
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Browser connection closed.'));}
      this.pending.clear();
      for(const listeners of this.events.values())for(const p of listeners){clearTimeout(p.timer);p.reject(new Error('Browser connection closed.'));}
      this.events.clear();
    });
  }
  static async connect(url) {
    const socket=new WebSocket(url);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(new Error('Browser connection failed.')),{once:true});});
    return new CDP(socket);
  }
  send(method,params={},sessionId) {
    const id=this.next++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(method+' timed out.'));},20000);
      this.pending.set(id,{resolve,reject,timer});
      this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  waitFor(method,sessionId) {
    const key=(sessionId??'')+':'+method;
    return new Promise((resolve,reject)=>{
      const entry={resolve,reject,timer:null};
      entry.timer=setTimeout(()=>{this.events.set(key,(this.events.get(key)??[]).filter(p=>p!==entry));reject(new Error(method+' timed out.'));},20000);
      this.events.set(key,[...(this.events.get(key)??[]),entry]);
    });
  }
  close(){this.socket.close();}
}
export async function launchBrowser({chromePath,noSandbox=false}={}) {
  const candidates=[chromePath,process.env.CHROME_BIN,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  let binary;
  for(const file of candidates)try{await access(file);binary=file;break;}catch{}
  if(!binary)throw new Error('Chrome was not found. Set CHROME_BIN to its executable path.');
  const profile=await mkdtemp(join(tmpdir(),'qa-evidence-'));
  const child=spawn(binary,['--headless=new','--no-first-run','--disable-dev-shm-usage','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,...(noSandbox?['--no-sandbox']:[]),'about:blank'],{stdio:['ignore','ignore','pipe']});
  const cleanup=async()=>{
    if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const t=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);child.once('exit',()=>{clearTimeout(t);resolve();});});}
    await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:50});
  };
  try {
    const url=await new Promise((resolve,reject)=>{
      let stderr='';const timer=setTimeout(()=>reject(new Error('Chrome did not expose its debugging endpoint.')),15000);
      child.stderr.on('data',buf=>{stderr=(stderr+buf.toString()).slice(-10000);const match=/DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr);if(match){clearTimeout(timer);resolve(match[1]);}});
      child.once('error',e=>{clearTimeout(timer);reject(e);});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error('Chrome exited before startup ('+code+'). '+stderr.slice(-1200)));});
    });
    const cdp=await CDP.connect(url);
    return {cdp,cleanup:async()=>{cdp.close();await cleanup();}};
  }catch(e){await cleanup();throw e;}
}
