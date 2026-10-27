// Consent questions reach the existing AI seam even when a kit or the word floor called them legal; the saved off switch also gates live choice decisions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {pickChoice} from '../lib/server-pages.js';

const flow = fs.readFileSync(new URL('../../extension/flow.js', import.meta.url), 'utf8');
const body = flow.slice(flow.indexOf('async function openQuestions('), flow.indexOf('// Claude\'s answers for a fill'));
const openQuestions = new Function('inPage', `${body}; return openQuestions;`)(async () => []);

test('AI reads native and custom legal controls with a kit; completed and file controls stay out', async () => {
  const rows = [
    {field:'native',label:'Privacy notice',type:'select',legal:true,options:['Agree']},
    {field:'custom',label:'Data notice',type:'select',custom:true,legal:true},
    {field:'done',type:'select',legal:true,filled:true}, {field:'file',type:'file'}];
  const {open} = await openQuestions({}, rows, [{field:'native',category:'legal'}, {field:'custom',category:'legal'}], {}, {});
  assert.deepEqual(open.map(row=>[row.field,row.type]), [['native','select'],['custom','combobox']]);
});

test('saved consent on/default reaches the explicit agreement decision; off never calls the AI', async () => {
  let calls = 0, sent;
  const client = {messages:{create:async request=>{calls++;sent=request;return {stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({choice:'Acconsento',agreement:true})}]};}}};
  const storage = {settings:()=>({acceptConsents:false}),readText:()=>null,writeText:()=>{throw new Error('consent decisions must not become personal saved answers');}};
  const body = {label:'Privacy notice',value:'Accept application consent',options:['Acconsento','Non acconsento'],consent:true};
  assert.equal((await pickChoice(storage,body,{client})).choice,'');
  assert.equal(calls,0);
  for (const saved of [true,undefined]) {
    storage.settings=()=>({acceptConsents:saved});
    assert.equal((await pickChoice(storage,body,{client})).choice,'Acconsento');
    assert.match(sent.system,/attestation/);
  }
  assert.equal(calls,2);
});
