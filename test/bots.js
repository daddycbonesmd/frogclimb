// FROG TOWER self-test: boots the server in FAST mode, plays a full match
// with 3 ws bots (one that always answers correctly), asserts the outcome,
// then plays one rematch round. Exit 0 = pass.
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const QUESTIONS = require('../questions.js');

const PORT = 8799;
const URL = `ws://localhost:${PORT}`;
const byText = new Map(QUESTIONS.map(q => [q.text, q.correct]));

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  ok -', label);
  else { failures++; console.error('  FAIL -', label); }
}

function makeBot(name, strategy) {
  const bot = {
    name, ws: null, id: null, token: null, code: null,
    floor: 0, phase: 'lobby', winners: null, reveals: [], questions: 0,
    lastRoster: null, matchStarts: 0,
  };
  bot.connect = () => new Promise(res => {
    bot.ws = new WebSocket(URL);
    bot.ws.on('open', res);
    bot.ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      switch (m.t) {
        case 'welcome':
          bot.id = m.you.id; bot.token = m.you.token; bot.code = m.code;
          bot.lastRoster = m;
          break;
        case 'room':
          bot.lastRoster = m;
          bot.phase = m.phase;
          const me = m.players.find(p => p.id === bot.id);
          if (me) bot.floor = me.floor;
          break;
        case 'matchStart': bot.matchStarts++; break;
        case 'question': {
          bot.questions++;
          const correct = byText.get(m.text);
          const correctIdx = m.options.indexOf(correct);
          const delay = 30 + Math.random() * 80;
          if (strategy === 'smart') {
            setTimeout(() => bot.send({ t: 'answer', idx: correctIdx }), delay);
          } else if (strategy === 'random') {
            setTimeout(() => bot.send({ t: 'answer', idx: Math.floor(Math.random() * 4) }), delay + 100);
          } else if (strategy === 'sleepy' && Math.random() < 0.5) {
            setTimeout(() => bot.send({ t: 'answer', idx: Math.floor(Math.random() * 4) }), delay + 200);
          }
          break;
        }
        case 'reveal': bot.reveals.push(m); break;
        case 'winner': bot.winners = m.ids; break;
      }
    });
  });
  bot.send = m => bot.ws.readyState === 1 && bot.ws.send(JSON.stringify(m));
  return bot;
}

function waitFor(fn, ms, label) {
  const t0 = Date.now();
  return new Promise((res, rej) => {
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); res(); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout: ' + label)); }
    }, 25);
  });
}

(async () => {
  console.log('spawning FAST server on :' + PORT);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, FAST: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let serverOut = '';
  server.stdout.on('data', d => { serverOut += d; });
  try {
    await waitFor(() => serverOut.includes('listening'), 5000, 'server boot');
    assert(serverOut.includes('questions'), 'server booted with question bank loaded');

    const smart = makeBot('Einstein', 'smart');
    const randy = makeBot('Randy', 'random');
    const sleepy = makeBot('Sleepy', 'sleepy');

    await smart.connect();
    smart.send({ t: 'create', name: 'Einstein' });
    await waitFor(() => smart.code, 2000, 'room created');
    assert(/^[A-Z]{4}$/.test(smart.code), `room code format (${smart.code})`);

    await randy.connect(); await sleepy.connect();
    randy.send({ t: 'join', code: smart.code, name: 'Randy' });
    sleepy.send({ t: 'join', code: smart.code, name: 'Sleepy' });
    await waitFor(() => smart.lastRoster && smart.lastRoster.players.length === 3, 2000, 'all joined');
    assert(smart.lastRoster.players.length === 3, '3 players in roster');
    assert(smart.lastRoster.hostId === smart.id, 'creator is host');

    // non-host cannot start
    randy.send({ t: 'start' });
    await new Promise(r => setTimeout(r, 300));
    assert(smart.matchStarts === 0, 'non-host start ignored');

    smart.send({ t: 'start' });
    await waitFor(() => smart.winners, 60000, 'match completes');

    assert(smart.winners.length >= 1, 'winner declared');
    assert(smart.winners.includes(smart.id), 'always-correct bot wins');
    assert(smart.floor === 15, `winner floor is 15 (got ${smart.floor})`);
    assert(smart.questions >= 8, `enough questions asked (${smart.questions})`);
    assert(smart.questions === randy.questions, 'all bots saw same question count');

    // reveal integrity
    const r0 = smart.reveals[0];
    assert(typeof r0.correctIdx === 'number', 'reveal has correctIdx');
    assert(r0.results.length === 3, 'reveal covers all players');
    const smartR = r0.results.find(r => r.id === smart.id);
    assert(smartR.correct === true, 'smart bot marked correct in round 1');
    assert(smartR.fastest === true, 'smart bot fastest in round 1');
    assert(smartR.to - smartR.from === 2, 'fastest climbs 2');
    // kicks
    const anyKick = smart.reveals.some(r => r.results.some(x => x.kicked && x.to === Math.max(0, x.from - 1)));
    assert(anyKick, 'businessman kicked someone exactly 1 floor');
    const floorsOk = smart.reveals.every(r => r.results.every(x => x.to >= 0 && x.to <= 15));
    assert(floorsOk, 'floors always within 0..15');

    // rematch resets
    const prevQ = smart.questions;
    smart.send({ t: 'start' });
    await waitFor(() => smart.questions > prevQ, 3000, 'rematch first question');
    const rosterAfter = smart.lastRoster.players.every(p => p.floor <= 2);
    assert(smart.matchStarts === 2, 'matchStart broadcast on rematch');
    assert(rosterAfter, 'floors reset for rematch');

    // answer validation: bad indexes ignored (no crash)
    smart.send({ t: 'answer', idx: 99 });
    smart.send({ t: 'answer', idx: -1 });
    smart.send({ t: 'answer', idx: 'x' });
    await new Promise(r => setTimeout(r, 400));
    assert(smart.ws.readyState === 1, 'server survives junk answers');

    console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
  } catch (e) {
    failures++;
    console.error('FATAL:', e.message);
  } finally {
    server.kill();
    process.exit(failures ? 1 : 0);
  }
})();
