// The complete late-answer fill handoff uses fictional DOM controls and fake Chrome/API seams; the run and panel must agree with the actual consent state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJsdom, openPage, userClick} from './helpers/page.js';
const JSDOM = await loadJsdom();

for (const shape of ['native','custom']) test(`late ${shape} consent returns and records its final required count without a second fill`, {skip:!JSDOM}, async () => {
  const dom = openPage(JSDOM, `<form><div><label for="notice">Privacy notice for applicants *</label>${shape === 'native'
    ? '<select id="notice" required><option value="">Choose</option><option value="agree">Acconsento</option><option value="no">Non acconsento</option></select>'
    : '<input id="notice" role="combobox" readonly aria-required="true" aria-controls="choices" aria-expanded="false"><ul id="choices" hidden role="listbox"><li role="option">Non acconsento</li><li role="option">Acconsento</li></ul>'}</div></form>`);
  const url = 'https://application.example.test/form', requests = [];
  const notice = dom.document.getElementById('notice'), choices = dom.document.getElementById('choices');
  if (choices) {
    notice.addEventListener('mousedown',()=>{choices.hidden=false;notice.setAttribute('aria-expanded','true');});
    for (const option of choices.children) option.addEventListener('click',()=>{
      notice.value=option.textContent;const chip=dom.document.createElement('span');chip.className='single-value';chip.textContent=option.textContent;notice.parentElement.append(chip);
      notice.setAttribute('aria-expanded','false');choices.hidden=true;
    });
  }
  const before = {window:globalThis.window,document:globalThis.document,chrome:globalThis.chrome,fetch:globalThis.fetch};
  try {
    globalThis.window=dom;globalThis.document=dom.document;
    globalThis.chrome={runtime:{getManifest:()=>({version:'fixture'})},tabs:{get:async()=>({url})},
      storage:{session:{get:async key=>key === 'armed:618' ? {'armed:618':true} : {},set:async()=>{}},local:{get:async()=>({workerUrl:'https://fixture-api.example.test',token:'fictional'})}},
      debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(target,method,args)=>{if(method==='Input.dispatchMouseEvent'&&args.type==='mousePressed') userClick(dom,notice);}},
      scripting:{executeScript:async({func,args})=>func ? [{result:await func(...args || [])}] : [{}]}};
    globalThis.fetch=async(address,init)=>{
      assert.equal(new URL(address).origin,'https://fixture-api.example.test','never contact the live owner app or a service');
      const path=new URL(address).pathname,body=init?.body ? JSON.parse(init.body) : {};
      requests.push({path,body});
      const data=path==='/extension/me' ? {contact:{},acceptConsents:true} : path==='/extension/answer'
        ? {eligible:true,answers:[{field:'notice',category:'legal',use:'kind',consent:true,value:shape==='native'?'Acconsento':'checked'}]}
        : path==='/extension/pick-choice' ? {choice:'Acconsento'} : {};
      return Response.json(data);
    };
    const {fillTab}=await import(`../../extension/flow.js?consent-${shape}`);
    const summary=await fillTab({id:618,url},{workerUrl:'https://fixture-api.example.test',token:'fictional',clickDropdowns:true},{hasKit:true,useAI:true});
    assert.equal(notice.value,shape==='native'?'agree':'Acconsento');
    const row=summary.trace.find(row=>row.label.startsWith('Privacy notice'));
    assert.equal(row.outcome,'filled');
    assert.equal(row.source,'Claude (on the page)','the late pass must retain its provenance');
    assert.equal(summary.unfilledRequired,0,'count after the dropdown pick');
    assert.equal(requests.find(request=>request.path==='/extension/run').body.unfilled,0,'recorded run uses the same final state');
    if(shape==='custom') assert.equal(requests.find(request=>request.path==='/extension/pick-choice').body.consent,true);
  } finally {dom.close();Object.assign(globalThis,before);}
});
