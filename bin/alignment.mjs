#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchBrowser} from '../src/cdp.mjs';
import {collectEvidence} from '../src/collect.mjs';
import {analyzeAlignment} from '../src/analyze.mjs';
import {renderReport} from '../src/render.mjs';

const args=process.argv.slice(2), opts={};
for(let i=0;i<args.length;i++) {
  const k=args[i];
  if(k==='--no-sandbox'||k==='--viewport-only'){opts[k.slice(2)]=true;continue;}
  if(!['--url','--out','--rules','--width','--height','--chrome','--tolerance'].includes(k)||args[i+1]===undefined)throw new Error('Unknown or incomplete argument: '+k);
  opts[k.slice(2)]=args[++i];
}
if(!opts.url){console.error('Usage: node bin/alignment.mjs --url URL_OR_HTML_FILE [--rules rules.json] [--out artifacts/alignment] [--width 390] [--height 844]');process.exitCode=2;}
else {
  const width=Number(opts.width??390),height=Number(opts.height??844),tolerance=Number(opts.tolerance??2);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<240||width>4000||height<240||height>4000)throw new Error('Width and height must be integer CSS pixel sizes between 240 and 4000.');
  const ruleConfig=opts.rules?JSON.parse(await readFile(resolve(opts.rules),'utf8')):{};
  const rules=Array.isArray(ruleConfig)?ruleConfig:ruleConfig.rules??[];
  if(!Array.isArray(rules)||new Set(rules.map(r=>r.id)).size!==rules.length||rules.some(r=>!r.id||!Array.isArray(r.selectors)))throw new Error('Rules need unique IDs and selector arrays.');
  const url=/^https?:\/\//.test(opts.url)?opts.url:pathToFileURL(resolve(opts.url)).href;
  const out=resolve(opts.out??'artifacts/alignment');await mkdir(out,{recursive:true});
  const browser=await launchBrowser({chromePath:opts.chrome,noSandbox:opts['no-sandbox']});
  try {
    const {targetId}=await browser.cdp.send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await browser.cdp.send('Target.attachToTarget',{targetId,flatten:true});
    const send=(method,params)=>browser.cdp.send(method,params,sessionId);
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const loaded=browser.cdp.waitFor('Page.loadEventFired',sessionId);
    loaded.catch(()=>{});
    const navigation=await send('Page.navigate',{url});
    if(navigation.errorText)throw new Error('Navigation failed: '+navigation.errorText);
    await loaded;
    const ready=await send('Runtime.evaluate',{expression:`new Promise(resolve => { const wait = () => { if(document.readyState === 'complete') document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))) ; else setTimeout(wait,25); }; wait(); })`,awaitPromise:true,returnByValue:true});
    if(ready.exceptionDetails)throw new Error('The page did not settle.');
    const data=await send('Runtime.evaluate',{expression:'('+collectEvidence.toString()+')('+JSON.stringify({rules,fullPage:!opts['viewport-only']})+')',awaitPromise:true,returnByValue:true});
    if(data.exceptionDetails)throw new Error('DOM collection failed: '+data.exceptionDetails.text);
    const snapshot=data.result.value;
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{...snapshot.capture,scale:1}});
    const verification=await send('Runtime.evaluate',{expression:'JSON.stringify({width:innerWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight})',returnByValue:true});
    const after=JSON.parse(verification.result.value);
    if(after.width!==snapshot.viewport.width||after.height!==snapshot.viewport.height) snapshot.warnings.push('Viewport changed during capture; recapture before reviewing geometry.');
    const analysis=analyzeAlignment(snapshot,{rules,tolerance});
    const version=await browser.cdp.send('Browser.getVersion');
    snapshot.browser={product:version.product,protocolVersion:version.protocolVersion};
    await writeFile(join(out,'screenshot.png'),Buffer.from(shot.data,'base64'));
    await writeFile(join(out,'evidence.json'),JSON.stringify({snapshot,alignment:analysis},null,2)+'\n');
    const html=renderReport(snapshot,analysis,shot.data);
    await writeFile(join(out,'report.html'),html);
    await writeFile(join(out,'annotations.svg'),html.match(/<svg[\s\S]*?<\/svg>/)[0]);
    console.log(JSON.stringify({out,viewport:snapshot.viewport,...analysis.summary,status:analysis.status},null,2));
  }finally{await browser.cleanup();}
}
