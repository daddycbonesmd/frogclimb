// FROG TOWER — client: networking, UI state, sound.
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const els = {
    menu: $('#menu'), lobby: $('#lobby'), game: $('#game'),
    nameInput: $('#nameInput'), joinCode: $('#joinCode'),
    createBtn: $('#createBtn'), joinBtn: $('#joinBtn'), menuErr: $('#menuErr'),
    lobbyCode: $('#lobbyCode'), copyBtn: $('#copyBtn'), lobbyPlayers: $('#lobbyPlayers'),
    startBtn: $('#startBtn'), lobbyHint: $('#lobbyHint'), leaveBtn: $('#leaveBtn'),
    canvas: $('#gameCanvas'),
    roomTag: $('#roomTag'), qNum: $('#qNum'), qCat: $('#qCat'), qText: $('#qText'),
    answers: $('#answers'), timerBar: $('#timerBar'), timerWrap: $('#timerWrap'),
    standings: $('#standings'), feed: $('#feed'),
    overlay: $('#overlay'), overlayTitle: $('#overlayTitle'), overlaySub: $('#overlaySub'),
    againBtn: $('#againBtn'), overlayLeaveBtn: $('#overlayLeaveBtn'),
    muteBtn: $('#muteBtn'), qCard: $('#qCard'), getready: $('#getready'),
    specTag: $('#specTag'),
  };

  let ws = null, wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  let you = null;            // { id, token }
  let room = null;           // latest roster message
  let current = null;        // current question
  let myPick = null;
  let clockOffset = 0;       // serverNow - clientNow
  let timerRAF = 0;
  let reconnectTimer = 0, wantRoom = null;
  let feedItems = [];

  // ---------------------------------------------------------------- sound
  const SFX = (() => {
    let ac = null, muted = localStorage.getItem('frog_muted') === '1';
    function ctx() {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(freq, dur, type, vol, slideTo, when) {
      if (muted) return;
      try {
        const a = ctx(), t0 = a.currentTime + (when || 0);
        const o = a.createOscillator(), g = a.createGain();
        o.type = type || 'square';
        o.frequency.setValueAtTime(freq, t0);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        g.gain.setValueAtTime(vol || 0.08, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(a.destination);
        o.start(t0); o.stop(t0 + dur + 0.02);
      } catch {}
    }
    return {
      get muted() { return muted; },
      toggle() { muted = !muted; localStorage.setItem('frog_muted', muted ? '1' : '0'); return muted; },
      click: () => tone(700, 0.05, 'square', 0.05),
      newQ: () => { tone(520, 0.08, 'square', 0.06); tone(780, 0.1, 'square', 0.06, null, 0.09); },
      tick: () => tone(1000, 0.04, 'square', 0.05),
      correct: () => { tone(660, 0.1, 'square', 0.08); tone(880, 0.14, 'square', 0.08, null, 0.1); },
      wrong: () => tone(220, 0.3, 'sawtooth', 0.09, 110),
      hop: () => tone(300, 0.12, 'sine', 0.09, 620),
      kick: () => { tone(160, 0.08, 'square', 0.1, 60); tone(500, 0.5, 'sine', 0.07, 90, 0.1); },
      land: () => tone(90, 0.09, 'square', 0.1),
      win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'square', 0.08, null, i * 0.12)); },
      lose: () => { [330, 262, 196].forEach((f, i) => tone(f, 0.2, 'square', 0.07, null, i * 0.15)); },
    };
  })();

  els.muteBtn.textContent = SFX.muted ? 'SND OFF' : 'SND ON';
  els.muteBtn.onclick = () => { els.muteBtn.textContent = SFX.toggle() ? 'SND OFF' : 'SND ON'; };

  // ---------------------------------------------------------------- helpers
  function show(scene) {
    for (const s of [els.menu, els.lobby, els.game]) s.classList.add('hidden');
    scene.classList.remove('hidden');
  }
  function serverNow() { return Date.now() + clockOffset; }
  function myPlayer() { return room && you && room.players.find(p => p.id === you.id); }
  function nameOf(id) { const p = room && room.players.find(p => p.id === id); return p ? p.name : '???'; }
  function saveSession() {
    if (you && room) localStorage.setItem('frog_session', JSON.stringify({ code: room.code, token: you.token }));
  }
  function clearSession() { localStorage.removeItem('frog_session'); }

  function feed(text, cls) {
    feedItems.push({ text, cls });
    if (feedItems.length > 5) feedItems.shift();
    els.feed.innerHTML = feedItems.map(f => `<div class="feedItem ${f.cls || ''}">${f.text}</div>`).join('');
  }

  // ---------------------------------------------------------------- net
  function connect(onOpen) {
    if (ws && ws.readyState <= 1) { onOpen && onOpen(); return; }
    ws = new WebSocket(wsUrl);
    ws.onopen = () => onOpen && onOpen();
    ws.onmessage = e => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      handle(msg);
    };
    ws.onclose = () => {
      if (wantRoom) {
        feed('Connection lost — reconnecting…', 'bad');
        reconnectTimer = setTimeout(() => {
          connect(() => ws.send(JSON.stringify({ t: 'rejoin', code: wantRoom.code, token: wantRoom.token })));
        }, 1200);
      }
    };
  }
  function sendMsg(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  // ---------------------------------------------------------------- message handling
  function handle(msg) {
    switch (msg.t) {
      case 'welcome': {
        you = msg.you;
        room = msg;
        wantRoom = { code: msg.code, token: you.token };
        saveSession();
        Renderer.setSelf(you.id);
        onRoster(msg);
        break;
      }
      case 'room': onRoster(msg); break;
      case 'matchStart': {
        els.overlay.classList.add('hidden');
        Renderer.matchStart();
        show(els.game);
        els.getready.classList.remove('hidden');
        els.qCard.classList.add('faded');
        SFX.newQ();
        setTimeout(() => els.getready.classList.add('hidden'), 1400);
        feed('New race! First frog to floor 15 wins.');
        break;
      }
      case 'question': onQuestion(msg); break;
      case 'answered': {
        Renderer.markAnswered(msg.id);
        renderStandings();
        break;
      }
      case 'reveal': onReveal(msg); break;
      case 'winner': onWinner(msg); break;
      case 'error': {
        if (els.menu.classList.contains('hidden') && msg.fatal) {
          clearSession(); wantRoom = null;
          show(els.menu);
        }
        els.menuErr.textContent = msg.msg || 'Error';
        setTimeout(() => { els.menuErr.textContent = ''; }, 4000);
        break;
      }
    }
  }

  function onRoster(msg) {
    room = msg;
    Renderer.updateRoster(msg.players);
    els.roomTag.textContent = msg.code;
    const me = myPlayer();
    els.specTag.classList.toggle('hidden', !(me && me.spectator));

    // rejoined into a finished match: rebuild the winner overlay
    if (msg.phase === 'winner' && els.overlay.classList.contains('hidden')) {
      const tops = msg.players.filter(p => p.floor >= msg.floors);
      if (tops.length) {
        Renderer.setWinners(tops.map(p => p.id));
        const iWon = you && tops.some(p => p.id === you.id);
        els.overlay.classList.remove('hidden');
        els.overlayTitle.textContent = iWon ? 'YOU WIN!' : `${tops.map(p => p.name).join(' & ')} WINS!`;
        const isHost = you && msg.hostId === you.id;
        els.overlaySub.textContent = isHost ? 'Go again?' : 'Waiting for the host…';
        els.againBtn.classList.toggle('hidden', !isHost);
      }
    }

    if (msg.phase === 'lobby') {
      show(els.lobby);
      els.lobbyCode.textContent = msg.code;
      els.lobbyPlayers.innerHTML = msg.players.map(p => {
        const col = FROG_COLORS[p.color % FROG_COLORS.length];
        return `<div class="lobbyFrog"><span class="chip" style="background:${col.body}"></span>${p.name}${p.id === msg.hostId ? ' <span class="hostTag">HOST</span>' : ''}${p.connected ? '' : ' (zzz)'}</div>`;
      }).join('');
      const isHost = you && msg.hostId === you.id;
      els.startBtn.classList.toggle('hidden', !isHost);
      els.lobbyHint.textContent = isHost
        ? (msg.players.length === 1 ? 'You can practice solo, or wait for more frogs.' : 'Ready when you are.')
        : 'Waiting for the host to start…';
    } else {
      show(els.game);
    }
    renderStandings();
  }

  function onQuestion(msg) {
    current = msg;
    myPick = typeof msg.yourAnswer === 'number' ? msg.yourAnswer : null;
    clockOffset = msg.now - Date.now();
    Renderer.clearAnswered();
    els.overlay.classList.add('hidden');
    els.getready.classList.add('hidden');
    els.qCard.classList.remove('faded');
    show(els.game);

    els.qNum.textContent = 'Q' + msg.num;
    els.qCat.textContent = msg.cat;
    els.qText.textContent = msg.text;
    els.answers.innerHTML = '';
    msg.options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.className = 'ans';
      b.innerHTML = `<span class="key">${i + 1}</span><span class="optText">${opt}</span><span class="pickRow" data-i="${i}"></span>`;
      b.onclick = () => pick(i);
      if (myPick === i) b.classList.add('picked');
      els.answers.appendChild(b);
    });
    const me = myPlayer();
    els.answers.classList.toggle('locked', !!(me && me.spectator) || myPick !== null);
    if (!(me && me.spectator)) SFX.newQ();
    runTimer();
    renderStandings();
  }

  function pick(i) {
    const me = myPlayer();
    if (!current || myPick !== null || (me && me.spectator)) return;
    if (serverNow() > current.deadline) return;
    myPick = i;
    sendMsg({ t: 'answer', idx: i });
    SFX.click();
    [...els.answers.children].forEach((b, j) => b.classList.toggle('picked', j === i));
    els.answers.classList.add('locked');
  }

  let lastTickSec = -1;
  function runTimer() {
    cancelAnimationFrame(timerRAF);
    const step = () => {
      if (!current) return;
      const total = current.deadline - current.now;
      const left = Math.max(0, current.deadline - serverNow());
      const frac = Math.max(0, Math.min(1, left / total));
      els.timerBar.style.width = (frac * 100) + '%';
      els.timerBar.className = frac < 0.2 ? 'danger' : frac < 0.5 ? 'warn' : '';
      const sec = Math.ceil(left / 1000);
      els.timerWrap.dataset.sec = sec;
      if (sec !== lastTickSec) {
        lastTickSec = sec;
        if (sec <= 3 && sec > 0 && myPick === null) SFX.tick();
      }
      if (left > 0) timerRAF = requestAnimationFrame(step);
    };
    step();
  }

  function onReveal(msg) {
    current = null;
    cancelAnimationFrame(timerRAF);
    els.timerBar.style.width = '0%';

    // paint answer buttons
    [...els.answers.children].forEach((b, i) => {
      b.classList.add('done');
      if (i === msg.correctIdx) b.classList.add('correct');
      else if (myPick === i) b.classList.add('wrongPick');
      // frog chips showing who picked what
      const chipRow = b.querySelector('.pickRow');
      const pickers = Object.entries(msg.picks).filter(([, idx]) => idx === i);
      chipRow.innerHTML = pickers.map(([id]) => {
        const p = room.players.find(p => p.id === id);
        if (!p) return '';
        const col = FROG_COLORS[p.color % FROG_COLORS.length];
        return `<span class="chip small" title="${p.name}" style="background:${col.body}"></span>`;
      }).join('');
    });
    els.answers.classList.add('locked');

    // my result sound
    const mine = msg.results.find(r => you && r.id === you.id);
    if (mine) {
      if (mine.correct) SFX.correct(); else SFX.wrong();
      if (mine.correct) setTimeout(() => SFX.hop(), 400);
      else setTimeout(() => SFX.kick(), 850);
    }

    // update roster floors from results
    for (const r of msg.results) {
      const p = room.players.find(p => p.id === r.id);
      if (p) p.floor = r.to;
    }

    Renderer.startReveal(msg);

    // feed lines
    const fastest = msg.results.find(r => r.fastest);
    if (fastest) feed(`${nameOf(fastest.id)} was fastest — up 2 floors!`, 'good');
    const kicked = msg.results.filter(r => r.kicked);
    if (kicked.length) {
      const names = kicked.map(r => nameOf(r.id)).join(', ');
      feed(`The businessman kicked ${names} down!`, 'bad');
    }
    if (!msg.results.some(r => r.answered)) feed('Nobody answered?! The tower echoes with boots.', 'bad');
    setTimeout(renderStandings, 1500);
  }

  function onWinner(msg) {
    Renderer.setWinners(msg.ids);
    const iWon = you && msg.ids.includes(you.id);
    if (iWon) SFX.win(); else SFX.lose();
    els.overlay.classList.remove('hidden');
    els.overlayTitle.textContent = iWon ? 'YOU WIN!' : `${msg.ids.map(nameOf).join(' & ')} WINS!`;
    els.overlaySub.textContent = iWon
      ? 'You reached the roof party. The businessman is furious.'
      : 'Better hops next time.';
    const isHost = room && you && room.hostId === you.id;
    els.againBtn.classList.toggle('hidden', !isHost);
    els.overlaySub.textContent += isHost ? '' : ' Waiting for the host…';
    renderStandings();
  }

  function renderStandings() {
    if (!room) return;
    const rows = room.players
      .filter(p => !p.spectator)
      .sort((a, b) => b.floor - a.floor)
      .map(p => {
        const col = FROG_COLORS[p.color % FROG_COLORS.length];
        const me = you && p.id === you.id;
        return `<div class="standRow ${me ? 'me' : ''}">
          <span class="chip" style="background:${col.body}"></span>
          <span class="standName">${p.name}${p.connected ? '' : ' (zzz)'}</span>
          <span class="standFloor">${p.floor >= 15 ? 'ROOF' : 'F' + p.floor}</span>
        </div>`;
      }).join('');
    const specs = room.players.filter(p => p.spectator);
    els.standings.innerHTML = rows +
      (specs.length ? `<div class="specRow">WATCHING: ${specs.map(s => s.name).join(', ')}</div>` : '');
  }

  // ---------------------------------------------------------------- UI events
  els.createBtn.onclick = () => {
    const name = els.nameInput.value.trim();
    if (!name) { els.menuErr.textContent = 'Name your frog first.'; return; }
    localStorage.setItem('frog_name', name);
    SFX.click();
    connect(() => sendMsg({ t: 'create', name }));
  };
  els.joinBtn.onclick = () => {
    const name = els.nameInput.value.trim();
    const code = els.joinCode.value.trim().toUpperCase();
    if (!name) { els.menuErr.textContent = 'Name your frog first.'; return; }
    if (code.length !== 4) { els.menuErr.textContent = 'Room codes are 4 letters.'; return; }
    localStorage.setItem('frog_name', name);
    SFX.click();
    connect(() => sendMsg({ t: 'join', code, name }));
  };
  els.joinCode.oninput = () => { els.joinCode.value = els.joinCode.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); };
  els.startBtn.onclick = () => { SFX.click(); sendMsg({ t: 'start' }); };
  els.againBtn.onclick = () => { SFX.click(); sendMsg({ t: 'start' }); };
  els.copyBtn.onclick = () => {
    navigator.clipboard && navigator.clipboard.writeText(els.lobbyCode.textContent);
    els.copyBtn.textContent = 'COPIED!';
    setTimeout(() => { els.copyBtn.textContent = 'COPY'; }, 1200);
  };
  function leave() {
    sendMsg({ t: 'leave' });
    wantRoom = null; you = null; room = null; current = null;
    clearSession();
    clearTimeout(reconnectTimer);
    show(els.menu);
  }
  els.leaveBtn.onclick = leave;
  els.overlayLeaveBtn.onclick = () => { els.overlay.classList.add('hidden'); leave(); };

  document.addEventListener('keydown', e => {
    if (els.game.classList.contains('hidden')) return;
    const k = e.key;
    let i = -1;
    if (k >= '1' && k <= '4') i = k.charCodeAt(0) - 49;
    if (i >= 0) pick(i);
  });

  // ---------------------------------------------------------------- boot
  Renderer.init(els.canvas);
  els.nameInput.value = localStorage.getItem('frog_name') || '';

  // pixel frog logo on the menu
  for (const id of ['logoFrogL', 'logoFrogR']) {
    const c = document.getElementById(id);
    if (!c) continue;
    const col = FROG_COLORS[0];
    c.getContext('2d').drawImage(makeSprite(FROG_IDLE, { 1: col.body, 2: col.belly, 3: col.dark }), 0, 0);
  }

  // try to resume a previous session
  const saved = localStorage.getItem('frog_session');
  if (saved) {
    try {
      const s = JSON.parse(saved);
      wantRoom = s;
      connect(() => sendMsg({ t: 'rejoin', code: s.code, token: s.token }));
    } catch { clearSession(); }
  }
})();
