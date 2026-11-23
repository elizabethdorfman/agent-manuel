import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome,launchBrowser} from '../src/cdp.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const app=join(root,'examples/demo-app');
const VIEWPORT={width:390,height:844};

/** Starts serve.mjs on a random port and resolves with its base URL. */
async function startServer() {
  const child=spawn(process.execPath,[join(app,'serve.mjs'),'--port','0'],{stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{
    let out='';const timer=setTimeout(()=>reject(new Error('serve.mjs did not start.')),10000);
    child.stdout.on('data',b=>{out+=b;const m=/running at (\S+)/.exec(out);if(m){clearTimeout(timer);resolve(m[1]);}});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('serve.mjs exited '+code));});
  });
  return {url,stop:()=>{child.kill();}};
}

/** Opens a page in a fresh browser context, so sessionStorage starts empty. */
async function openPage(cdp) {
  const {browserContextId}=await cdp.send('Target.createBrowserContext');
  const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank',browserContextId});
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
  const send=(m,p)=>cdp.send(m,p,sessionId);
  await send('Page.enable');await send('Runtime.enable');await send('DOM.enable');await send('CSS.enable');
  const page={
    send,
    async viewport({width,height}){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});},
    async eval(fn,...args){
      const r=await send('Runtime.evaluate',{expression:`(${fn})(...${JSON.stringify(args)})`,awaitPromise:true,returnByValue:true});
      if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);
      return r.result.value;
    },
    async settle(){await page.eval(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});},
    async goto(url){const load=cdp.waitFor('Page.loadEventFired',sessionId);await send('Page.navigate',{url});await load;await page.settle();},
    /** Clicks a selector; waits for the next page load when the click navigates. */
    async click(selector,{navigates=false}={}){
      const load=navigates?cdp.waitFor('Page.loadEventFired',sessionId):null;
      await page.eval(s=>{const el=document.querySelector(s);if(!el)throw new Error('missing '+s);el.click();},selector);
      if(load)await load;
      await page.settle();
    },
    async fill(selector,value){await page.eval((s,v)=>{const el=document.querySelector(s);el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},selector,value);},
    async key(key,code,keyCode){
      for(const type of ['rawKeyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:keyCode});
      await page.settle();
    },
    async screenshot(file){const {data}=await send('Page.captureScreenshot',{format:'png'});await writeFile(file,Buffer.from(data,'base64'));},
    close:()=>cdp.send('Target.disposeBrowserContext',{browserContextId}),
  };
  await page.viewport(VIEWPORT);
  return page;
}

const ENTRY='Bought a $4.50 latte and saved $20 for a trip. QA-SYNTHETIC';
/** How to reach each state from a fresh context, by clicking through the app. */
const reach={
  welcome:async(p,base)=>{await p.goto(base+'index.html');},
  terms:async(p,base)=>{await reach.welcome(p,base);await p.click('#terms-link',{navigates:true});},
  login:async(p,base)=>{await reach.welcome(p,base);await p.click('#log-in',{navigates:true});},
  'login-error':async(p,base)=>{await reach.login(p,base);await p.fill('#login-email','qa@example.com');await p.click('#login-submit');},
  editor:async(p,base)=>{await reach.welcome(p,base);await p.click('#get-started',{navigates:true});},
  'editor-error':async(p,base)=>{await reach.editor(p,base);await p.click('#review-amounts');},
  consent:async(p,base)=>{await reach.editor(p,base);await p.fill('#journal-entry',ENTRY);await p.click('#review-amounts');},
  review:async(p,base)=>{await reach.consent(p,base);await p.click('#consent-decline',{navigates:true});},
  'review-edit':async(p,base)=>{await reach.review(p,base);await p.click('#edit-1');},
  done:async(p,base)=>{await reach.review(p,base);await p.click('#looks-right',{navigates:true});},
};

