// Penny Jar demo app. All state lives in sessionStorage, so a fresh browser context starts clean.
const store={
  get(k,d){try{const v=sessionStorage.getItem('pj:'+k);return v===null?d:JSON.parse(v);}catch{return d;}},
  set(k,v){try{sessionStorage.setItem('pj:'+k,JSON.stringify(v));}catch{}},
  clear(){try{Object.keys(sessionStorage).filter(k=>k.startsWith('pj:')).forEach(k=>sessionStorage.removeItem(k));}catch{}},
};
const SAMPLE=[{label:'Latte',amount:4.5,kind:'spent'},{label:'Trip fund',amount:20,kind:'saved'},{label:'Groceries',amount:38.2,kind:'spent'}];
/** Pulls "$4.50"-style amounts and the word before each one out of a journal entry. */
function parseAmounts(text){
  const out=[];const re=/\$\s?(\d+(?:\.\d{1,2})?)/g;let m;
  while((m=re.exec(text))){
    const before=text.slice(0,m.index).trim().split(/\s+/).slice(-3).join(' ').replace(/^(a|an|the)\s+/i,'');
    const after=text.slice(re.lastIndex).split(/[.,!;]|\s(?:and|but|then)\s/i)[0].trim().split(/\s+/).slice(0,3).join(' ');
    const saved=/sav|put aside|stash/i.test(before);
    const label=(saved?after.replace(/^(for|to)\s+(a\s+)?/i,''):after.replace(/^(on|for)\s+/i,''))||'Amount';
    out.push({label:label.charAt(0).toUpperCase()+label.slice(1),amount:Number(m[1]),kind:saved?'saved':'spent'});
  }
  return out;
}
const money=n=>'$'+n.toFixed(2);
const $=s=>document.querySelector(s);

/* ---------- Journal editor + consent (one URL, two views) ---------- */
function initJournal(){
  const editor=$('#view-editor'),consent=$('#view-consent'),entry=$('#journal-entry'),error=$('#journal-error');
  entry.value=store.get('entry','');
  const show=view=>{
    editor.hidden=view!=='editor';consent.hidden=view!=='consent';
    document.title=view==='consent'?'Before we read it · Penny Jar':'New entry · Penny Jar';
    window.scrollTo(0,0);
  };
  show(history.state?.view==='consent'?'consent':'editor');
  window.addEventListener('popstate',e=>show(e.state?.view==='consent'?'consent':'editor'));
  entry.addEventListener('input',()=>{store.set('entry',entry.value);if(entry.value.trim())error.hidden=true;});
  $('#editor-form').addEventListener('submit',e=>{
    e.preventDefault();
    if(!entry.value.trim()){error.hidden=false;entry.setAttribute('aria-invalid','true');entry.focus();return;}
    entry.removeAttribute('aria-invalid');
    store.set('entry',entry.value);
    history.pushState({view:'consent'},'');
    show('consent');
  });
  $('#consent-form').addEventListener('submit',e=>{
    e.preventDefault();
    const amounts=parseAmounts(store.get('entry',''));
    store.set('amounts',amounts.length?amounts:SAMPLE);
    store.set('consent','allowed');
    location.href='review.html';
  });
  $('#consent-decline').addEventListener('click',()=>{
    store.set('consent','declined');
    const amounts=parseAmounts(store.get('entry',''));
    store.set('amounts',amounts.length?amounts:SAMPLE);
    location.href='review.html';
  });
}

/* ---------- Review ---------- */
function initReview(){
  let amounts=store.get('amounts',null)??SAMPLE;
  const list=$('#review-list'),dialog=$('#edit-dialog');let editing=-1;
  $('#review-banner').textContent=store.get('consent','')==='declined'
    ?'Checked on your device. Nothing was sent.':'We found these amounts in your entry.';
  const render=()=>{
    list.innerHTML='';
    amounts.forEach((a,i)=>{
      const li=document.createElement('li');li.className='amount';li.id='amount-'+(i+1);
      li.innerHTML=`<div class="what"><strong>${money(a.amount)}</strong><span></span></div>
        <button type="button" class="edit" id="edit-${i+1}">Edit</button>
        <button type="button" class="remove" id="remove-${i+1}">Remove</button>`;
      li.querySelector('span').textContent=(a.kind==='saved'?'Saved · ':'Spent · ')+a.label;
      li.querySelector('.edit').onclick=()=>openEdit(i);
      li.querySelector('.remove').onclick=()=>{amounts.splice(i,1);store.set('amounts',amounts);render();};
      list.append(li);
    });
    const saved=amounts.filter(a=>a.kind==='saved').reduce((s,a)=>s+a.amount,0);
    const spent=amounts.filter(a=>a.kind!=='saved').reduce((s,a)=>s+a.amount,0);
    $('#review-total').textContent=`${money(saved)} saved · ${money(spent)} spent`;
    $('#review-empty').hidden=amounts.length>0;
  };
  const openEdit=i=>{
    editing=i;const a=amounts[i];
    $('#edit-amount').value=a.amount.toFixed(2);$('#edit-label').value=a.label;
    dialog.showModal();
  };
  $('#edit-close').onclick=()=>dialog.close();
  $('#edit-form').addEventListener('submit',e=>{
    e.preventDefault();
    const n=Number($('#edit-amount').value);
    if(editing>=0&&Number.isFinite(n)){amounts[editing]={...amounts[editing],amount:n,label:$('#edit-label').value.trim()||amounts[editing].label};store.set('amounts',amounts);}
    dialog.close();render();
  });
  $('#looks-right').onclick=()=>{store.set('confirmed',amounts);location.href='done.html';};
  $('#delete-data').onclick=()=>{
    if(!confirm('Delete everything Penny Jar saved in this tab?'))return;
    store.clear();location.href='index.html';
  };
  render();
}

/* ---------- Done ---------- */
function initDone(){
  const amounts=store.get('confirmed',null)??store.get('amounts',null)??SAMPLE;
  const saved=amounts.filter(a=>a.kind==='saved').reduce((s,a)=>s+a.amount,0);
  const spent=amounts.filter(a=>a.kind!=='saved').reduce((s,a)=>s+a.amount,0);
  $('#receipt-saved').textContent=money(saved);$('#receipt-spent').textContent=money(spent);
  $('#receipt-count').textContent=String(amounts.length);
  $('#back-to-start').addEventListener('click',()=>store.clear());
}

/* ---------- Log in ---------- */
function initLogin(){
  $('#login-form').addEventListener('submit',e=>{e.preventDefault();$('#login-error').hidden=false;});
}

const page=document.body.dataset.page;
({journal:initJournal,review:initReview,done:initDone,login:initLogin})[page]?.();
