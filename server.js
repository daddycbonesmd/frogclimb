// FROG TOWER — authoritative game server.
// Serves the client from /public and runs all game logic over WebSocket.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QUESTIONS = require('./questions.js');

const PORT = Number(process.env.PORT) || 8791;
const FAST = !!process.env.FAST; // sped-up timings for automated tests

const FLOORS = 15;          // reach floor 15 = roof = win
const MAX_PLAYERS = 6;
const KICK_FLOORS = 1;      // businessman kick distance
const QUESTION_MS = FAST ? 1500 : 20000;
const REVEAL_MS = FAST ? 300 : 4200;
const GETREADY_MS = FAST ? 200 : 1500;
const ALL_IN_GRACE_MS = FAST ? 50 : 700; // wait a beat after last answer
const ROOM_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------- static http
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
const PUB = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUB, urlPath));
  if (!file.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------------------------------------------------------------- game state
const rooms = new Map(); // code -> room

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I/L/O
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeRoom() {
  const room = {
    code: newCode(),
    players: new Map(), // id -> player
    hostId: null,
    phase: 'lobby', // lobby | getready | question | reveal | winner
    deck: [],
    deckPos: 0,
    qNum: 0,
    current: null, // { q, options, correctIdx, deadline, answers: Map(id->{idx,at}) }
    timer: null,
    lastActive: Date.now(),
    winners: [],
  };
  rooms.set(room.code, room);
  return room;
}

function makePlayer(room, name, ws) {
  const usedColors = new Set([...room.players.values()].map(p => p.color));
  let color = 0;
  while (usedColors.has(color)) color++;
  const base = (name || 'FROG').replace(/[^\x20-\x7E]/g, '').trim().slice(0, 14) || 'FROG';
  let unique = base; let n = 2;
  const names = new Set([...room.players.values()].map(p => p.name.toLowerCase()));
  while (names.has(unique.toLowerCase())) unique = base.slice(0, 12) + n++;
  const player = {
    id: crypto.randomUUID().slice(0, 8),
    token: crypto.randomUUID(),
    name: unique,
    color,
    floor: 0,
    ws,
    connected: true,
    spectator: room.phase !== 'lobby', // mid-match joiners spectate until next match
  };
  room.players.set(player.id, player);
  if (!room.hostId) room.hostId = player.id;
  return player;
}

// ---------------------------------------------------------------- messaging
function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(room, msg) {
  const s = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.connected && p.ws && p.ws.readyState === 1) p.ws.send(s);
  }
}
function roster(room) {
  return {
    t: 'room',
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    floors: FLOORS,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, floor: p.floor,
      connected: p.connected, spectator: p.spectator,
    })),
  };
}
function syncRoster(room) { broadcast(room, roster(room)); }

// ---------------------------------------------------------------- match flow
function activePlayers(room) {
  return [...room.players.values()].filter(p => !p.spectator);
}

function startMatch(room) {
  clearTimeout(room.timer);
  room.deck = shuffle([...QUESTIONS.keys()]);
  room.deckPos = 0;
  room.qNum = 0;
  room.winners = [];
  for (const p of room.players.values()) {
    p.floor = 0;
    p.spectator = false; // everyone in the room plays the new match
  }
  room.phase = 'getready';
  syncRoster(room);
  broadcast(room, { t: 'matchStart', floors: FLOORS });
  room.timer = setTimeout(() => nextQuestion(room), GETREADY_MS);
}

function nextQuestion(room) {
  if (room.deckPos >= room.deck.length) room.deck = shuffle([...QUESTIONS.keys()]), room.deckPos = 0;
  const q = QUESTIONS[room.deck[room.deckPos++]];
  room.qNum++;
  const options = shuffle([q.correct, ...q.wrong]);
  room.current = {
    q,
    options,
    correctIdx: options.indexOf(q.correct),
    deadline: Date.now() + QUESTION_MS,
    answers: new Map(),
  };
  room.phase = 'question';
  broadcast(room, {
    t: 'question',
    num: room.qNum,
    cat: q.cat,
    text: q.text,
    options,
    deadline: room.current.deadline,
    now: Date.now(),
  });
  clearTimeout(room.timer);
  room.timer = setTimeout(() => resolveQuestion(room), QUESTION_MS + 150);
}

function maybeResolveEarly(room) {
  const cur = room.current;
  if (!cur) return;
  const waiting = activePlayers(room).filter(p => p.connected && !cur.answers.has(p.id));
  if (waiting.length === 0) {
    clearTimeout(room.timer);
    room.timer = setTimeout(() => resolveQuestion(room), ALL_IN_GRACE_MS);
  }
}