/** Runs in the page: what a visitor sees right now. */
function snapshot(selectors) {
  const visible=el=>{
    if(!el)return false;
    const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&Number(cs.opacity)>0&&el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
  };
  const h1=[...document.querySelectorAll('h1')].find(visible);
  const dialog=document.querySelector('dialog[open]');
  return {
    path:location.pathname,
    heading:h1?.textContent.trim()??null,
    dialog:dialog?dialog.querySelector('h2')?.textContent.trim():null,
    scrollWidth:document.documentElement.scrollWidth,
    selectors:Object.fromEntries(selectors.map(s=>{const el=document.querySelector(s);return [s,{exists:!!el,visible:visible(el)}];})),
  };
}

/** Runs in the page: the measurements behind each planted bug and look-alike. */
function measure() {
  const q=s=>document.querySelector(s);
  const rect=s=>{const r=q(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};};
  const lum=c=>{const [r,g,b]=c.match(/\d+(\.\d+)?/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*r+0.7152*g+0.0722*b;};
  const contrast=s=>{const l=lum(getComputedStyle(q(s)).color),w=1;return (Math.max(l,w)+0.05)/(Math.min(l,w)+0.05);};
  const out={};
  for(const s of ['#welcome-fineprint','#welcome-title','#journal-error'])if(q(s)?.checkVisibility())out[s]={contrast:contrast(s),fontSize:parseFloat(getComputedStyle(q(s)).fontSize),fontWeight:Number(getComputedStyle(q(s)).fontWeight)};
  for(const s of ['#entry-date','#journal-entry','#editor-title','#journal-tips li','#edit-close','#edit-save','#remove-1','#country-us-row','#done-receipt','#review-heading','#review-total-title','#consent-allow','#consent-decline'])if(q(s)?.checkVisibility())out[s]=rect(s);
  for(const s of ['#login-email','#login-password','#review-heading','#review-total-title'])if(q(s)?.checkVisibility())out[s]={...out[s],fontSize:parseFloat(getComputedStyle(q(s)).fontSize),fontWeight:Number(getComputedStyle(q(s)).fontWeight)};
  const label=q('#agree-label');if(label?.checkVisibility())out['#agree-label']={scrollWidth:label.scrollWidth,clientWidth:label.clientWidth};
  const chips=q('#done-chips');if(chips?.checkVisibility())out['#done-chips']={scrollWidth:chips.scrollWidth,clientWidth:chips.clientWidth,overflowX:getComputedStyle(chips).overflowX};
  for(const s of ['#consent-allow','#consent-decline'])if(q(s)?.checkVisibility())out[s].background=getComputedStyle(q(s)).backgroundColor;
  return out;
}

test('The Penny Jar demo app reaches every state, shows every labelled selector and renders each planted bug.',async t=>{
  if(!await findChrome()){t.skip('Chrome was not found; set CHROME_BIN to run the demo app test.');return;}
  const {bugs}=JSON.parse(await readFile(join(app,'bugs.json'),'utf8'));
  const flows=JSON.parse(await readFile(join(app,'flows.json'),'utf8'));
  const server=await startServer();
  const {cdp,cleanup}=await launchBrowser();
  const shots=join(app,'screens');await mkdir(shots,{recursive:true});
  try {
    // The answer key and the flow graph agree with each other.
    for(const b of bugs){
      assert(flows.states[b.state],`bugs.json state ${b.state} is in flows.json`);
      assert(['fail','review','none'].includes(b.expected));
      assert.equal(b.expected==='none',!b.planted,`${b.selector} ${b.checkId}: look-alikes expect none, planted bugs expect a finding`);
    }
    for(const e of flows.edges)assert(e.to===null||flows.states[e.to],`edge target ${e.to}`);

    const measured={};
    for(const [state,spec] of Object.entries(flows.states)) {
      await t.test(state,async()=>{
        const page=await openPage(cdp);
        try {
          await reach[state](page,server.url);
          const selectors=bugs.filter(b=>b.state===state).map(b=>b.selector).concat(spec.marker?[spec.marker]:[]);
          const snap=await page.eval(snapshot,selectors);
          assert.equal(snap.path,spec.url);
          assert.equal(snap.heading,spec.heading);
          assert.equal(snap.dialog,spec.dialog??null);
          assert(snap.scrollWidth<=VIEWPORT.width,`${state} must not scroll sideways at 390px (scrollWidth ${snap.scrollWidth})`);
          for(const [s,v] of Object.entries(snap.selectors)){assert(v.exists,`${state}: ${s} exists`);assert(v.visible,`${state}: ${s} is visible`);}
          if(spec.text)assert.equal(await page.eval(s=>document.querySelector(s).textContent.trim(),spec.marker),spec.text);
          Object.assign(measured,await page.eval(measure));
          await page.screenshot(join(shots,state+'.png'));

          if(state==='welcome'){
            // The wordmark falls back: Chrome does not render the declared "Penny Rounded".
            const {root:doc}=await page.send('DOM.getDocument');
            const {nodeId}=await page.send('DOM.querySelector',{nodeId:doc.nodeId,selector:'#brand-name'});
            const {fonts}=await page.send('CSS.getPlatformFontsForNode',{nodeId});
            assert(fonts.length>0&&fonts.every(f=>f.familyName!=='Penny Rounded'),'wordmark renders in a fallback font');
            measured.brandFonts=fonts.map(f=>f.familyName);
          }
          if(state==='consent'){
            // FL02: the first Tab lands on "Don't send", before the required fields.
            await page.key('Tab','Tab',9);
            assert.equal(await page.eval(()=>document.activeElement.id),'consent-decline');
            // Browser Back returns to the editor on the same URL.
            await page.eval(()=>{history.back();});
            await new Promise(r=>setTimeout(r,200));await page.settle();
            const back=await page.eval(snapshot,[]);
            assert.equal(back.heading,flows.states.editor.heading);
            assert.equal(back.path,spec.url);
          }
          if(state==='done'){
            // UI01: fits at 390px, overflows at 320px.
            await page.viewport({width:320,height:844});await page.settle();
            const narrow=await page.eval(()=>({scrollWidth:document.documentElement.scrollWidth,right:document.querySelector('#done-receipt').getBoundingClientRect().right}));
            assert(narrow.scrollWidth>320&&narrow.right>320,`receipt overflows at 320px (${JSON.stringify(narrow)})`);
            await page.screenshot(join(shots,'done-320.png'));
          }
        } finally { await page.close(); }
      });
    }

    await t.test('planted measurements',()=>{
      const m=measured;
      assert(m['#welcome-fineprint'].contrast<4.5,'fineprint contrast fails');
      assert(m['#welcome-title'].contrast>=3&&m['#welcome-title'].contrast<4.5&&m['#welcome-title'].fontSize>=24,'large heading passes at 3:1');
      assert(m['#journal-error'].contrast<4.5&&m['#journal-error'].fontSize<18.66,'error text contrast fails');
      const column=m['#editor-title'].x;
      assert.equal(column,24);
      assert(Math.abs(m['#entry-date'].x-column-5)<0.5,`date field is 5px off the column (${m['#entry-date'].x})`);
      assert.equal(m['#journal-entry'].x,column);
      assert(Math.abs(m['#journal-tips li'].x-column-20)<0.5,'tips list is indented 20px');
      assert(m['#agree-label'].scrollWidth>m['#agree-label'].clientWidth,'agreement label is clipped');
      for(const s of ['#consent-allow','#consent-decline'])assert(!['rgba(0, 0, 0, 0)','rgb(255, 255, 255)'].includes(m[s].background),`${s} is a filled button`);
      assert(Math.abs(m['#consent-decline'].height-m['#consent-allow'].height)<1&&m['#consent-decline'].width===m['#consent-allow'].width,'buttons compete at the same size');
      assert(m['#country-us-row'].height>=44);
      assert(m['#review-total-title'].fontSize>m['#review-heading'].fontSize,'h3 renders larger than the h2');
      assert(m['#remove-1'].width>=44&&m['#remove-1'].height>=44);
      assert.equal(m['#edit-close'].width,16);assert.equal(m['#edit-close'].height,16);
      assert(m['#edit-save'].height>=44);
      assert(m['#done-receipt'].right<=VIEWPORT.width);
      assert(m['#done-chips'].scrollWidth>m['#done-chips'].clientWidth&&m['#done-chips'].overflowX==='auto','chips scroll inside their box');
      assert.equal(m['#login-email'].fontSize,14);
      assert.equal(m['#login-password'].fontSize,16);
    });
  } finally { await cleanup(); server.stop(); }
});
