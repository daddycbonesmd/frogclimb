// Joins two bots to a live room for manual testing.
// usage: node test/livebots.js CODE [port]
const WebSocket = require('ws');
const QUESTIONS = require('../questions.js');
const byText = new Map(QUESTIONS.map(q => [q.text, q.correct]));
const code = process.argv[2];
const port = process.argv[3] || 8791;
if (!code) { console.error('usage: node test/livebots.js CODE'); process.exit(1); }

function bot(name, accuracy, minDelay, maxDelay) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code, name })));
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'error') console.log(name, 'error:', m.msg);
    if (m.t === 'question') {
      const correctIdx = m.options.indexOf(byText.get(m.text));
      const right = Math.random() < accuracy;
      let idx = correctIdx;
      if (!right || correctIdx < 0) {
        do { idx = Math.floor(Math.random() * 4); } while (idx === correctIdx);
      }
      const delay = minDelay + Math.random() * (maxDelay - minDelay);
      setTimeout(() => ws.send(JSON.stringify({ t: 'answer', idx })), delay);
      console.log(`${name}: Q${m.num} answering ${right ? 'RIGHT' : 'wrong'} in ${(delay / 1000).toFixed(1)}s`);
    }
    if (m.t === 'winner') console.log(`${name}: match over`);
  });
  ws.on('close', () => process.exit(0));
}

bot('RIBBITA', 0.75, 1500, 6000);
bot('HOPPY', 0.35, 2500, 9000);
console.log('bots joining room', code);
