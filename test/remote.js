// Smoke-test a deployed FROG TOWER over wss: create room, join bot, play 3 rounds.
// usage: node test/remote.js wss://host
const WebSocket = require('ws');
const QUESTIONS = require('../questions.js');
const byText = new Map(QUESTIONS.map(q => [q.text, q.correct]));
const url = process.argv[2];
if (!url) { console.error('usage: node test/remote.js wss://host'); process.exit(1); }

let code = null, reveals = 0, climbed = false, kicked = false, failed = false;
function done(msg) {
  console.log(msg);
  console.log(`rounds=${reveals} climbSeen=${climbed} kickSeen=${kicked}`);
  process.exit(failed || !climbed || !kicked ? 1 : 0);
}
setTimeout(() => { failed = true; done('TIMEOUT'); }, 120000);

function bot(name, smart, onCode) {
  const ws = new WebSocket(url);
  ws.on('open', () => {
    if (onCode) ws.send(JSON.stringify({ t: 'create', name }));
  });
  ws.on('error', e => { failed = true; done('WS ERROR: ' + e.message); });
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'welcome' && onCode) { code = m.code; console.log('room', code, 'on', url); onCode(ws); }
    if (m.t === 'question') {
      const correctIdx = m.options.indexOf(byText.get(m.text));
      const idx = smart ? correctIdx : (correctIdx + 1) % 4;
      setTimeout(() => ws.send(JSON.stringify({ t: 'answer', idx })), 300 + Math.random() * 500);
    }
    if (m.t === 'reveal' && onCode) {
      reveals++;
      for (const r of m.results) {
        if (r.correct && r.to > r.from) climbed = true;
        if (r.kicked && r.to === Math.max(0, r.from - 1)) kicked = true;
      }
      console.log('round', reveals, m.results.map(r => `${r.id.slice(0, 4)}:${r.from}->${r.to}`).join(' '));
      if (reveals >= 3) done('OK — remote server plays correctly');
    }
  });
}

bot('SMARTY', true, hostWs => {
  const j = new WebSocket(url);
  j.on('open', () => j.send(JSON.stringify({ t: 'join', code, name: 'DUMMY' })));
  j.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'welcome') hostWs.send(JSON.stringify({ t: 'start' }));
    if (m.t === 'question') {
      const correctIdx = m.options.indexOf(byText.get(m.text));
      setTimeout(() => j.send(JSON.stringify({ t: 'answer', idx: (correctIdx + 1) % 4 })), 900);
    }
  });
});
