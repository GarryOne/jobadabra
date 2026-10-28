// Answers the app under test's Messages calls through the Codex broker (lib/broker-client.mjs) when CI's provider for the app is codex (lib/ai-provider.mjs).
// Why (28 Oct 2026, owner: "Emulate both"): the broker takes text, a JSON schema and pictures, so a PDF CV goes in as the text pdf.js reads from it and a streamed call is answered
// as one chunk of the same events. Tool calls are refused out loud (the app sends none to Claude), and a broker "no" is an error answer the runner skips on, never another provider.
import {askBroker} from './broker-client.mjs';
import {capMessage, noteBrokerCapped} from './ai-cap.mjs';

/** Takes base64 PDF bytes; returns the text of its pages (pdf.js legacy build, the same one lib/pdf-edit reads with). */
export async function pdfText(base64) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({data: new Uint8Array(Buffer.from(base64, 'base64')), verbosity: 0, isEvalSupported: false}).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) pages.push((await (await doc.getPage(n)).getTextContent()).items.map(item => item.str + (item.hasEOL ? '\n' : '')).join(' '));
  return pages.join('\n\n');
}

/** Takes a Messages body; returns it with every PDF document block replaced by a text block holding the PDF's text. */
export async function withPdfAsText(body, extract = pdfText) {
  const messages = await Promise.all(body.messages.map(async message => (Array.isArray(message.content)
    ? {...message, content: await Promise.all(message.content.map(async part => (part.type === 'document' && part.source?.data
      ? {type: 'text', text: `[The attached PDF, as the text it holds]\n${await extract(part.source.data)}`} : part)))}
    : message)));
  return {...body, messages};
}

/** Takes the answer text and model; returns the Messages stream of it (one text delta), as the SDK's messages.stream reads it. */
export function streamOf(text, model, usage) {
  const events = [
    {type: 'message_start', message: {id: 'msg_codex', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: {input_tokens: usage.input_tokens, output_tokens: 0}}},
    {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
    {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text}},
    {type: 'content_block_stop', index: 0},
    {type: 'message_delta', delta: {stop_reason: 'end_turn', stop_sequence: null}, usage: {output_tokens: usage.output_tokens}},
    {type: 'message_stop'}];
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

const failure = (status, type, message) => ({status, contentType: 'application/json', body: Buffer.from(JSON.stringify({type: 'error', error: {type, message}})), counted: null});

/**
 * Takes a parsed Messages request; returns {status, contentType, body, counted}: the Messages answer (or its stream when the request streams), `counted` being the plain
 * message JSON the meter reads. A broker refusal is a 503 naming its reason and tells the runner's cap path (lib/ai-cap.mjs); tool calls are a 400.
 */
export async function answerViaBroker(body, {env = process.env, ask = askBroker, extract = pdfText} = {}) {
  if (body.tools?.length) return failure(400, 'invalid_request_error', 'the Codex relay does not carry tool calls (the app sends none to Claude)');
  const asked = await ask(await withPdfAsText(body, extract), {env});
  if (!asked.ok) {
    if (asked.status === 'capped') noteBrokerCapped(asked.detail, env);
    return failure(503, 'api_error', asked.status === 'capped' ? capMessage(null, env, asked.detail) : asked.detail);
  }
  const message = JSON.stringify({id: 'msg_codex', type: 'message', role: 'assistant', model: asked.model, stop_sequence: null, ...asked.message});
  return body.stream
    ? {status: 200, contentType: 'text/event-stream', body: Buffer.from(streamOf(asked.message.content[0].text, asked.model, asked.message.usage)), counted: message}
    : {status: 200, contentType: 'application/json', body: Buffer.from(message), counted: message};
}
