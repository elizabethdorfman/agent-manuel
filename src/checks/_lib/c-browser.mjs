/**
 * Stream C test harness: runs one contract check module against a page in real Chrome.
 * It follows the contract's runner behaviour: set the viewport, settle, apply the check's
 * variants, run collect() in the page, undo the variants, then run analyze() in Node.
 */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchBrowser} from '../../cdp.mjs';

const SETTLE=`new Promise(resolve => { const wait = () => { if (document.readyState === 'complete') document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))); else setTimeout(wait, 25); }; wait(); })`;

export const toUrl=target=>/^(https?|file|data|about):/.test(target)?target:pathToFileURL(resolve(target)).href;

/** Opens one tab at the given viewport. Returns {send, close}. */
export async function openPage(browser,{url,width=390,height=844}) {
  const {targetId}=await browser.cdp.send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await browser.cdp.send('Target.attachToTarget',{targetId,flatten:true});
  const send=(method,params)=>browser.cdp.send(method,params,sessionId);
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  const loaded=browser.cdp.waitFor('Page.loadEventFired',sessionId);loaded.catch(()=>{});
  const nav=await send('Page.navigate',{url:toUrl(url)});
  if(nav.errorText)throw new Error('Navigation failed: '+nav.errorText);
  await loaded;
  await evaluate(send,SETTLE);
  return {send,viewport:{width,height},close:()=>browser.cdp.send('Target.closeTarget',{targetId})};
}

export async function evaluate(send,expression) {
  const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw new Error('Page evaluation failed: '+(r.exceptionDetails.exception?.description??r.exceptionDetails.text));
  return r.result.value;
}

/** Runs collect() (with variants applied) and analyze() for one check on an open page. */
export async function runCheckOnPage(page,check,{config={}}={}) {
  for(const v of check.variants??[])await page.send(v.method,v.params);
  let collected;
  try {
    if((check.variants??[]).length)await evaluate(page.send,SETTLE);
    collected=await evaluate(page.send,'('+check.collect.toString()+')('+JSON.stringify(config)+')');
  } finally {
    // Undo: the only variant method Stream C uses is a viewport override, so restore the page viewport.
    if((check.variants??[]).length){
      await page.send('Emulation.setDeviceMetricsOverride',{...page.viewport,deviceScaleFactor:1,mobile:false});
      await evaluate(page.send,SETTLE);
    }
  }
  const result=check.analyze(collected,{viewport:page.viewport,config});
  return {collected,result};
}

/** Launches Chrome, runs one check on one page, and cleans up. */
export async function runCheck(check,{url,width,height,config,chromePath}={}) {
  const browser=await launchBrowser({chromePath});
  try {
    const page=await openPage(browser,{url,width,height});
    return await runCheckOnPage(page,check,{config});
  } finally { await browser.cleanup(); }
}
