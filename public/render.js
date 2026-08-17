// FROG TOWER — first-person renderer.
// You are the frog, inside EVILCORP tower. Answer, then hop to the door to climb.
// Corporate-evil interior; the jungle party stays outside the windows and on the roof.
'use strict';

const Renderer = (() => {
  const W = 240, H = 180;
  const FLOORS = 15;
  const HORIZON = 62, FOCAL = 92, LAT = 0.30, CAM = 1.4;
  const ROOM_HALF = 3.2, DOOR_Z = 10, MAX_Z = 9.0, MIN_Z = 0.4, MAX_X = 2.6;

  let cv, ctx, sprites, handL, handR, bizFront, bizLean, crown, backSprites;
  let selfId = null;
  let roster = [];
  let myFloor = 0, spectating = false;
  let phase = 'idle'; // idle | question | reveal | roof
  let winners = [];

  // player (camera)
  const me = { px: 0, pz: 1.0, hopT: -999, hopFrom: null, hopTo: null };
  let doorUnlocked = false, express = false;
  let pending = null;        // { to } climb owed after reaching the door
  let kick = null;           // { t0 } my own kick sequence
  let transition = null;     // { t0, to, floors, express }
  let redVignette = 0;
  let ghosts = new Map();    // id -> ghost
  let particles = [];
  let shake = 0;

  const now = () => performance.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sfx = name => { try { window.SFX && window.SFX[name] && window.SFX[name](); } catch {} };

  function hashRand(a, b, c) {
    let h = (a * 374761393 + b * 668265263 + (c || 0) * 2147483647) >>> 0;
    h = (h ^ (h >> 13)) * 1274126177 >>> 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    sprites = buildFrogSprites();
    backSprites = FROG_COLORS.map(col => makeSprite(FROG_BACK, { 1: col.body, 2: col.belly, 3: col.dark }));
    handL = makeSprite(FROG_HAND, { 1: FROG_COLORS[0].body, 2: FROG_COLORS[0].belly });
    bizFront = makeSprite(BIZ_FRONT);
    bizLean = makeSprite(BIZ_LEAN);
    crown = makeSprite(CROWN);
    requestAnimationFrame(frame);
  }

  function setSelf(id) { selfId = id; refreshHands(); }
  function refreshHands() {
    const p = roster.find(p => p.id === selfId);
    const col = FROG_COLORS[(p ? p.color : 0) % FROG_COLORS.length];
    handL = makeSprite(FROG_HAND, { 1: col.body, 2: col.belly });
  }

  // ------------------------------------------------------------ state from client
  function updateRoster(players) {
    roster = players;
    const meP = players.find(p => p.id === selfId);
    if (meP) {
      spectating = !!meP.spectator;
      if (!pending && !transition && !kick) myFloor = meP.floor;
    }
    refreshHands();
    syncGhosts();
  }

  function syncGhosts() {
    const slots = [-1.9, 1.9, -2.5, 2.5, 1.1];
    let s = 0;
    const seen = new Set();
    for (const p of roster) {
      if (p.id === selfId || p.spectator || p.floor !== myFloor) continue;
      seen.add(p.id);
      if (!ghosts.has(p.id)) {
        ghosts.set(p.id, { color: p.color, x: slots[s % slots.length], z: 1.4 + (s % 3) * 0.5, state: 'idle', t0: now() });
      }
      s++;
    }
    for (const id of [...ghosts.keys()]) if (!seen.has(id)) ghosts.delete(id);
  }

  function matchStart() {
    winners = [];
    phase = 'idle';
    myFloor = 0; pending = null; kick = null; transition = null;
    doorUnlocked = false; express = false; redVignette = 0;
    me.px = 0; me.pz = 1.0;
    ghosts.clear();
    syncGhosts();
  }

  function newQuestion() {
    // consume an unclaimed climb instantly (elevator catch-up)
    if (pending) {
      myFloor = pending.to;
      pending = null;
      sfx('ding');
    }
    phase = 'question';
    doorUnlocked = false; express = false;
    kick = null; transition = null;
    me.px = 0; me.pz = 1.0;
    ghosts.clear();
    syncGhosts();
  }

  function startReveal(data) {
    phase = 'reveal';
    const t0 = now();
    const mine = data.results.find(r => r.id === selfId);
    if (mine) {
      if (mine.correct) {
        express = mine.fastest;
        pending = { to: mine.to };
        setTimeout(() => { doorUnlocked = true; sfx('ding'); }, 400);
      } else if (mine.kicked) {
        kick = { t0: t0 + 600, to: mine.to, from: mine.from };
      }
    }
    // ghosts act out their results
    for (const r of data.results) {
      const g = ghosts.get(r.id);
      if (!g) continue;
      g.state = r.correct ? 'exit' : 'falling';
      g.t0 = t0 + 500 + Math.random() * 400;
    }
  }

  function setWinners(ids) {
    winners = ids;
    phase = 'roof';
    burstConfetti();
  }

  function markAnswered(id) {
    const g = ghosts.get(id);
    if (g && g.state === 'idle') { g.state = 'toDoor'; g.t0 = now(); }
  }
  function clearAnswered() {}

  // ------------------------------------------------------------ movement
  function move(dir) {
    if (spectating || phase === 'roof' || kick || transition) return;
    const t = now();
    if (t - me.hopT < 150) return;
    me.hopT = t;
    const step = 0.85;
    if (dir === 'left') me.px = clamp(me.px - step, -MAX_X, MAX_X);
    if (dir === 'right') me.px = clamp(me.px + step, -MAX_X, MAX_X);
    if (dir === 'up') me.pz = clamp(me.pz + step, MIN_Z, MAX_Z);
    if (dir === 'down') me.pz = clamp(me.pz - step, MIN_Z, MAX_Z);
    sfx('hop');
  }

  function checkDoor() {
    if (!doorUnlocked || !pending || transition || kick) return;
    if (me.pz > 7.7 && Math.abs(me.px) < 1.2) {
      transition = { t0: now(), to: pending.to, floors: pending.to - myFloor, express };
      doorUnlocked = false;
      sfx('stairs');
    }
  }

  // ------------------------------------------------------------ projection
  function proj(x, z) {
    const dz = Math.max(0.12, z - me.pz + CAM);
    const s = FOCAL / dz;
    return {
      sx: W / 2 + (x - me.px) * s * LAT,
      fy: HORIZON + s * 1.05,
      cy: HORIZON - s * 0.78,
      s,
    };
  }

  // ------------------------------------------------------------ scene
  const SUNSET = ['#33205e', '#5e2a66', '#a03a5e', '#d8584a', '#f08a52', '#f8c06a'];

  function drawRoom(t, bob) {
    ctx.save();
    ctx.translate(shake ? (Math.random() - 0.5) * shake : 0, bob);

    // ceiling + floor base
    ctx.fillStyle = '#1c1c22';
    ctx.fillRect(-4, -4, W + 8, HORIZON + 4);
    ctx.fillStyle = '#26262c';
    ctx.fillRect(-4, HORIZON, W + 8, H - HORIZON + 8);

    // depth bands far -> near
    for (let z = DOOR_Z; z > me.pz - 1; z -= 0.5) {
      const a = proj(0, z), b = proj(0, z - 0.5);
      const wl = proj(-ROOM_HALF, z), wr = proj(ROOM_HALF, z);
      const wl2 = proj(-ROOM_HALF, z - 0.5), wr2 = proj(ROOM_HALF, z - 0.5);
      const band = Math.floor(z * 2);
      // carpet: charcoal with blood-red corporate stripes
      ctx.fillStyle = band % 4 === 0 ? '#3d2228' : (band % 2 === 0 ? '#2b2b31' : '#26262b');
      ctx.beginPath();
      ctx.moveTo(wl.sx, a.fy); ctx.lineTo(wr.sx, a.fy);
      ctx.lineTo(wr2.sx, b.fy); ctx.lineTo(wl2.sx, b.fy);
      ctx.closePath(); ctx.fill();
      // ceiling tiles
      ctx.fillStyle = band % 2 === 0 ? '#1e1e24' : '#1a1a20';
      ctx.beginPath();
      ctx.moveTo(wl.sx, a.cy); ctx.lineTo(wr.sx, a.cy);
      ctx.lineTo(wr2.sx, b.cy); ctx.lineTo(wl2.sx, b.cy);
      ctx.closePath(); ctx.fill();
      // cold fluorescent light bars every 2 units
      if (band % 4 === 2) {
        const lw = (wr.sx - wl.sx) * 0.3;
        const flick = hashRand(band, 7) < 0.12 && Math.sin(t / 60 + band) > 0.7;
        ctx.fillStyle = flick ? '#55555f' : '#e8e8f2';
        ctx.fillRect(W / 2 - lw / 2 - (me.px * 6), a.cy + 1, lw, Math.max(1, a.s * 0.05));
      }
      // walls
      ctx.fillStyle = band % 2 === 0 ? '#33333b' : '#2f2f37';
      ctx.beginPath();
      ctx.moveTo(wl.sx, a.cy); ctx.lineTo(wl.sx, a.fy);
      ctx.lineTo(wl2.sx, b.fy); ctx.lineTo(wl2.sx, b.cy);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(wr.sx, a.cy); ctx.lineTo(wr.sx, a.fy);
      ctx.lineTo(wr2.sx, b.fy); ctx.lineTo(wr2.sx, b.cy);
      ctx.closePath(); ctx.fill();
      // baseboard line
      ctx.fillStyle = '#17171c';
      ctx.fillRect(wl.sx, a.fy - 1, 2, 2);
      ctx.fillRect(wr.sx - 2, a.fy - 1, 2, 2);
    }

    drawWallDecor(t);
    drawBackWall(t);
    drawGhosts(t);
    ctx.restore();
  }

  function drawWallDecor(t) {
    // windows on the right wall: the jungle party glows outside
    for (const wz of [3.2, 6.2]) {
      if (wz < me.pz - 0.5) continue;
      const a = proj(ROOM_HALF, wz + 0.9), b = proj(ROOM_HALF, wz);
      const top = (a.cy + a.fy) / 2 - a.s * 0.42, bot = (a.cy + a.fy) / 2 + a.s * 0.18;
      ctx.fillStyle = '#0d0d10';
      ctx.beginPath();
      ctx.moveTo(a.sx, top); ctx.lineTo(b.sx, top + 2);
      ctx.lineTo(b.sx, bot + 2); ctx.lineTo(a.sx, bot);
      ctx.closePath(); ctx.fill();
      // sunset bands inside the frame
      const hgt = bot - top;
      SUNSET.forEach((col, i) => {
        ctx.fillStyle = col;
        const y0 = top + (hgt * i) / SUNSET.length;
        ctx.beginPath();
        ctx.moveTo(a.sx + 1, y0 + 1); ctx.lineTo(b.sx - 1, y0 + 2);
        ctx.lineTo(b.sx - 1, y0 + hgt / SUNSET.length + 2); ctx.lineTo(a.sx + 1, y0 + hgt / SUNSET.length + 1);
        ctx.closePath(); ctx.fill();
      });
      // party bunting glimpsed outside + a vine creeping in
      ctx.fillStyle = '#e85e4e';
      ctx.fillRect((a.sx + b.sx) / 2 - 2, top + hgt * 0.3, 2, 2);
      ctx.fillStyle = '#f0c840';
      ctx.fillRect((a.sx + b.sx) / 2 + 2, top + hgt * 0.35, 2, 2);
      ctx.fillStyle = '#3a7a3a';
      ctx.fillRect(a.sx, top, 2, Math.max(3, hgt * 0.5));
      ctx.fillStyle = '#57a557';
      ctx.fillRect(a.sx + 1, top + hgt * 0.3, 2, 2);
    }
    // EVILCORP plaque on the left wall
    const pz = 4.8;
    if (pz > me.pz - 0.5) {
      const a = proj(-ROOM_HALF, pz + 1.4), b = proj(-ROOM_HALF, pz);
      const mid = (a.cy + a.fy) / 2 - a.s * 0.28;
      ctx.fillStyle = '#0d0d10';
      ctx.beginPath();
      ctx.moveTo(a.sx, mid - 4); ctx.lineTo(b.sx, mid - 3);
      ctx.lineTo(b.sx, mid + a.s * 0.16 + 3); ctx.lineTo(a.sx, mid + a.s * 0.16 + 2);
      ctx.closePath(); ctx.fill();
      if (a.s > 40) drawTinyText(ctx, 'EVILCORP', Math.min(a.sx, b.sx) + 3, mid, '#d02a2a', 1);
    }
    // cubicles: dark monoliths with cold monitor glow
    for (const [cx, cz] of [[-2.2, 2.2], [2.2, 4.6], [-2.3, 7.0]]) {
      if (cz < me.pz - 0.3) continue;
      const p = proj(cx, cz);
      const h = p.s * 0.5, w = p.s * 0.42;
      ctx.fillStyle = '#202027';
      ctx.fillRect(p.sx - w / 2, p.fy - h, w, h);
      ctx.fillStyle = '#17171c';
      ctx.fillRect(p.sx - w / 2, p.fy - h, w, 2);
      const flicker = Math.sin(t / 300 + cz * 5) > -0.6;
      ctx.fillStyle = flicker ? '#3fd0c8' : '#2a8a85';
      ctx.fillRect(p.sx - w / 6, p.fy - h * 0.72, w / 3, h / 5);
    }
    // one sad office plant, slightly vined
    const pp = proj(1.9, 8.0);
    if (8.0 > me.pz - 0.3) {
      ctx.fillStyle = '#4a3020';
      ctx.fillRect(pp.sx - pp.s * 0.05, pp.fy - pp.s * 0.14, pp.s * 0.1, pp.s * 0.14);
      ctx.fillStyle = '#3a6a3a';
      ctx.fillRect(pp.sx - pp.s * 0.09, pp.fy - pp.s * 0.26, pp.s * 0.18, pp.s * 0.13);
      ctx.fillStyle = '#57a557';
      ctx.fillRect(pp.sx - pp.s * 0.02, pp.fy - pp.s * 0.3, pp.s * 0.05, pp.s * 0.06);
    }
  }

  function drawBackWall(t) {
    const a = proj(-ROOM_HALF, DOOR_Z + 0.6), b = proj(ROOM_HALF, DOOR_Z + 0.6);
    // wall slab
    ctx.fillStyle = '#2a2a31';
    ctx.fillRect(a.sx, a.cy, b.sx - a.sx, a.fy - a.cy);
    ctx.fillStyle = '#17171c';
    ctx.fillRect(a.sx, a.fy - 2, b.sx - a.sx, 2);
    // EVILCORP branding, cold and red
    const midX = (a.sx + b.sx) / 2;
    if (a.s > 20) {
      const tw = tinyTextWidth('EVILCORP', 1);
      ctx.fillStyle = '#0d0d10';
      ctx.fillRect(midX - tw / 2 - 2, a.cy + 4, tw + 4, 9);
      const buzz = Math.sin(t / 280) > -0.75;
      drawTinyText(ctx, 'EVILCORP', midX - tw / 2, a.cy + 6, buzz ? '#d02a2a' : '#5a1414', 1);
    }
    // floor number stencil
    const label = 'FLOOR ' + Math.min(FLOORS, myFloor + 1);
    const lw = tinyTextWidth(label, 1);
    drawTinyText(ctx, label, a.sx + 4, a.cy + 5, '#6a6a74', 1);

    // the door
    const d = proj(0, DOOR_Z);
    const dw = d.s * 0.62, dh = d.s * 0.95;
    const dx = d.sx - dw / 2, dy = d.fy - dh;
    ctx.fillStyle = '#0d0d10';
    ctx.fillRect(dx - 2, dy - 2, dw + 4, dh + 2);
    ctx.fillStyle = doorUnlocked ? '#1d3a24' : '#17171c';
    ctx.fillRect(dx, dy, dw, dh);
    // light spilling out when open
    if (doorUnlocked) {
      const pulse = 0.6 + 0.4 * Math.sin(t / 180);
      ctx.fillStyle = `rgba(87,213,87,${0.25 * pulse})`;
      ctx.beginPath();
      ctx.moveTo(dx, d.fy); ctx.lineTo(dx + dw, d.fy);
      ctx.lineTo(dx + dw + 14, d.fy + 16); ctx.lineTo(dx - 14, d.fy + 16);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#57d545';
      ctx.fillRect(dx + dw - 4, dy + dh / 2, 2, 2);
      // bouncing arrow
      const ay = dy - 8 + Math.round(Math.sin(t / 150) * 2);
      ctx.fillStyle = '#57d557';
      ctx.fillRect(d.sx - 1, ay, 2, 5);
      ctx.fillRect(d.sx - 3, ay + 4, 6, 2);
    } else {
      ctx.fillStyle = '#e02828';
      ctx.fillRect(dx + dw - 4, dy + dh / 2, 2, 2);
    }
    // split line + UP sign
    ctx.fillStyle = '#0d0d10';
    ctx.fillRect(d.sx, dy, 1, dh);
    if (d.s > 26) drawTinyText(ctx, 'UP', d.sx - 3, dy - (doorUnlocked ? 15 : 7), doorUnlocked ? '#57d557' : '#6a6a74', 1);
  }

  function drawGhosts(t) {
    for (const [id, g] of ghosts) {
      let gx = g.x, gz = g.z, alpha = 0.75, flat = 1;
      if (g.state === 'toDoor') {
        const p = clamp((t - g.t0) / 1200, 0, 1);
        gz = g.z + (8.6 - g.z) * p;
        gx = g.x * (1 - p);
      } else if (g.state === 'exit') {
        const p = clamp((t - g.t0) / 700, 0, 1);
        gz = 8.6; gx = 0; alpha = 0.75 * (1 - p);
        if (p >= 1) { ghosts.delete(id); continue; }
      } else if (g.state === 'falling') {
        const p = clamp((t - g.t0) / 900, 0, 1);
        alpha = 0.75 * (1 - p);
        flat = 1 - p * 0.5;
        if (p >= 1) { ghosts.delete(id); continue; }
      } else {
        gz += Math.sin(t / 600 + g.x * 3) * 0.05; // idle shuffle
      }
      if (gz < me.pz - 0.2) continue;
      const p = proj(gx, gz);
      const spr = backSprites[g.color % backSprites.length];
      const gw = Math.max(4, p.s * 0.30), gh = Math.max(3, p.s * 0.24 * flat);
      const hopY = g.state === 'toDoor' ? Math.abs(Math.sin(t / 90)) * p.s * 0.06 : 0;
      ctx.globalAlpha = alpha;
      ctx.drawImage(spr, p.sx - gw / 2, p.fy - gh - hopY, gw, gh);
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------ overlays
  function drawHands(t, bob) {
    if (spectating || phase === 'roof') return;
    const hop = clamp((now() - me.hopT) / 150, 0, 1);
    const lift = Math.sin(hop * Math.PI) * 7;
    const sway = Math.sin(t / 900) * 2;
    const y = H - 16 + bob * 0.5 - lift;
    ctx.drawImage(handL, 34 + sway, y, 30, 24);
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(handL, -(W - 34 + sway) - 30, y + 1, 30, 24);
    ctx.restore();
  }

  function drawKick(t) {
    if (!kick) return;
    const el = t - kick.t0;
    if (el < 0) return;
    if (el < 500) {
      // elevator doors burst open, stage right
      const p = el / 500;
      ctx.fillStyle = '#17171c';
      ctx.fillRect(W - 60, 30, 60, H - 60);
      ctx.fillStyle = '#3a3a42';
      ctx.fillRect(W - 60, 30, 30 * (1 - p), H - 60);
      ctx.fillRect(W - 30 * (1 - p), 30, 30 * (1 - p), H - 60);
      ctx.fillStyle = '#f8c06a';
      ctx.fillRect(W - 58, 32, 56, 3);
      if (el < 60) sfx('ding');
    } else if (el < 1100) {
      // he approaches, growing
      const p = (el - 500) / 600;
      const s = 40 + p * 150;
      ctx.drawImage(bizFront, W / 2 - s / 2 + (1 - p) * 55, H - 30 - s * 1.35, s, s * 1.35);
      if (p > 0.4) shake = 1.5;
    } else if (el < 1400) {
      // THE BOOT fills the screen
      const p = (el - 1100) / 300;
      const s = 60 + p * 260;
      ctx.fillStyle = '#0d0d10';
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2 + 10, s, s * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#26262c';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(W / 2 - s * 0.7 + i * s * 0.32, H / 2 - 4, s * 0.14, 8 + s * 0.05);
      }
      shake = 5;
      if (el - 1100 < 40) sfx('kick');
    } else if (el < 2400) {
      // tumbling out of the building — sky spins, windows streak past
      const p = (el - 1400) / 1000;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(p * Math.PI * 4);
      const g = Math.floor(p * SUNSET.length);
      ctx.fillStyle = SUNSET[clamp(g, 0, SUNSET.length - 1)];
      ctx.fillRect(-W, -H, W * 2, H * 2);
      ctx.fillStyle = '#f8c86a';
      for (let i = 0; i < 8; i++) {
        const wy = ((i * 53 + p * 700) % (H * 2)) - H;
        ctx.fillRect(-40 + (i % 3) * 40, wy, 14, 10);
        ctx.fillStyle = i % 2 ? '#f8c86a' : '#1d4a50';
      }
      ctx.restore();
      shake = 2;
    } else if (el < 2900) {
      // splat back onto a lower floor
      if (el - 2400 < 40) { sfx('land'); dustBurst(); myFloor = kick.to; }
      redVignette = 0.5 * (1 - (el - 2400) / 500);
      shake = (el - 2400) < 150 ? 4 : 0;
    } else {
      kick = null;
      shake = 0;
      me.px = 0; me.pz = 1.0;
    }
  }

  function drawTransition(t) {
    if (!transition) return;
    const per = transition.express ? 480 : 650;
    const total = per * transition.floors + (transition.express ? 350 : 0);
    const el = t - transition.t0;
    const flr = Math.min(transition.floors - 1, Math.floor(el / per));
    const p = clamp((el - flr * per) / per, 0, 1);
    // stairwell wipe: dark band sweeps up with steps
    ctx.fillStyle = '#111116';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1e1e24';
    for (let i = 0; i < 8; i++) {
      const sy = H - ((p + i / 8) % 1) * (H + 30);
      ctx.fillRect(30 + (i % 2) * 20, sy, W - 100, 12);
    }
    const label = 'FLOOR ' + Math.min(FLOORS, myFloor + flr + 1 + 1);
    const lw2 = tinyTextWidth(label, 2);
    drawTinyText(ctx, label, W / 2 - lw2 / 2 + 1, H / 2 - 4 + 1, '#0d0d10', 2);
    drawTinyText(ctx, label, W / 2 - lw2 / 2, H / 2 - 5, '#f8f0d8', 2);
    if (transition.express) {
      const flash = Math.sin(t / 90) > 0;
      if (flash) {
        const ew = tinyTextWidth('EXPRESS', 1);
        drawTinyText(ctx, 'EXPRESS', W / 2 - ew / 2, H / 2 + 12, '#f0c840', 1);
      }
    }
    const bobStep = Math.abs(Math.sin(el / 110)) * 3;
    ctx.drawImage(handL, 30, H - 20 - bobStep, 26, 20);
    ctx.save(); ctx.scale(-1, 1);
    ctx.drawImage(handL, -(W - 30) - 26, H - 19 - bobStep, 26, 20);
    ctx.restore();
    if (el >= total) {
      myFloor = transition.to;
      pending = null;
      transition = null;
      me.px = 0; me.pz = 1.0;
      ghosts.clear(); syncGhosts();
    }
  }

  // ------------------------------------------------------------ roof party (win)
  function drawRoof(t) {
    // jungle-party sky — the reward for escaping the office
    const bandH = Math.ceil(H / SUNSET.length);
    SUNSET.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * bandH, W, bandH); });
    for (let i = 0; i < 24; i++) {
      const sx = Math.floor(hashRand(i, 3) * W), sy = Math.floor(hashRand(i, 9) * 60);
      if (Math.sin(t / 600 + i) > 0.3) { ctx.fillStyle = '#fff8e8'; ctx.fillRect(sx, sy, 1, 1); }
    }
    // stark corporate monolith sign, back of roof
    ctx.fillStyle = '#0d0d10';
    ctx.fillRect(W / 2 - 52, 26, 104, 22);
    ctx.fillStyle = '#17171c';
    ctx.fillRect(W / 2 - 52, 48, 104, 3);
    const buzz = Math.sin(t / 250) > -0.8;
    drawTinyText(ctx, 'EVILCORP', W / 2 - tinyTextWidth('EVILCORP', 2) / 2, 31, buzz ? '#d02a2a' : '#5a1414', 2);
    ctx.fillStyle = '#e02828';
    if (Math.sin(t / 400) > 0) ctx.fillRect(W / 2 + 56, 20, 2, 2); // aircraft beacon
    ctx.fillStyle = '#26262c';
    ctx.fillRect(W / 2 + 55, 22, 4, 26);
    // roof deck
    ctx.fillStyle = '#3a3a42';
    ctx.fillRect(0, H - 42, W, 42);
    ctx.fillStyle = '#2b2b31';
    ctx.fillRect(0, H - 42, W, 3);
    // the party: bunting strung across
    for (let x = 8; x < W - 8; x += 12) {
      const sag = Math.sin((x / W) * Math.PI) * 6;
      ctx.fillStyle = ['#e85e4e', '#f0c840', '#4e9ee8', '#e894e8'][(x / 12 | 0) % 4];
      ctx.fillRect(x, 66 + sag, 4, 4);
      ctx.fillStyle = '#141419';
      ctx.fillRect(x, 65 + sag, 4, 1);
    }
    // dancing winner frogs (side-view sprites, scaled up)
    const ws = roster.filter(p => winners.includes(p.id));
    ws.forEach((p, i) => {
      const set = sprites[p.color % sprites.length];
      const bounce = Math.abs(Math.sin(t / 170 + i * 1.3)) * 9;
      const fx = W / 2 - (ws.length - 1) * 22 + i * 44 - 14;
      const fy = H - 44 - 24 - bounce;
      ctx.drawImage(bounce > 5 ? set.jump : set.idle, fx, fy, 28, 24);
      ctx.drawImage(crown, fx + 9, fy - 8, 10, 6);
      const tag = p.name.slice(0, 6).toUpperCase();
      drawTinyText(ctx, tag, fx + 14 - tinyTextWidth(tag, 1) / 2, fy - 16, '#f8f0d8', 1);
    });
    // furious businessman, stage left, hopping mad
    const stomp = Math.abs(Math.sin(t / 140)) * 4;
    ctx.drawImage(bizLean, 12, H - 44 - 26 - stomp, 32, 26);
    drawTinyText(ctx, 'NO!!', 18, H - 44 - 40 - stomp, '#d02a2a', 1);
    // confetti
    if (Math.random() < 0.35) {
      particles.push({
        x: Math.random() * W, y: -4,
        vx: (Math.random() - 0.5) * 12, vy: 16 + Math.random() * 14,
        g: 4, life: 3400, t0: t,
        color: ['#e85e4e', '#f0c840', '#4e9ee8', '#57d557', '#e894e8'][(Math.random() * 5) | 0],
      });
    }
  }

  function burstConfetti() {
    for (let i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * W, y: H / 2 - Math.random() * H / 2,
        vx: (Math.random() - 0.5) * 30, vy: -Math.random() * 20,
        g: 30, life: 2600, t0: now(),
        color: ['#e85e4e', '#f0c840', '#4e9ee8', '#57d557', '#e894e8', '#f8f8f0'][i % 6],
      });
    }
  }

  function dustBurst() {
    for (let i = 0; i < 14; i++) {
      particles.push({
        x: W / 2 + (Math.random() - 0.5) * 60, y: H - 30,
        vx: (Math.random() - 0.5) * 40, vy: -Math.random() * 26,
        g: 90, life: 500, t0: now(), color: '#6a6a74',
      });
    }
  }

  function drawParticles(t, dt) {
    particles = particles.filter(p => t - p.t0 < p.life);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
  }

  function drawHud(t) {
    if (phase === 'roof') return;
    const label = 'FLOOR ' + Math.min(FLOORS, myFloor + (myFloor >= FLOORS ? 0 : 1));
    drawTinyText(ctx, label, 5, 5, '#0d0d10', 1);
    drawTinyText(ctx, label, 4, 4, '#f8f0d8', 1);
    if (spectating) drawTinyText(ctx, 'SPECTATING', 4, 12, '#8a8a96', 1);
    if (doorUnlocked && !transition) {
      const flash = Math.sin(t / 160) > -0.3;
      if (flash) {
        const msg = express ? 'EXPRESS! HOP TO THE DOOR!' : 'HOP TO THE DOOR!';
        const mw = tinyTextWidth(msg, 1);
        drawTinyText(ctx, msg, W / 2 - mw / 2 + 1, 15, '#0d0d10', 1);
        drawTinyText(ctx, msg, W / 2 - mw / 2, 14, express ? '#f0c840' : '#57d557', 1);
      }
    }
    if (redVignette > 0) {
      ctx.fillStyle = `rgba(208,42,42,${redVignette})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ------------------------------------------------------------ main loop
  let lastT = 0;
  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    fitCanvas();

    checkDoor();

    ctx.fillStyle = '#111116';
    ctx.fillRect(0, 0, W, H);

    if (phase === 'roof') {
      drawRoof(t);
    } else if (transition) {
      drawTransition(t);
    } else if (kick && t - kick.t0 > 1400 && t - kick.t0 < 2400) {
      drawKick(t); // full-screen tumble replaces the room
    } else {
      const hop = clamp((now() - me.hopT) / 150, 0, 1);
      const bob = Math.sin(hop * Math.PI) * -3;
      drawRoom(t, bob);
      drawKick(t);
      drawHands(t, bob);
    }
    drawParticles(t, dt);
    drawHud(t);
    if (!kick) shake = Math.max(0, shake - dt * 20);

    requestAnimationFrame(frame);
  }

  let cssW = 0, cssH = 0;
  function fitCanvas() {
    const box = cv.parentElement.getBoundingClientRect();
    if (box.width === cssW && box.height === cssH) return;
    cssW = box.width; cssH = box.height;
    const scale = Math.max(1, Math.floor(Math.min(cssW / W, cssH / H) * 2) / 2);
    cv.width = W; cv.height = H;
    cv.style.width = (W * scale) + 'px';
    cv.style.height = (H * scale) + 'px';
    document.documentElement.style.setProperty('--viewW', (W * scale + 8) + 'px');
    ctx.imageSmoothingEnabled = false;
  }

  return {
    init,
    setSelf,
    updateRoster,
    matchStart,
    newQuestion,
    startReveal,
    setWinners,
    markAnswered,
    clearAnswered,
    move,
  };
})();
