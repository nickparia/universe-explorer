// shipchat.js — SOLACE, the ship computer.
//
// A quiet chat line that appears while orbiting: ask anything about what
// you're looking at. Answers come from the Worker's /api/ask endpoint
// (Workers AI), with the location's catalog entry sent along as context.
// Diegetic by design — it's the ship talking, not a widget.

import { on } from './bus.js';
import { getLocation } from './catalog.js';
import { getPlanetConfig } from './planetconfig.js';

let wrap = null;
let log = null;
let input = null;
let currentLocation = null;
let busy = false;

export function initShipChat() {
  wrap = document.createElement('div');
  wrap.id = 'ship-chat';
  wrap.style.cssText =
    'position:fixed;left:24px;bottom:96px;width:300px;z-index:60;' +
    "font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-weight:300;" +
    'opacity:0;transition:opacity 0.9s;pointer-events:none;';

  log = document.createElement('div');
  log.style.cssText =
    'display:flex;flex-direction:column;gap:10px;margin-bottom:10px;' +
    'max-height:240px;overflow:hidden;';
  wrap.appendChild(log);

  input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'ask solace';
  input.maxLength = 240;
  input.style.cssText =
    'width:100%;box-sizing:border-box;padding:9px 12px;' +
    'background:rgba(8,12,22,0.55);border:1px solid rgba(140,180,255,0.18);' +
    'border-radius:2px;outline:none;color:rgba(255,255,255,0.85);' +
    'font-size:11px;letter-spacing:2px;font-family:inherit;font-weight:300;' +
    'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:border-color 0.2s;';
  input.addEventListener('focus', () => { input.style.borderColor = 'rgba(140,180,255,0.45)'; });
  input.addEventListener('blur', () => { input.style.borderColor = 'rgba(140,180,255,0.18)'; });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // never fly the ship while typing
    if (e.key === 'Enter') send();
    if (e.key === 'Escape') input.blur();
  });
  wrap.appendChild(input);

  document.body.appendChild(wrap);

  on('orbit:enter', ({ name }) => {
    currentLocation = name;
    wrap.style.opacity = '1';
    wrap.style.pointerEvents = 'auto';
  });
  on('orbit:exit', () => {
    currentLocation = null;
    wrap.style.opacity = '0';
    wrap.style.pointerEvents = 'none';
    input.blur();
    log.innerHTML = '';
  });
}

function addLine(text, who) {
  const line = document.createElement('div');
  line.style.cssText =
    'font-size:11px;letter-spacing:1.5px;line-height:1.9;' +
    'text-shadow:0 1px 4px rgba(0,0,0,0.9);transition:opacity 1s;' +
    (who === 'you'
      ? 'color:rgba(255,255,255,0.45);'
      : 'color:rgba(170,205,255,0.8);');
  line.textContent = who === 'you' ? '› ' + text : text;
  log.appendChild(line);
  // Keep the log short — this is a conversation, not a transcript
  while (log.children.length > 6) log.removeChild(log.firstChild);
  return line;
}

function buildContext(name) {
  const loc = getLocation(name);
  const cfg = getPlanetConfig(name);
  const info = (loc && loc.info) || (cfg && cfg.info) || {};
  const parts = [];
  if (loc && loc.desc) parts.push(loc.desc);
  if (info.type) parts.push('Type: ' + info.type);
  if (info.facts) parts.push('Facts: ' + info.facts.join('; '));
  if (info.lore) parts.push(info.lore);
  return parts.join('\n').slice(0, 1500);
}

async function send() {
  const q = input.value.trim();
  if (!q || busy || !currentLocation) return;
  input.value = '';
  busy = true;
  addLine(q, 'you');
  const pending = addLine('…', 'solace');

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        location: currentLocation,
        question: q,
        context: buildContext(currentLocation),
      }),
    });
    const data = await res.json();
    pending.textContent = res.ok && data.answer
      ? data.answer.trim()
      : 'the ship computer is quiet. try again in a moment.';
  } catch (e) {
    pending.textContent = 'the ship computer is offline out here.';
  }
  busy = false;
}
