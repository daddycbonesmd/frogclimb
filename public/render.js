// FROG TOWER — canvas renderer. Jungle-party skyscraper at dusk.
'use strict';

const Renderer = (() => {
  // internal pixel resolution
  const W = 200, H = 280;
  const FLOORS = 15;
  const STREET_TOP = 260;      // ground line
  const FLOOR_H = 15;
  const LANES = 6, LANE_W = 16;
  const TOWER_X = 48, TOWER_W = LANES * LANE_W + 8, TOWER_R = TOWER_X + TOWER_W;

  let cv, ctx, sprites, bizLean, bizKick, crown;
  let selfId = null;
  let frogs = new Map();       // id -> render state
  let bizList = [];            // active businessman kick animations
  let particles = [];
  let winners = [];
  let answeredIds = new Set();
  let parrots = [];
  let balloons = [];
  let nextParrotAt = 2000, nextBalloonAt = 4000;
  let confettiUntil = 0;

  const ledgeY = f => STREET_TOP - f * FLOOR_H;

  // deterministic per-position randomness so the tower decor is stable
  function hashRand(a, b, c) {
    let h = (a * 374761393 + b * 668265263 + (c || 0) * 2147483647) >>> 0;
    h = (h ^ (h >> 13)) * 1274126177 >>> 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    sprites = buildFrogSprites();
    bizLean = makeSprite(BIZ_LEAN);
    bizKick = makeSprite(BIZ_KICK);
    crown = makeSprite(CROWN);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ roster sync
  function updateRoster(players) {
    const seen = new Set();
    let lane = 0;
    for (const p of players.filter(p => !p.spectator)) {
      seen.add(p.id);
      let rs = frogs.get(p.id);
      if (!rs) {
        rs = { id: p.id, lane, floorF: p.floor, color: p.color, name: p.name,
               mode: 'idle', t0: 0, from: 0, to: 0, blinkAt: performance.now() + 1500 + Math.random() * 3000,
               connected: p.connected };
        frogs.set(p.id, rs);
      }
      rs.lane = lane++;
      rs.color = p.color;
      rs.name = p.name;
      rs.connected = p.connected;
      rs.targetFloor = p.floor;
      if (rs.mode === 'idle') rs.floorF = p.floor;
    }
    for (const id of [...frogs.keys()]) if (!seen.has(id)) frogs.delete(id);
  }

  function matchStart() {
    winners = [];
    answeredIds.clear();
    bizList = [];
    for (const rs of frogs.values()) { rs.floorF = 0; rs.mode = 'idle'; }
  }

  // ------------------------------------------------------------ reveal choreography
  function startReveal(data) {
    const now = performance.now();
    answeredIds.clear();
    for (const r of data.results) {
      const rs = frogs.get(r.id);
      if (!rs) continue;
      if (r.correct) {
        rs.mode = 'hop';
        rs.t0 = now + 400;
        rs.from = r.from;
        rs.to = r.to;
        rs.hops = Math.max(1, r.to - r.from);
        rs.fastest = r.fastest;
      } else {
        // businessman kick
        bizList.push({ lane: rs.lane, floor: r.from, t0: now, id: r.id });
        if (r.to < r.from) {
          rs.mode = 'fall';
          rs.t0 = now + 900;      // boot connects
          rs.from = r.from;
          rs.to = r.to;
        } else {
          rs.mode = 'bonk';       // already at street level, just gets booted in place
          rs.t0 = now + 900;
          rs.from = r.from; rs.to = r.to;
        }
      }
    }
  }

  function setWinners(ids) {
    winners = ids;
    confettiUntil = performance.now() + 60000;
    const now = performance.now();
    for (const id of ids) {
      const rs = frogs.get(id);
      if (rs) { rs.mode = 'dance'; rs.t0 = now; rs.floorF = FLOORS; }
    }
    burstConfetti();
  }

  function burstConfetti() {
    const cols = ['#e85e4e', '#f0c840', '#4e9ee8', '#57d557', '#e894e8', '#f8f8f0'];
    for (let i = 0; i < 90; i++) {
      particles.push({
        x: TOWER_X + Math.random() * TOWER_W, y: 10 + Math.random() * 30,
        vx: (Math.random() - 0.5) * 22, vy: -Math.random() * 12,
        g: 14, life: 2600 + Math.random() * 1600, t0: performance.now(),
        color: cols[i % cols.length], size: 1,
      });
    }
  }

  function dust(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: x + (Math.random() - 0.5) * 8, y,
        vx: (Math.random() - 0.5) * 18, vy: -Math.random() * 14 - 4,
        g: 60, life: 420, t0: performance.now(), color: color || '#d8cbaa', size: 1,
      });
    }
  }

  // ------------------------------------------------------------ scene painting
  const SKY_BANDS = [
    ['#1d1440', 46], ['#33205e', 44], ['#5e2a66', 40], ['#a03a5e', 40],
    ['#d8584a', 40], ['#f08a52', 38], ['#f8c06a', 32],
  ];

  function drawSky(t) {
    let y = 0;
    for (const [col, h] of SKY_BANDS) { ctx.fillStyle = col; ctx.fillRect(0, y, W, h); y += h; }
    // stars twinkle in the upper bands
    for (let i = 0; i < 34; i++) {
      const sx = Math.floor(hashRand(i, 7) * W);
      const sy = Math.floor(hashRand(i, 13) * 80);
      const tw = 0.5 + 0.5 * Math.sin(t / 700 + i * 1.7);
      if (tw > 0.55) {
        ctx.fillStyle = tw > 0.85 ? '#fff8e8' : '#c8b8e8';
        ctx.fillRect(sx, sy, 1, 1);
      }
    }
    // setting sun, low left
    ctx.fillStyle = '#f8e08a';
    ctx.beginPath();
    const sunX = 26, sunY = 205;
    for (let dy = -9; dy <= 9; dy++) {
      const w2 = Math.floor(Math.sqrt(Math.max(0, 81 - dy * dy)));
      ctx.fillRect(sunX - w2, sunY + dy, w2 * 2 + 1, 1);
    }
    ctx.fillStyle = '#f8f0c0';
    ctx.fillRect(sunX - 4, sunY - 4, 8, 8);
  }

  function drawClouds(t) {
    ctx.fillStyle = '#e8a0b8';
    for (let i = 0; i < 3; i++) {
      const speed = 4 + i * 2.5;
      const cx = ((t / 1000) * speed + i * 90) % (W + 50) - 25;
      const cy = 26 + i * 30;
      ctx.fillRect(cx, cy + 2, 22, 3);
      ctx.fillRect(cx + 4, cy, 13, 2);
      ctx.fillRect(cx + 3, cy + 5, 15, 2);
    }
  }

  function drawJungle(t) {
    // far canopy (purple haze)
    ctx.fillStyle = '#472a5e';
    for (let x = 0; x < W; x += 8) {
      const h = 28 + Math.floor(hashRand(x, 3) * 22);
      ctx.fillRect(x, STREET_TOP - h, 8, h);
      ctx.fillRect(x + 1, STREET_TOP - h - 4, 6, 4);
    }
    // far palms
    for (let i = 0; i < 4; i++) {
      const px = 12 + i * 55 + Math.floor(hashRand(i, 91) * 20);
      const ph = 46 + Math.floor(hashRand(i, 17) * 14);
      ctx.fillStyle = '#472a5e';
      ctx.fillRect(px, STREET_TOP - ph, 2, ph);
      for (let a = 0; a < 5; a++) {
        const dx = Math.round(Math.cos(a * 1.25 + 0.3) * 7);
        const dy = Math.round(Math.sin(a * 0.6) * 3) - 2;
        ctx.fillRect(px - dx, STREET_TOP - ph + dy - 2, dx > 0 ? dx + 2 : 2 - dx, 2);
      }
    }
    // near canopy (deep green) with fireflies
    ctx.fillStyle = '#1d3a2d';
    for (let x = 0; x < W; x += 6) {
      const h = 14 + Math.floor(hashRand(x, 5) * 16);
      ctx.fillRect(x, STREET_TOP - h, 6, h);
      ctx.fillRect(x + 1, STREET_TOP - h - 3, 4, 3);
    }
    for (let i = 0; i < 12; i++) {
      const fx = Math.floor(hashRand(i, 23) * W);
      const fy = STREET_TOP - 6 - Math.floor(hashRand(i, 29) * 26);
      const tw = Math.sin(t / 450 + i * 2.4);
      if (tw > 0.4) {
        ctx.fillStyle = '#f8e878';
        ctx.fillRect(fx + Math.round(Math.sin(t / 900 + i) * 3), fy, 1, 1);
      }
    }
  }

  const BUNT_COLS = ['#e85e4e', '#f0c840', '#4e9ee8', '#e894e8'];

  function drawTower(t) {
    // walls
    ctx.fillStyle = '#b0a488';
    ctx.fillRect(TOWER_X, ledgeY(FLOORS), TOWER_W, STREET_TOP - ledgeY(FLOORS));
    ctx.fillStyle = '#8a8068';
    ctx.fillRect(TOWER_X, ledgeY(FLOORS), 2, STREET_TOP - ledgeY(FLOORS));
    ctx.fillRect(TOWER_R - 2, ledgeY(FLOORS), 2, STREET_TOP - ledgeY(FLOORS));

    for (let f = 1; f <= FLOORS; f++) {
      const ly = ledgeY(f);
      // ledge line
      ctx.fillStyle = '#8a8068';
      ctx.fillRect(TOWER_X, ly - 1, TOWER_W, 1);
      ctx.fillStyle = '#d8cbaa';
      ctx.fillRect(TOWER_X, ly - 2, TOWER_W, 1);
      // windows
      for (let l = 0; l < LANES; l++) {
        const wx = TOWER_X + 4 + l * LANE_W + 3;
        const wy = ly - 12;
        const lit = hashRand(f, l, 41) < 0.3;
        ctx.fillStyle = '#141419';
        ctx.fillRect(wx - 1, wy - 1, 12, 11);
        ctx.fillStyle = lit ? '#f8c86a' : '#1d4a50';
        ctx.fillRect(wx, wy, 10, 9);
        if (!lit) { ctx.fillStyle = '#3a7a80'; ctx.fillRect(wx + 1, wy + 1, 3, 2); }
        ctx.fillStyle = '#141419';
        ctx.fillRect(wx + 4, wy, 1, 9); // mullion
      }
      // moss patches
      if (hashRand(f, 71) < 0.5) {
        const mx = TOWER_X + 3 + Math.floor(hashRand(f, 73) * (TOWER_W - 10));
        ctx.fillStyle = '#57a557';
        ctx.fillRect(mx, ly - 3, 3 + Math.floor(hashRand(f, 77) * 4), 1);
      }
      // party bunting every 3rd floor
      if (f % 3 === 0) {
        const by = ly - 14;
        ctx.fillStyle = '#141419';
        ctx.fillRect(TOWER_X + 2, by, TOWER_W - 4, 1);
        for (let x = TOWER_X + 4; x < TOWER_R - 6; x += 7) {
          ctx.fillStyle = BUNT_COLS[((x / 7) | 0) % BUNT_COLS.length];
          ctx.fillRect(x, by + 1, 3, 2);
          ctx.fillRect(x + 1, by + 3, 1, 1);
        }
      }
      // hanging lanterns on alternating floors
      if (f % 3 === 2) {
        for (let l = (f % 2); l < LANES; l += 2) {
          const lx = TOWER_X + 4 + l * LANE_W + 7;
          const glow = 0.6 + 0.4 * Math.sin(t / 500 + f * 2 + l);
          ctx.fillStyle = '#141419';
          ctx.fillRect(lx, ly - 2, 1, 2);
          ctx.fillStyle = glow > 0.8 ? '#f8d87a' : '#f0945a';
          ctx.fillRect(lx - 1, ly, 3, 3);
          ctx.fillStyle = '#f8f0c0';
          ctx.fillRect(lx, ly + 1, 1, 1);
        }
      }
    }

    // vines crawling up both tower edges
    for (let y = ledgeY(FLOORS); y < STREET_TOP; y += 2) {
      const wob = Math.round(Math.sin(y / 9) * 2);
      ctx.fillStyle = '#2e7a3e';
      ctx.fillRect(TOWER_X + 1 + wob, y, 2, 2);
      ctx.fillRect(TOWER_R - 3 - wob, y, 2, 2);
      if (hashRand(y, 51) < 0.35) {
        ctx.fillStyle = '#57a557';
        ctx.fillRect(TOWER_X + 3 + wob, y, 2, 1);
        ctx.fillRect(TOWER_R - 5 - wob, y, 2, 1);
      }
    }

    drawRoof(t);
    drawStreet(t);
  }

  function drawRoof(t) {
    const topY = ledgeY(FLOORS);
    // parapet
    ctx.fillStyle = '#8a8068';
    ctx.fillRect(TOWER_X - 2, topY - 4, TOWER_W + 4, 4);
    ctx.fillStyle = '#141419';
    ctx.fillRect(TOWER_X - 2, topY - 5, TOWER_W + 4, 1);
    // EVILCORP sign
    const signW = 76, signX = (W - signW) / 2, signY = 8;
    ctx.fillStyle = '#141419';
    ctx.fillRect(signX - 1, signY - 1, signW + 2, 12);
    ctx.fillStyle = '#2b2b33';
    ctx.fillRect(signX, signY, signW, 10);
    const flick = Math.sin(t / 300) > -0.7; // buzzing neon
    drawTinyText(ctx, 'EVILCORP', signX + 7, signY + 2, flick ? '#f0c840' : '#7a6420', 2);
    // sign posts
    ctx.fillStyle = '#141419';
    ctx.fillRect(signX + 6, signY + 10, 2, topY - 14 - signY);
    ctx.fillRect(signX + signW - 8, signY + 10, 2, topY - 14 - signY);
    // vines over sign corner
    ctx.fillStyle = '#2e7a3e';
    ctx.fillRect(signX - 1, signY - 1, 8, 2);
    ctx.fillRect(signX - 1, signY - 1, 2, 7);
    ctx.fillStyle = '#57a557';
    ctx.fillRect(signX + 2, signY + 1, 2, 1);
    // party flag on the right parapet
    const fx = TOWER_R - 4, fy = topY - 16;
    ctx.fillStyle = '#141419';
    ctx.fillRect(fx, fy, 1, 12);
    const wave = Math.sin(t / 250) * 1.5;
    ctx.fillStyle = '#57d557';
    ctx.fillRect(fx - 8, fy + Math.round(wave * 0.5), 8, 5);
    ctx.fillStyle = '#f8f8f0';
    ctx.fillRect(fx - 6, fy + 1 + Math.round(wave * 0.5), 2, 2);
    // balloons tied to the left parapet
    const bx = TOWER_X + 6;
    for (let i = 0; i < 3; i++) {
      const by = topY - 12 - i * 3 + Math.round(Math.sin(t / 600 + i * 2) * 1.5);
      ctx.fillStyle = '#141419';
      ctx.fillRect(bx + 3 + i * 5, by + 4, 1, 8 + i * 3);
      ctx.fillStyle = BUNT_COLS[i % BUNT_COLS.length];
      ctx.fillRect(bx + 2 + i * 5, by, 3, 4);
      ctx.fillRect(bx + 3 + i * 5, by - 1, 1, 1);
    }
    // roof bunting
    for (let x = TOWER_X + 2; x < TOWER_R - 4; x += 7) {
      ctx.fillStyle = BUNT_COLS[((x / 7) | 0 + 1) % BUNT_COLS.length];
      ctx.fillRect(x, topY - 3, 3, 2);
    }
  }

  function drawStreet(t) {
    // jungle floor
    ctx.fillStyle = '#2d5a2d';
    ctx.fillRect(0, STREET_TOP, W, H - STREET_TOP);
    ctx.fillStyle = '#3a6e35';
    ctx.fillRect(0, STREET_TOP, W, 2);
    // scattered ground confetti
    for (let i = 0; i < 26; i++) {
      const gx = Math.floor(hashRand(i, 301) * W);
      const gy = STREET_TOP + 4 + Math.floor(hashRand(i, 307) * (H - STREET_TOP - 6));
      ctx.fillStyle = BUNT_COLS[i % BUNT_COLS.length];
      ctx.fillRect(gx, gy, 1, 1);
    }
    // door with bunting
    const dx = TOWER_X + TOWER_W / 2 - 9, dy = STREET_TOP - 14;
    ctx.fillStyle = '#141419';
    ctx.fillRect(dx - 1, dy - 1, 20, 15);
    ctx.fillStyle = '#241d16';
    ctx.fillRect(dx, dy, 18, 14);
    ctx.fillStyle = '#f8c86a';
    ctx.fillRect(dx + 8, dy + 7, 2, 2); // handle glow
    for (let x = dx; x < dx + 18; x += 5) {
      ctx.fillStyle = BUNT_COLS[((x / 5) | 0) % BUNT_COLS.length];
      ctx.fillRect(x, dy - 1, 3, 2);
    }
    // tiki torches flanking the tower
    for (const tx of [TOWER_X - 10, TOWER_R + 8]) {
      ctx.fillStyle = '#5e3a1d';
      ctx.fillRect(tx, STREET_TOP - 12, 2, 12);
      const fl = Math.sin(t / 90 + tx) > 0;
      ctx.fillStyle = fl ? '#f8c86a' : '#f0945a';
      ctx.fillRect(tx - 1, STREET_TOP - 16, 4, 4);
      ctx.fillStyle = '#f8f0c0';
      ctx.fillRect(tx, STREET_TOP - 15, 2, 2);
    }
    // ferns
    for (let i = 0; i < 7; i++) {
      const fx2 = Math.floor(hashRand(i, 401) * W);
      if (fx2 > TOWER_X - 14 && fx2 < TOWER_R + 10) continue;
      ctx.fillStyle = '#3a8a3a';
      ctx.fillRect(fx2, STREET_TOP - 4, 1, 4);
      ctx.fillRect(fx2 - 2, STREET_TOP - 3, 2, 1);
      ctx.fillRect(fx2 + 1, STREET_TOP - 3, 2, 1);
      ctx.fillRect(fx2 - 1, STREET_TOP - 5, 3, 1);
    }
    // floor markers on the left wall
    for (const f of [5, 10, 15]) {
      drawTinyText(ctx, String(f), TOWER_X - 12, ledgeY(f) - 8, '#f8e8b8', 1);
    }
  }

  // ------------------------------------------------------------ critters
  function updateCritters(t, dt) {
    if (t > nextParrotAt) {
      nextParrotAt = t + 5000 + Math.random() * 7000;
      const dir = Math.random() < 0.5 ? 1 : -1;
      parrots.push({
        x: dir > 0 ? -10 : W + 10, y: 20 + Math.random() * 60, dir,
        speed: 18 + Math.random() * 14,
        cols: Math.random() < 0.5 ? ['#e83a3a', '#f0c840'] : ['#3a8ae8', '#57d557'],
      });
    }
    if (t > nextBalloonAt) {
      nextBalloonAt = t + 7000 + Math.random() * 9000;
      balloons.push({
        x: 10 + Math.random() * (W - 20), y: H + 6,
        col: BUNT_COLS[(Math.random() * BUNT_COLS.length) | 0],
        sway: Math.random() * 6.28,
      });
    }
    for (const p of parrots) p.x += p.dir * p.speed * dt;
    parrots = parrots.filter(p => p.x > -16 && p.x < W + 16);
    for (const b of balloons) { b.y -= 9 * dt; b.x += Math.sin(t / 800 + b.sway) * 0.15; }
    balloons = balloons.filter(b => b.y > -14);
  }

  function drawCritters(t) {
    for (const p of parrots) {
      const flap = Math.sin(t / 90 + p.x) > 0;
      const x = Math.round(p.x), y = Math.round(p.y);
      ctx.fillStyle = p.cols[0];
      ctx.fillRect(x, y, 5, 3);
      ctx.fillStyle = p.cols[1];
      ctx.fillRect(x + (p.dir > 0 ? 1 : 1), flap ? y - 2 : y + 2, 3, 2); // wing
      ctx.fillStyle = '#f0c840';
      ctx.fillRect(p.dir > 0 ? x + 5 : x - 1, y + 1, 1, 1); // beak
      ctx.fillStyle = '#141419';
      ctx.fillRect(p.dir > 0 ? x + 3 : x + 1, y, 1, 1); // eye
    }
    for (const b of balloons) {
      const x = Math.round(b.x), y = Math.round(b.y);
      ctx.fillStyle = '#141419';
      ctx.fillRect(x + 1, y + 4, 1, 6);
      ctx.fillStyle = b.col;
      ctx.fillRect(x, y, 3, 4);
      ctx.fillRect(x + 1, y - 1, 1, 1);
    }
  }

  // ------------------------------------------------------------ frogs
  function frogX(rs) { return TOWER_X + 4 + rs.lane * LANE_W + 1; }

  function drawFrog(rs, t) {
    const set = sprites[rs.color % sprites.length];
    let sprite = set.idle;
    let x = frogX(rs);
    let y, rot = 0, sx = 1, sy = 1;

    switch (rs.mode) {
      case 'idle': {
        rs.floorF = rs.targetFloor ?? rs.floorF;
        y = ledgeY(rs.floorF) - 12;
        if (t > rs.blinkAt) {
          sprite = set.blink;
          if (t > rs.blinkAt + 140) rs.blinkAt = t + 1800 + Math.random() * 3200;
        }
        break;
      }
      case 'hop': {
        const HOP_MS = 480;
        const el = t - rs.t0;
        if (el < 0) { y = ledgeY(rs.from) - 12; break; }
        const hop = Math.min(rs.hops - 1, Math.floor(el / HOP_MS));
        const p = Math.min(1, (el - hop * HOP_MS) / HOP_MS);
        const a = rs.from + hop, b = Math.min(rs.to, a + 1);
        const yA = ledgeY(a), yB = ledgeY(b);
        y = yA + (yB - yA) * p - Math.sin(p * Math.PI) * 7 - 12;
        sprite = set.jump;
        sy = p < 0.5 ? 1.1 : 1;
        if (rs.fastest && Math.random() < 0.5) {
          particles.push({ x: x + 7, y: y + 12, vx: (Math.random() - 0.5) * 6, vy: 6, g: 0, life: 350, t0: t, color: '#f0c840', size: 1 });
        }
        if (el >= rs.hops * HOP_MS) {
          rs.mode = 'idle'; rs.floorF = rs.to; rs.targetFloor = rs.to;
          y = ledgeY(rs.to) - 12;
          dust(x + 7, ledgeY(rs.to), 5);
          sprite = set.idle;
        }
        break;
      }
      case 'fall': {
        const el = t - rs.t0;
        if (el < 0) { // still getting booted — sit tight, look worried
          y = ledgeY(rs.from) - 12;
          drawTinyText(ctx, '!', x + 15, y - 6, '#f04a3a', 1);
          break;
        }
        const FALL_MS = 700;
        const p = Math.min(1, el / FALL_MS);
        const yA = ledgeY(rs.from), yB = ledgeY(rs.to);
        y = yA + (yB - yA) * (p * p) - 12; // accelerate down
        rot = p * Math.PI * 2;
        if (p >= 1) {
          if (el < FALL_MS + 220) { sx = 1.35; sy = 0.65; y = ledgeY(rs.to) - 12 + 4; } // splat
          else {
            rs.mode = 'idle'; rs.floorF = rs.to; rs.targetFloor = rs.to;
            dust(x + 7, ledgeY(rs.to), 7, '#c8b890');
          }
          rot = 0;
        }
        break;
      }
      case 'bonk': { // kicked at street level: squash in place
        const el = t - rs.t0;
        y = ledgeY(rs.from) - 12;
        if (el < 0) { drawTinyText(ctx, '!', x + 15, y - 6, '#f04a3a', 1); break; }
        if (el < 260) { sx = 1.35; sy = 0.65; y += 4; }
        else rs.mode = 'idle';
        break;
      }
      case 'dance': {
        const bounce = Math.abs(Math.sin((t - rs.t0) / 180)) * 6;
        y = ledgeY(FLOORS) - 12 - 5 - bounce;
        sprite = bounce > 3 ? set.jump : set.idle;
        break;
      }
      default: y = ledgeY(rs.floorF) - 12;
    }

    // shadow
    ctx.fillStyle = 'rgba(20,20,25,0.35)';
    ctx.fillRect(x + 2, ledgeY(Math.round(rs.mode === 'hop' || rs.mode === 'fall' ? rs.to : rs.floorF)) - 1, 10, 1);

    if (rot || sx !== 1 || sy !== 1) {
      ctx.save();
      ctx.translate(x + 7, y + 6);
      ctx.rotate(rot);
      ctx.scale(sx, sy);
      ctx.drawImage(sprite, -7, -6);
      ctx.restore();
    } else {
      ctx.drawImage(sprite, x, Math.round(y));
    }

    // crown for winners
    if (winners.includes(rs.id)) {
      ctx.drawImage(crown, x + 4, Math.round(y) - 5);
    }

    // name tag
    const tag = rs.name.slice(0, 4).toUpperCase();
    const tw = tinyTextWidth(tag, 1);
    const tx = Math.round(x + 7 - tw / 2);
    const ty = Math.round(y) - 8;
    drawTinyText(ctx, tag, tx + 1, ty + 1, '#141419', 1);
    drawTinyText(ctx, tag, tx, ty, FROG_COLORS[rs.color % FROG_COLORS.length].belly, 1);
    if (!rs.connected) drawTinyText(ctx, 'ZZZ', tx, ty - 6, '#8a8a9a', 1);

    // answered marker
    if (answeredIds.has(rs.id)) {
      ctx.fillStyle = '#f8f8f0';
      ctx.fillRect(x + 14, Math.round(y) + 1, 3, 3);
      ctx.fillStyle = '#141419';
      ctx.fillRect(x + 15, Math.round(y) + 2, 1, 1);
    }
  }

  function drawBiz(t) {
    bizList = bizList.filter(b => t - b.t0 < 1900);
    for (const b of bizList) {
      const el = t - b.t0;
      const wx = TOWER_X + 4 + b.lane * LANE_W - 1;
      const wy = ledgeY(b.floor) - 12;
      if (el < 350) {
        // slide out of the window
        const p = el / 350;
        ctx.drawImage(bizLean, wx - 1, wy - 10 + Math.round((1 - p) * 8));
      } else if (el < 900) {
        ctx.drawImage(bizLean, wx - 1, wy - 10);
      } else if (el < 1400) {
        // THE BOOT
        ctx.drawImage(bizKick, wx - 5, wy - 10);
        if (el < 1150) {
          ctx.fillStyle = '#f8f8f0';
          ctx.fillRect(wx - 8, wy + 1, 3, 1);
          ctx.fillRect(wx - 7, wy + 4, 3, 1);
        }
      } else {
        const p = (el - 1400) / 500;
        ctx.drawImage(bizLean, wx - 1, wy - 10 + Math.round(p * 10));
      }
    }
  }

  function drawParticles(t, dt) {
    particles = particles.filter(p => t - p.t0 < p.life);
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    // ambient roof confetti during the winner screen
    if (t < confettiUntil && Math.random() < 0.25) {
      const cols = ['#e85e4e', '#f0c840', '#4e9ee8', '#57d557', '#e894e8'];
      particles.push({
        x: TOWER_X + Math.random() * TOWER_W, y: 6,
        vx: (Math.random() - 0.5) * 10, vy: 8 + Math.random() * 10,
        g: 2, life: 3200, t0: t, color: cols[(Math.random() * cols.length) | 0], size: 1,
      });
    }
  }

  // ------------------------------------------------------------ main loop
  let lastT = 0;
  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;

    fitCanvas();
    ctx.imageSmoothingEnabled = false;
    drawSky(t);
    drawClouds(t);
    updateCritters(t, dt);
    drawJungle(t);
    drawCritters(t);
    drawTower(t);
    drawBiz(t);
    const list = [...frogs.values()].sort((a, b) => a.lane - b.lane);
    for (const rs of list) drawFrog(rs, t);
    drawParticles(t, dt);

    requestAnimationFrame(frame);
  }

  let cssW = 0, cssH = 0;
  function fitCanvas() {
    const box = cv.parentElement.getBoundingClientRect();
    if (box.width === cssW && box.height === cssH) return;
    cssW = box.width; cssH = box.height;
    const scale = Math.max(1, Math.floor(Math.min(cssW / W, cssH / H)));
    cv.width = W; cv.height = H;
    cv.style.width = (W * scale) + 'px';
    cv.style.height = (H * scale) + 'px';
  }

  return {
    init,
    setSelf: id => { selfId = id; },
    updateRoster,
    matchStart,
    startReveal,
    setWinners,
    markAnswered: id => answeredIds.add(id),
    clearAnswered: () => answeredIds.clear(),
  };
})();
