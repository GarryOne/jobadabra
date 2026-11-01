// The "log anything" IPC (moved out of main.js, 8 Oct 2026): the clipboard's image, proposing a lead from a pasted message or screenshot (the one AI
// call, nothing written), and adding it to Notion once confirmed. main.js passes in the services they share. Guards: the lead, inbox and
// opportunity tests in desktop/test and tests/.
import * as demo from './demo.js';
import * as pipeline from './pipeline.js';
import fs from 'node:fs';
import path from 'node:path';
import {smallCopy} from './shots.js';

export function registerLeadsHandlers(ctx) {
  const {DEMO, aiReady, app, clipboard, ipcMain, log, nativeImage, needsNotion, storage, toWindow} = ctx;
  // Jobs → Log job activity → Paste image: the clipboard's image as PNG, or null.
  ipcMain.handle('clipboardImage', () => {
    const image = clipboard.readImage();
    return image.isEmpty() ? null : {name: 'pasted-screenshot.png', type: 'image/png', data: image.toPNG().toString('base64')};
  });
  // Jobs → Recruiter message: a recruiter lead read by Claude, waited for so the list shows it.
  // Two steps: proposeLead reads it (Claude, once; nothing written), the window asks you to confirm the channel and the
  // start date, then addLead(…, {proposal, confirmed}) writes it to Notion with those instead of Claude's guesses.
  const leadCheck = () => needsNotion('lead')
    || (!aiReady() ? {ok: false, text: 'Reading a message or screenshot needs AI: choose an AI engine: Claude Code, Codex or an API key (Settings → Connections → AI).'} : null);
  // Screenshots (up to 5) go to temporary files for the run (then to Notion, on the job's page), deleted after.
  const withShots = async (image, task) => {
    const exts = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif'};
    const shots = (Array.isArray(image) ? image : image ? [image] : []).filter(shot => exts[shot?.type]).slice(0, 5);
    const files = shots.map((shot, i) => path.join(app.getPath('temp'), `jobadabra-shot-${Date.now()}-${i}${exts[shot.type]}`));
    try {
      shots.forEach((shot, i) => {
        const data = Buffer.from(String(shot.data), 'base64');
        fs.writeFileSync(files[i], data);  // Claude reads this one
        const small = smallCopy(nativeImage, data);  // Notion gets this one: a narrow JPEG (src/ai/inbox.py load_image)
        if (small) fs.writeFileSync(`${files[i]}.small.jpg`, small);
      });
      return await task(files.join(','));
    } catch (error) { return {ok: false, text: error.message}; } finally { files.forEach(file => { fs.rmSync(file, {force: true}); fs.rmSync(`${file}.small.jpg`, {force: true}); }); }
  };
  // Each step the engine reports ("⏳ …"), and its wait for another search, show in the Log box while it works.
  const leadLine = line => { log(line); const step = pipeline.leadStepOf(line); if (step) toWindow('leadStep', step); };
  // earlier: the proposal shown, when you pick another job in the confirmation step (proposed again, no second reading).
  ipcMain.handle('proposeLead', async (_, text, image = null, target = '', earlier = null) => {
    if (DEMO) return demo.leadProposal(target);
    const problem = leadCheck();
    if (problem) return problem;
    if (earlier) {
      const reading = path.join(app.getPath('temp'), `jobadabra-reading-${Date.now()}.json`);
      try {
        fs.writeFileSync(reading, JSON.stringify(earlier));
        return await pipeline.proposeLead(storage, String(text || ''), leadLine, {target: String(target || ''), reading});
      } finally { fs.rmSync(reading, {force: true}); }
    }
    return withShots(image, file => pipeline.proposeLead(storage, String(text || ''), leadLine, {file, target: String(target || '')}));
  });
  ipcMain.handle('addLead', async (_, text, image = null, target = '', proposal = null, confirmed = null) => {
    if (DEMO) return {ok: true, text: 'Tracked (demo): nothing was written.', job: {pageId: 'demo-lead-9', url: 'https://www.notion.so/demo-lead-9',
      title: 'Platform Engineer', jobUrl: 'https://example.com/lead/9', created: true}};
    const problem = leadCheck();
    if (problem) return problem;
    const reading = proposal ? path.join(app.getPath('temp'), `jobadabra-reading-${Date.now()}.json`) : '';
    try {
      if (reading) fs.writeFileSync(reading, JSON.stringify(proposal));
      return await withShots(image, file => pipeline.addLead(storage, String(text || ''), leadLine,
        {file, target: String(target || ''), reading, confirmed}));
    } finally { if (reading) fs.rmSync(reading, {force: true}); }
  });
}
