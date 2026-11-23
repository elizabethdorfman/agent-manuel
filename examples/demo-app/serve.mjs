#!/usr/bin/env node
// Tiny static server for the Penny Jar demo app.
//   node examples/demo-app/serve.mjs [--port 4173] [--host 127.0.0.1]
// --port 0 picks a free port. The first stdout line is "Penny Jar running at <url>".
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};

/** Starts the server and resolves with { server, url, port, close }. */
export function startServer({port=4173,host='127.0.0.1'}={}) {
  const server=createServer(async(req,res)=>{
    try {
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
      let path=decodeURIComponent(new URL(req.url,'http://x').pathname);
      if(path.endsWith('/'))path+='index.html';
      const file=normalize(join(root,path));
      if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return;}
      const body=await readFile(file);
      res.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream','cache-control':'no-store'});
      res.end(req.method==='HEAD'?undefined:body);
    }catch{res.writeHead(404,{'content-type':'text/plain; charset=utf-8'}).end('Not found');}
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,host,()=>{
      const actual=server.address().port;
      resolve({server,port:actual,url:`http://${host}:${actual}/`,close:()=>new Promise(r=>server.close(()=>r()))});
    });
  });
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===normalize(process.argv[1])) {
  const arg=name=>{const i=process.argv.indexOf('--'+name);return i>0?process.argv[i+1]:undefined;};
  const port=Number(arg('port')??process.env.PORT??4173);
  const {url}=await startServer({port,host:arg('host')??'127.0.0.1'});
  console.log('Penny Jar running at '+url);
}