function resolveQuestion(room) {
  const cur = room.current;
  if (!cur || room.phase !== 'question') return;
  room.phase = 'reveal';
  clearTimeout(room.timer);

  // fastest correct answer gets a bonus floor
  let fastestId = null, fastestAt = Infinity;
  for (const [id, a] of cur.answers) {
    if (a.idx === cur.correctIdx && a.at < fastestAt) { fastestAt = a.at; fastestId = id; }
  }

  const results = [];
  const picks = {};
  for (const p of activePlayers(room)) {
    const a = cur.answers.get(p.id);
    if (a) picks[p.id] = a.idx;
    const correct = !!a && a.idx === cur.correctIdx;
    const fastest = correct && p.id === fastestId;
    const from = p.floor;
    let delta;
    if (correct) delta = fastest ? 2 : 1;
    else delta = -Math.min(KICK_FLOORS, p.floor); // businessman kick, can't go below street
    p.floor = Math.min(FLOORS, p.floor + delta);
    results.push({
      id: p.id, correct, fastest, kicked: !correct,
      from, to: p.floor, answered: !!a,
    });
  }

  broadcast(room, {
    t: 'reveal',
    correctIdx: cur.correctIdx,
    correctText: cur.options[cur.correctIdx],
    picks,
    results,
    now: Date.now(),
  });
  room.current = null;

  const atTop = activePlayers(room).filter(p => p.floor >= FLOORS);
  if (atTop.length > 0) {
    // tie-break: faster answer this round wins; identical -> co-champions
    let winners = atTop;
    if (atTop.length > 1) {
      const times = new Map(results.map(r => [r.id, r]));
      let best = Infinity;
      for (const p of atTop) {
        const at = cur.answers.get(p.id)?.at ?? Infinity;
        if (at < best) best = at;
      }
      winners = atTop.filter(p => (cur.answers.get(p.id)?.at ?? Infinity) === best);
    }
    room.winners = winners.map(p => p.id);
    room.timer = setTimeout(() => {
      room.phase = 'winner';
      broadcast(room, { t: 'winner', ids: room.winners });
      syncRoster(room);
    }, REVEAL_MS);
  } else {
    room.timer = setTimeout(() => nextQuestion(room), REVEAL_MS);
  }
}

// ---------------------------------------------------------------- websocket
const wss = new WebSocketServer({ server, maxPayload: 4 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null, player = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    if (room) room.lastActive = Date.now();

    switch (msg.t) {
      case 'create': {
        if (player) return;
        room = makeRoom();
        player = makePlayer(room, String(msg.name || ''), ws);
        send(ws, { ...roster(room), t: 'welcome', you: { id: player.id, token: player.token } });
        syncRoster(room);
        break;
      }
      case 'join': {
        if (player) return;
        const r = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!r) { send(ws, { t: 'error', msg: 'Room not found.' }); return; }
        if ([...r.players.values()].filter(p => !p.spectator).length >= MAX_PLAYERS && r.phase === 'lobby') {
          send(ws, { t: 'error', msg: 'Room is full (6 frogs max).' }); return;
        }
        if (r.players.size >= MAX_PLAYERS + 4) { send(ws, { t: 'error', msg: 'Room is full.' }); return; }
        room = r;
        player = makePlayer(room, String(msg.name || ''), ws);
        send(ws, { ...roster(room), t: 'welcome', you: { id: player.id, token: player.token } });
        // late joiner needs current question to spectate live
        if (room.phase === 'question' && room.current) {
          send(ws, {
            t: 'question', num: room.qNum, cat: room.current.q.cat, text: room.current.q.text,
            options: room.current.options, deadline: room.current.deadline, now: Date.now(),
          });
        }
        syncRoster(room);
        break;
      }
      case 'rejoin': {
        if (player) return;
        const r = rooms.get(String(msg.code || '').toUpperCase().trim());
        const p = r && [...r.players.values()].find(p => p.token === msg.token);
        if (!p) { send(ws, { t: 'error', msg: 'Could not rejoin.', fatal: true }); return; }
        if (p.ws && p.ws !== ws) { try { p.ws.terminate(); } catch {} }
        room = r; player = p;
        p.ws = ws; p.connected = true;
        send(ws, { ...roster(room), t: 'welcome', you: { id: p.id, token: p.token } });
        if (room.phase === 'question' && room.current) {
          send(ws, {
            t: 'question', num: room.qNum, cat: room.current.q.cat, text: room.current.q.text,
            options: room.current.options, deadline: room.current.deadline, now: Date.now(),
            yourAnswer: room.current.answers.get(p.id)?.idx,
          });
        }
        syncRoster(room);
        break;
      }
      case 'start': {
        if (!room || !player) return;
        if (player.id !== room.hostId) return;
        if (room.phase !== 'lobby' && room.phase !== 'winner') return;
        startMatch(room);
        break;
      }
      case 'answer': {
        if (!room || !player || room.phase !== 'question' || !room.current) return;
        if (player.spectator || room.current.answers.has(player.id)) return;
        const idx = msg.idx;
        if (!Number.isInteger(idx) || idx < 0 || idx > 3) return;
        if (Date.now() > room.current.deadline + 100) return;
        room.current.answers.set(player.id, { idx, at: Date.now() });
        broadcast(room, { t: 'answered', id: player.id });
        maybeResolveEarly(room);
        break;
      }
      case 'leave': {
        if (room && player) removePlayer(room, player, true);
        room = null; player = null;
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room || !player) return;
    if (room.phase === 'lobby') {
      removePlayer(room, player, true);
    } else {
      player.connected = false;
      player.ws = null;
      syncRoster(room);
      maybeResolveEarly(room); // don't hold the round for a dropped frog
    }
    room = null; player = null;
  });
});

function removePlayer(room, player, gone) {
  room.players.delete(player.id);
  if (room.players.size === 0) {
    clearTimeout(room.timer);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === player.id) {
    room.hostId = [...room.players.values()][0].id;
  }
  syncRoster(room);
  if (room.phase === 'question') maybeResolveEarly(room);
}

// heartbeat + stale room cleanup
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyConnected = [...room.players.values()].some(p => p.connected);
    if (!anyConnected && now - room.lastActive > ROOM_TTL_MS) {
      clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
}, 25000);

server.listen(PORT, () => {
  console.log(`FROG TOWER listening on http://localhost:${PORT} (${QUESTIONS.length} questions${FAST ? ', FAST mode' : ''})`);
});
