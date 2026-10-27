// "Review my answer" and "Keep as is" beside each open written question's box (owner, 16 Oct 2026): the answers call drafts these questions from the person's facts, this lets the person
// have the draft, or their own text, read by the AI (does it answer what was asked, what is missing, one improved version) and keeps a draft marked until they have read it.
// Never types on its own: the improved version goes into the box only on the person's "Use this version" press, and only if the box still holds the text that was reviewed.
// A small shadow-root host sits after the box; the panel (review.js) lists the same rows. Injected before review.js (panel-files.js). Guarded by desktop/test/written-draft.test.js.
(() => {
  const STYLE = `<style>:host{all:initial}*{box-sizing:border-box}.w{font:12.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#182537;margin:4px 0 8px}
    button{font:inherit;cursor:pointer;border:0;border-radius:8px;padding:4px 10px;font-weight:600}.go{background:#132439;color:#fff}.go[disabled]{opacity:.6;cursor:wait}.alt{background:#eef2f7;color:#182537;margin-left:6px}
    .tag{display:inline-block;padding:1px 8px;border-radius:999px;background:#fdf4e4;color:#9a6200;font-size:11.5px;font-weight:600;margin-right:8px}
    .card{margin-top:6px;padding:10px;border-radius:10px;background:#f5f7fb;border:1px solid #e2e8f0}.card b{display:block;margin-bottom:2px}.card ul{margin:4px 0 6px 18px;padding:0}
    .add{margin:2px 0 6px 18px;padding:0}.imp{white-space:pre-wrap;margin:6px 0;padding:8px;border-radius:8px;background:#fff;border:1px solid #e2e8f0;max-height:220px;overflow:auto}.err{color:#a33}</style>`;
  window.__jobPilottoPanelWritten = {start({send, alive}) {
    const hosts = new Map();   // the box -> {host, root, result}
    const setValue = (el, text) => {   // as a person's typing would arrive: the page's own listeners see it
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}));
    };
    const keep = el => { delete el.dataset.jobpilottoDraft; };
    const kindOf = field => field.el?.dataset?.jobpilottoDraft || '';
    const line = (tag, text) => Object.assign(document.createElement(tag), {textContent: text});

    function draw(field, slot) {
      const {root, result} = slot, el = field.el, kind = kindOf(field);
      const box = root.querySelector('.w'), text = String(el.value || '').trim();
      const remind = (() => { try { return JSON.parse(el.dataset.jobpilottoRemind || '[]'); } catch { return []; } })();   // what to add in your own words (page/categories.js): never typed (owner, 27 Oct 2026)
      const sig = [kind, !!text, result.busy, result.error, result.rev, remind.length].join('|');   // drawn again only when something shown changed: a press never lands on a rebuilt button
      if (slot.sig === sig) return;
      slot.sig = sig;
      box.replaceChildren();
      if (kind) box.append(Object.assign(line('span', kind === 'outline' ? 'Outline: add your own details' : 'Drafted for you: review'), {className: 'tag'}));
      if (remind.length) { const ul = Object.assign(document.createElement('ul'), {className: 'add'}); for (const item of remind) ul.append(line('li', item)); box.append(line('div', text ? 'Add in your own words:' : 'Answer in your own words; mention:'), ul); }
      const go = Object.assign(line('button', result.busy ? 'Reviewing…' : 'Review my answer'), {className: 'go', disabled: !!result.busy || !text});
      go.onclick = () => review(field);
      box.append(go);
      if (kind === 'draft') { const ok = Object.assign(line('button', 'Keep as is'), {className: 'alt'}); ok.onclick = () => { keep(el); result.rev++; draw(field, slot); }; box.append(ok); }
      if (result.error) box.append(Object.assign(line('div', result.error), {className: 'err'}));
      if (result.done) {
        const card = Object.assign(document.createElement('div'), {className: 'card'});
        card.append(line('b', result.done.answers_it ? 'It answers the question.' : 'It does not fully answer the question.'));
        if (result.done.verdict) card.append(line('div', result.done.verdict));
        if (result.done.missing.length) { const ul = document.createElement('ul'); for (const item of result.done.missing) ul.append(line('li', item)); card.append(line('div', 'Missing:'), ul); }
        if (result.done.improved) {
          card.append(line('div', 'An improved version:'), Object.assign(line('div', result.done.improved), {className: 'imp'}));
          const use = Object.assign(line('button', 'Use this version'), {className: 'go'});
          use.onclick = () => {
            if (String(el.value || '').trim() !== result.reviewed) { result.error = 'The text changed since this review: review it again.'; result.done = null; result.rev++; return draw(field, slot); }
            setValue(el, result.done.improved); keep(el); result.done = null; result.rev++; draw(field, slot);
          };
          card.append(use);
        }
        const close = Object.assign(line('button', 'Dismiss'), {className: 'alt'}); close.onclick = () => { result.done = null; result.rev++; draw(field, slot); };
        card.append(close);
        box.append(card);
      }
    }
    async function review(field) {
      const slot = hosts.get(field.el), el = field.el, text = String(el.value || '').trim();
      if (!slot || !text || slot.result.busy) return;
      Object.assign(slot.result, {busy: true, error: '', done: null, rev: (slot.result.rev || 0) + 1}); draw(field, slot);
      const answer = await send({type: 'panelReviewAnswer', question: field.label, text}).catch(() => null);
      slot.result.busy = false; slot.result.rev = (slot.result.rev || 0) + 1;
      if (answer?.ok) { slot.result.done = answer; slot.result.reviewed = text; }
      else slot.result.error = answer?.error ? String(answer.error).slice(0, 160) : 'Could not review it: try again.';
      if (alive()) draw(field, slot);
    }
    // list: the panel's fields. A box gets its row when the AI read the question as an open written one (category written) or we drafted it.
    function update(list) {
      const wanted = new Set();
      for (const field of list) {
        const el = field.el;
        if (!(el?.tagName === 'TEXTAREA') || !el.isConnected || !(field.category === 'written' || field.draft)) continue;
        wanted.add(el);
        let slot = hosts.get(el);
        if (!slot || !slot.host.isConnected) {
          const host = Object.assign(document.createElement('div'), {id: 'jobpilotto-written-host'});
          const root = host.attachShadow({mode: 'open'}); root.innerHTML = `${STYLE}<div class="w"></div>`;
          el.after(host);
          slot = {host, root, result: slot?.result || {rev: 0}}; hosts.set(el, slot);
        }
        draw(field, slot);
      }
      for (const [el, slot] of hosts) if (!wanted.has(el)) { slot.host.remove(); hosts.delete(el); }
    }
    return {update, review};
  }};
})();
