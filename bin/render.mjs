#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {analyzeAlignment} from '../src/analyze.mjs';
import {renderReport} from '../src/render.mjs';
const args=process.argv.slice(2),opts={};
for(let i=0;i<args.length;i++){
  if(!['--evidence','--screenshot','--rules','--out'].includes(args[i])||args[i+1]===undefined)throw new Error('Unknown or incomplete argument: '+args[i]);
  opts[args[i].slice(2)]=args[++i];
}
if(!opts.evidence||!opts.screenshot)throw new Error('Supply --evidence capture.json and --screenshot capture.png or capture.jpg.');
const bundle=JSON.parse(await readFile(resolve(opts.evidence),'utf8'));
const snapshot=bundle.snapshot??bundle;
const config=opts.rules?JSON.parse(await readFile(resolve(opts.rules),'utf8')):{};
const analysis=analyzeAlignment(snapshot,{rules:Array.isArray(config)?config:config.rules??[]});
const image=await readFile(resolve(opts.screenshot));
if(!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && !(image[0]===255&&image[1]===216))throw new Error('Supply a PNG or JPEG screenshot.');
const out=resolve(opts.out??'artifacts/rendered');await mkdir(out,{recursive:true});
const html=renderReport(snapshot,analysis,image.toString('base64'));
await writeFile(join(out,'report.html'),html);
await writeFile(join(out,'annotations.svg'),html.match(/<svg[\s\S]*?<\/svg>/)[0]);
await writeFile(join(out,'evidence.json'),JSON.stringify({snapshot,alignment:analysis},null,2)+'\n');
console.log(JSON.stringify({out,...analysis.summary,status:analysis.status},null,2));
