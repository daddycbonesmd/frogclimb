// FROG TOWER — true first-person renderer (raycast).
// Mouse-look + WASD. The four answers are four doors on the far wall:
// walk into the door you believe in. Correct door opens onto the stairs;
// wrong choice summons the businessman's boot.
'use strict';

const Renderer = (() => {
  const W = 240, H = 180, HALF = H / 2;
  const FLOORS = 15;
  const FOV_PLANE = 0.66;
  const MOVE_SPEED = 3.1, TURN_KEY_SPEED = 2.6, MOUSE_SENS = 0.0032;
  const PLAYER_R = 0.22;

  // ---- the office floor -------------------------------------------------
  // # wall  W window  C cubicle  E elevator  1-4 answer doors  . floor
  const MAP = [
    '##1##2##3##4#',
    '#...........#',
    'W...........W',
    '#...........#',
    'W...........W',
    '#...........#',
    'W...........W',
    '#...........#',
    '#...........#',
    '#####EE######',
  ];
  const MW = MAP[0].length, MH = MAP.length;
  const DOOR_X = { 0: 2, 1: 5, 2: 8, 3: 11 };  // map column of each option door
  const DOOR_COLORS = ['#57d557', '#f0c840', '#4e9ee8', '#e85e4e'];
  const SPAWN = { x: 6.5, y: 7.6, dir: -Math.PI / 2 }; // facing the doors

  const cellAt = (x, y) => (x < 0 || y < 0 || x >= MW || y >= MH) ? '#' : MAP[y | 0][x | 0];
  const doorIdxAt = x => Object.keys(DOOR_X).find(k => DOOR_X[k] === (x | 0));

  let cv, ctx, sprites, backSprites, handL, bizFront, bizLean, crown;
  let selfId = null, roster = [], spectating = false;
  let myFloor = 0, phase = 'idle', winners = [];

  const cam = { x: SPAWN.x, y: SPAWN.y, dir: SPAWN.dir };
  let pitch = 0; // look up/down: shifts the horizon (y-shear)
  let bobT = 0, moving = false, locked = false;

  let chosen = null;          // option idx I walked into
  let openDoor = null;        // door idx currently open (correct answer at reveal)
  let slamDoor = null;        // my wrong door
  let pending = null, kick = null, transition = null;
  let express = false, redVignette = 0, shake = 0;
  let ghosts = new Map(), particles = [];
  let questionActive = false;

  const input = { fwd: false, back: false, left: false, right: false, turnL: false, turnR: false };
  let onChoose = null;

  const now = () => performance.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sfx = n => { try { window.SFX && window.SFX[n] && window.SFX[n](); } catch {} };
  const hashRand = (a, b) => {
    let h = (a * 374761393 + b * 668265263) >>> 0;
    h = (h ^ (h >> 13)) * 1274126177 >>> 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  };

  // ---- textures ---------------------------------------------------------
  const TEX = 16;
  function tex(draw) {
    const c = document.createElement('canvas');
    c.width = TEX; c.height = TEX;
    const g = c.getContext('2d');
    draw(g);
    return c;
  }
  let wallTex, winTex, cubeTex, elevTex, doorTexes;

  function buildTextures() {
    wallTex = tex(g => {
      g.fillStyle = '#2f2f37'; g.fillRect(0, 0, TEX, TEX);
      g.fillStyle = '#1a1a20'; g.fillRect(0, 0, TEX, 1);
      g.fillStyle = '#33333b'; g.fillRect(0, 6, TEX, 1);
      g.fillStyle = '#26262c'; g.fillRect(0, 0, 1, TEX);
      g.fillStyle = '#17171c'; g.fillRect(0, 14, TEX, 2);
    });
    winTex = tex(g => {
      g.fillStyle = '#2f2f37'; g.fillRect(0, 0, TEX, TEX);
      g.fillStyle = '#17171c'; g.fillRect(1, 2, 14, 11);
      const bands = ['#33205e', '#5e2a66', '#a03a5e', '#d8584a', '#f08a52', '#f8c06a'];
      bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(2, 3 + Math.floor(i * 9 / 6), 12, 2); });
      g.fillStyle = '#e85e4e'; g.fillRect(5, 6, 1, 1);   // bunting outside
      g.fillStyle = '#f0c840'; g.fillRect(8, 7, 1, 1);
      g.fillStyle = '#3a7a3a'; g.fillRect(2, 3, 1, 6);   // vine creeping in
      g.fillStyle = '#57a557'; g.fillRect(3, 6, 1, 2);
      g.fillStyle = '#17171c'; g.fillRect(0, 14, TEX, 2);
    });
    cubeTex = tex(g => {
      g.fillStyle = '#202027'; g.fillRect(0, 0, TEX, TEX);
      g.fillStyle = '#17171c'; g.fillRect(0, 0, TEX, 2);
      g.fillStyle = '#3fd0c8'; g.fillRect(5, 6, 6, 4);   // dead-eyed monitor
      g.fillStyle = '#2a8a85'; g.fillRect(5, 9, 6, 1);
      g.fillStyle = '#26262c'; g.fillRect(2, 12, 12, 2);
    });
    elevTex = tex(g => {
      g.fillStyle = '#26262c'; g.fillRect(0, 0, TEX, TEX);
      g.fillStyle = '#1a1a20'; g.fillRect(7, 1, 2, 14);
      g.fillStyle = '#f8c06a'; g.fillRect(3, 1, 10, 1);
      g.fillStyle = '#17171c'; g.fillRect(0, 15, TEX, 1);
    });
    doorTexes = DOOR_COLORS.map((col, i) => {
      const base = state => tex(g => {
        g.fillStyle = '#17171c'; g.fillRect(0, 0, TEX, TEX);           // frame
        g.fillStyle = state === 'slam' ? '#3a1216' : '#101014';
        g.fillRect(2, 2, 12, 14);                                       // slab
        g.fillStyle = col; g.fillRect(2, 2, 12, 2);                     // colored header
        if (state === 'idle' || state === 'locked' || state === 'lockedB') {
          drawTinyText(g, String(i + 1), 6, 6, col, 1);
          g.fillStyle = col; g.fillRect(11, 9, 2, 2);                   // handle light
        }
        if (state === 'locked' || state === 'lockedB') {
          g.fillStyle = state === 'locked' ? '#f0c840' : '#8a701e';
          g.fillRect(2, 2, 1, 14); g.fillRect(13, 2, 1, 14); g.fillRect(2, 15, 12, 1);
        }
        if (state === 'open' || state === 'openB') {
          const glow = state === 'open' ? '#57d545' : '#2e7a28';
          g.fillStyle = glow; g.fillRect(3, 4, 10, 12);                 // light beyond
          g.fillStyle = '#1e3a22';
          for (let s = 0; s < 4; s++) g.fillRect(4, 13 - s * 3, 8, 1);  // stairs up
          g.fillStyle = '#f8f0d8'; drawTinyText(g, 'UP', 5, 5, '#0d0d10', 1);
        }
        if (state === 'slam') {
          g.fillStyle = '#e02828';
          for (let s = 0; s < 10; s++) { g.fillRect(4 + s, 4 + s, 1, 1); g.fillRect(13 - s, 4 + s, 1, 1); }
        }
      });
      return {
        idle: base('idle'), locked: base('locked'), lockedB: base('lockedB'),
        open: base('open'), openB: base('openB'), slam: base('slam'),
      };
    });
  }

  function doorTexFor(idx, t) {
    const d = doorTexes[idx];
    if (idx === slamDoor) return d.slam;
    if (idx === openDoor) return Math.sin(t / 130) > 0 ? d.open : d.openB;
    if (idx === chosen) return Math.sin(t / 170) > 0 ? d.locked : d.lockedB;
    return d.idle;
  }

  // ---- init -------------------------------------------------------------
  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    sprites = buildFrogSprites();
    backSprites = FROG_COLORS.map(col => makeSprite(FROG_BACK, { 1: col.body, 2: col.belly, 3: col.dark }));
    handL = makeSprite(FROG_HAND, { 1: FROG_COLORS[0].body, 2: FROG_COLORS[0].belly });
    bizFront = makeSprite(BIZ_FRONT);
    bizLean = makeSprite(BIZ_LEAN);
    crown = makeSprite(CROWN);
    buildTextures();

    cv.addEventListener('click', () => {
      if (!locked && !spectatorBlocked()) cv.requestPointerLock({ unadjustedMovement: true }).catch?.(() => cv.requestPointerLock());
    });
    document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === cv; });
    document.addEventListener('mousemove', e => {
      if (!locked) return;
      cam.dir += e.movementX * MOUSE_SENS;
      pitch = clamp(pitch - e.movementY * 0.4, -55, 55);
    });

    requestAnimationFrame(frame);
  }
  const spectatorBlocked = () => phase === 'roof';

  function setSelf(id) { selfId = id; refreshHands(); }
  function refreshHands() {
    const p = roster.find(p => p.id === selfId);
    const col = FROG_COLORS[(p ? p.color : 0) % FROG_COLORS.length];
    handL = makeSprite(FROG_HAND, { 1: col.body, 2: col.belly });
  }

  // ---- state from client ------------------------------------------------
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

  // everyone shares the same room, whatever their floor — the race is visible
  function syncGhosts() {
    const seen = new Set();
    let s = 0;
    for (const p of roster) {
      if (p.id === selfId || p.spectator || !p.connected) continue;
      seen.add(p.id);
      const g = ghosts.get(p.id);
      if (g) {
        g.name = p.name; g.floor = p.floor; g.color = p.color;
      } else {
        ghosts.set(p.id, {
          color: p.color, name: p.name, floor: p.floor,
          x: 3.5 + (s % 4) * 2.0, y: 5.6 + (s % 2) * 1.2,
          tx: 3.5 + (s % 4) * 2.0, ty: 5.6 + (s % 2) * 1.2,
          state: 'idle', t0: now(), door: null,
        });
      }
      s++;
    }
    for (const id of [...ghosts.keys()]) if (!seen.has(id)) ghosts.delete(id);
  }

  function resetRoom() {
    chosen = null; openDoor = null; slamDoor = null;
    express = false; kick = null; transition = null;
    cam.x = SPAWN.x; cam.y = SPAWN.y; cam.dir = SPAWN.dir;
    ghosts.clear(); syncGhosts();
  }

  function matchStart() {
    winners = []; phase = 'idle'; myFloor = 0; pending = null; redVignette = 0;
    pitch = 0;
    resetRoom();
  }

  function newQuestion() {
    if (pending) { myFloor = pending.to; pending = null; sfx('ding'); }
    phase = 'question'; questionActive = true;
    resetRoom();
  }

  function startReveal(data) {
    phase = 'reveal'; questionActive = false;
    const t0 = now();
    openDoor = data.correctIdx;
    const mine = data.results.find(r => r.id === selfId);
    if (mine) {
      if (mine.correct) {
        express = mine.fastest;
        pending = { to: mine.to };
        sfx('ding');
      } else if (mine.kicked) {
        if (chosen != null && chosen !== data.correctIdx) slamDoor = chosen;
        kick = { t0: t0 + 700, to: mine.to };
      }
    }
    for (const r of data.results) {
      const g = ghosts.get(r.id);
      if (!g) continue;
      if (r.correct) { g.state = 'exit'; g.door = data.correctIdx; g.t0 = t0 + 400 + Math.random() * 500; }
      else if (r.kicked) { g.state = 'falling'; g.t0 = t0 + 600 + Math.random() * 400; }
    }
  }

  function setWinners(ids) { winners = ids; phase = 'roof'; burstConfetti(); }

  function markAnswered(id) {
    const g = ghosts.get(id);
    if (g && g.state === 'idle') {
      g.state = 'toDoor';
      g.door = (Math.random() * 4) | 0;
      g.tx = DOOR_X[g.door] + 0.5; g.ty = 1.6;
      g.t0 = now();
    }
  }
  function clearAnswered() {}
  function setChosen(idx) { if (chosen == null) { chosen = idx; sfx('click'); } }

  // ---- movement & doors -------------------------------------------------
  function tryMove(nx, ny) {
    const solid = (x, y) => cellAt(x, y) !== '.';
    if (!solid(nx + PLAYER_R, cam.y) && !solid(nx - PLAYER_R, cam.y)) cam.x = nx;
    if (!solid(cam.x, ny + PLAYER_R) && !solid(cam.x, ny - PLAYER_R)) cam.y = ny;
  }

  function update(dt) {
    if (kick || transition || phase === 'roof') return;
    if (input.turnL) cam.dir -= TURN_KEY_SPEED * dt;
    if (input.turnR) cam.dir += TURN_KEY_SPEED * dt;
    let mx = 0, my = 0;
    const cd = Math.cos(cam.dir), sd = Math.sin(cam.dir);
    if (input.fwd) { mx += cd; my += sd; }
    if (input.back) { mx -= cd; my -= sd; }
    if (input.left) { mx += sd; my -= cd; }
    if (input.right) { mx -= sd; my += cd; }
    moving = (mx !== 0 || my !== 0);
    if (moving) {
      const len = Math.hypot(mx, my) || 1;
      const prevBob = Math.sin(bobT * 9);
      bobT += dt;
      if (Math.sin(bobT * 9) > 0 && prevBob <= 0) sfx('hop');
      tryMove(cam.x + (mx / len) * MOVE_SPEED * dt, cam.y + (my / len) * MOVE_SPEED * dt);
    }

    // door approach
    if (cam.y < 1.6) {
      for (let d = 0; d < 4; d++) {
        if (Math.abs(cam.x - (DOOR_X[d] + 0.5)) > 0.55) continue;
        if (questionActive && chosen == null && !spectating) {
          setChosen(d);
          if (onChoose) onChoose(d);
          cam.y = 1.95; // bounce back — committed
        } else if (openDoor === d && pending && !spectating && cam.y < 1.35) {
          transition = { t0: now(), to: pending.to, floors: pending.to - myFloor, express };
          sfx('stairs');
        } else if (cam.y < 1.3) {
          cam.y = 1.3; // locked door, nose against it
        }
      }
    }
  }

  // ---- raycaster --------------------------------------------------------
  function castWalls(t, bobY) {
    const zbuf = new Float32Array(W);
    const dirX = Math.cos(cam.dir), dirY = Math.sin(cam.dir);
    const plX = -dirY * FOV_PLANE, plY = dirX * FOV_PLANE;
    for (let x = 0; x < W; x++) {
      const cx = 2 * x / W - 1;
      const rdx = dirX + plX * cx, rdy = dirY + plY * cx;
      let mapX = cam.x | 0, mapY = cam.y | 0;
      const ddx = Math.abs(1 / (rdx || 1e-9)), ddy = Math.abs(1 / (rdy || 1e-9));
      let stepX, stepY, sdx, sdy;
      if (rdx < 0) { stepX = -1; sdx = (cam.x - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - cam.x) * ddx; }
      if (rdy < 0) { stepY = -1; sdy = (cam.y - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - cam.y) * ddy; }
      let side = 0, cell = '#', guard = 0;
      while (guard++ < 64) {
        if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; } else { sdy += ddy; mapY += stepY; side = 1; }
        cell = cellAt(mapX, mapY);
        if (cell !== '.') break;
      }
      const dist = Math.max(0.05, side === 0 ? sdx - ddx : sdy - ddy);
      zbuf[x] = dist;
      let wallX = side === 0 ? cam.y + dist * rdy : cam.x + dist * rdx;
      wallX -= wallX | 0;
      const lineH = Math.min(H * 3, (H / dist) | 0);
      const y0 = (HALF + pitch - lineH / 2 + bobY) | 0;

      let texture = wallTex;
      if (cell === 'W') texture = winTex;
      else if (cell === 'C') texture = cubeTex;
      else if (cell === 'E') texture = elevTex;
      else if (cell >= '1' && cell <= '4') texture = doorTexFor(+cell - 1, t);
      const u = (wallX * TEX) | 0;
      ctx.drawImage(texture, u, 0, 1, TEX, x, y0, 1, lineH);
      // side + distance shading
      const shade = clamp((side ? 0.12 : 0) + dist / 10, 0, 0.72);
      if (shade > 0.03) {
        ctx.fillStyle = `rgba(10,10,14,${shade})`;
        ctx.fillRect(x, y0, 1, lineH);
      }
    }
    return zbuf;
  }

  function drawBillboard(img, wx, wy, zbuf, bobY, hScale, alpha, yLift) {
    const dirX = Math.cos(cam.dir), dirY = Math.sin(cam.dir);
    const plX = -dirY * FOV_PLANE, plY = dirX * FOV_PLANE;
    const rx = wx - cam.x, ry = wy - cam.y;
    const invDet = 1 / (plX * dirY - dirX * plY);
    const tx = invDet * (dirY * rx - dirX * ry);
    const ty = invDet * (-plY * rx + plX * ry);
    if (ty <= 0.15) return null;
    const sx = ((W / 2) * (1 + tx / ty)) | 0;
    const hgt = Math.abs((H / ty) | 0) * hScale;
    const wdt = hgt * (img.width / img.height);
    const y0 = (HALF + pitch + (H / ty) * 0.5 - hgt + bobY - (yLift || 0) * (H / ty)) | 0;
    const xs = (sx - wdt / 2) | 0;
    ctx.globalAlpha = alpha;
    let visible = false;
    for (let s = 0; s < wdt; s++) {
      const col = xs + s;
      if (col < 0 || col >= W || zbuf[col] <= ty) continue;
      ctx.drawImage(img, (s / wdt * img.width) | 0, 0, 1, img.height, col, y0, 1, hgt);
      visible = true;
    }
    ctx.globalAlpha = 1;
    return visible ? { sx, y0, hgt, ty } : null;
  }

  function drawGhosts(t, zbuf, bobY) {
    for (const [id, g] of ghosts) {
      let alpha = 0.8, hs = 0.34, lift = 0;
      if (g.state === 'toDoor') {
        const sp = 1.8 * (1 / 60);
        g.x += clamp(g.tx - g.x, -sp, sp); g.y += clamp(g.ty - g.y, -sp, sp);
        lift = Math.abs(Math.sin(t / 110)) * 0.08;
      } else if (g.state === 'exit') {
        const p = clamp((t - g.t0) / 800, 0, 1);
        g.x += clamp((DOOR_X[g.door] + 0.5) - g.x, -0.06, 0.06);
        g.y += clamp(1.0 - g.y, -0.05, 0.05);
        alpha = 0.8 * (1 - p);
        if (p >= 1) { ghosts.delete(id); continue; }
      } else if (g.state === 'falling') {
        const p = clamp((t - g.t0) / 900, 0, 1);
        alpha = 0.8 * (1 - p); hs = 0.34 * (1 - p * 0.4);
        if (p >= 1) { ghosts.delete(id); continue; }
      } else {
        g.x += Math.sin(t / 900 + g.color * 2) * 0.002;
        lift = Math.abs(Math.sin(t / 400 + g.color)) * 0.02;
      }
      const hit = drawBillboard(backSprites[g.color % backSprites.length], g.x, g.y, zbuf, bobY, hs, alpha, lift);
      // score floating above their head
      if (hit && hit.ty < 9 && g.state !== 'falling') {
        const tag = `${g.name.slice(0, 6).toUpperCase()} F${g.floor}`;
        const tw = tinyTextWidth(tag, 1);
        const lx = clamp(hit.sx - tw / 2, 1, W - tw - 1) | 0;
        const ly = clamp(hit.y0 - 9, 2, H - 8) | 0;
        ctx.globalAlpha = Math.min(1, alpha + 0.15);
        ctx.fillStyle = 'rgba(13,13,16,.75)';
        ctx.fillRect(lx - 2, ly - 1, tw + 4, 8);
        drawTinyText(ctx, tag, lx, ly, FROG_COLORS[g.color % FROG_COLORS.length].body, 1);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---- overlays (screen-space) -----------------------------------------
  const SUNSET = ['#33205e', '#5e2a66', '#a03a5e', '#d8584a', '#f08a52', '#f8c06a'];

  function drawHands(t, bobY) {
    if (phase === 'roof') return;
    const b = moving ? Math.abs(Math.sin(bobT * 9)) * 5 : Math.sin(t / 1100) * 1.5;
    const y = H - 15 + b;
    const sway = moving ? Math.sin(bobT * 4.5) * 3 : Math.sin(t / 900) * 2;
    ctx.drawImage(handL, 32 + sway, y, 30, 24);
    ctx.save(); ctx.scale(-1, 1);
    ctx.drawImage(handL, -(W - 32 + sway) - 30, y + 1, 30, 24);
    ctx.restore();
  }

  function drawKick(t) {
    if (!kick) return;
    const el = t - kick.t0;
    if (el < 0) return;
    if (el < 500) {
      const p = el / 500;
      ctx.fillStyle = '#17171c'; ctx.fillRect(W - 64, 26, 64, H - 52);
      ctx.fillStyle = '#3a3a42';
      ctx.fillRect(W - 64, 26, 32 * (1 - p), H - 52);
      ctx.fillRect(W - 32 * (1 - p), 26, 32 * (1 - p), H - 52);
      ctx.fillStyle = '#f8c06a'; ctx.fillRect(W - 62, 28, 60, 3);
      if (el < 60) sfx('ding');
    } else if (el < 1100) {
      const p = (el - 500) / 600;
      const s = 40 + p * 155;
      ctx.drawImage(bizFront, W / 2 - s / 2 + (1 - p) * 60, H - 26 - s * 1.35, s, s * 1.35);
      if (p > 0.4) shake = 1.5;
    } else if (el < 1400) {
      const p = (el - 1100) / 300;
      const s = 60 + p * 260;
      ctx.fillStyle = '#0d0d10';
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2 + 10, s, s * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#26262c';
      for (let i = 0; i < 5; i++) ctx.fillRect(W / 2 - s * 0.7 + i * s * 0.32, H / 2 - 4, s * 0.14, 8 + s * 0.05);
      shake = 5;
      if (el - 1100 < 40) sfx('kick');
    } else if (el < 2400) {
      const p = (el - 1400) / 1000;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(p * Math.PI * 4);
      ctx.fillStyle = SUNSET[clamp((p * SUNSET.length) | 0, 0, SUNSET.length - 1)];
      ctx.fillRect(-W, -H, W * 2, H * 2);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#f8c86a' : '#1d4a50';
        const wy = ((i * 53 + p * 700) % (H * 2)) - H;
        ctx.fillRect(-40 + (i % 3) * 40, wy, 14, 10);
      }
      ctx.restore();
      shake = 2;
    } else if (el < 2900) {
      if (el - 2400 < 40) { sfx('land'); dustBurst(); myFloor = kick.to; }
      redVignette = 0.5 * (1 - (el - 2400) / 500);
      shake = (el - 2400) < 150 ? 4 : 0;
    } else {
      kick = null; shake = 0;
      chosen = null; slamDoor = null; openDoor = null;
      cam.x = SPAWN.x; cam.y = SPAWN.y; cam.dir = SPAWN.dir;
    }
  }

  function drawTransition(t) {
    if (!transition) return;
    const per = transition.express ? 480 : 650;
    const total = per * transition.floors + (transition.express ? 350 : 0);
    const el = t - transition.t0;
    const flr = Math.min(transition.floors - 1, (el / per) | 0);
    const p = clamp((el - flr * per) / per, 0, 1);
    ctx.fillStyle = '#111116'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1e1e24';
    for (let i = 0; i < 8; i++) {
      const sy = H - ((p + i / 8) % 1) * (H + 30);
      ctx.fillRect(30 + (i % 2) * 20, sy, W - 100, 12);
    }
    const label = 'FLOOR ' + Math.min(FLOORS, myFloor + flr + 2);
    const lw = tinyTextWidth(label, 2);
    drawTinyText(ctx, label, W / 2 - lw / 2 + 1, H / 2 - 4 + 1, '#0d0d10', 2);
    drawTinyText(ctx, label, W / 2 - lw / 2, H / 2 - 5, '#f8f0d8', 2);
    if (transition.express && Math.sin(t / 90) > 0) {
      const ew = tinyTextWidth('EXPRESS', 1);
      drawTinyText(ctx, 'EXPRESS', W / 2 - ew / 2, H / 2 + 12, '#f0c840', 1);
    }
    const bobStep = Math.abs(Math.sin(el / 110)) * 3;
    ctx.drawImage(handL, 30, H - 20 - bobStep, 26, 20);
    ctx.save(); ctx.scale(-1, 1);
    ctx.drawImage(handL, -(W - 30) - 26, H - 19 - bobStep, 26, 20);
    ctx.restore();
    if (el >= total) {
      myFloor = transition.to;
      pending = null; transition = null;
      resetRoom();
      if (phase === 'reveal') phase = 'idle';
    }
  }

  function drawRoof(t) {
    const bandH = Math.ceil(H / SUNSET.length);
    SUNSET.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * bandH, W, bandH); });
    for (let i = 0; i < 24; i++) {
      const sx = (hashRand(i, 3) * W) | 0, sy = (hashRand(i, 9) * 60) | 0;
      if (Math.sin(t / 600 + i) > 0.3) { ctx.fillStyle = '#fff8e8'; ctx.fillRect(sx, sy, 1, 1); }
    }
    ctx.fillStyle = '#0d0d10'; ctx.fillRect(W / 2 - 52, 26, 104, 22);
    ctx.fillStyle = '#17171c'; ctx.fillRect(W / 2 - 52, 48, 104, 3);
    const buzz = Math.sin(t / 250) > -0.8;
    drawTinyText(ctx, 'EVILCORP', W / 2 - tinyTextWidth('EVILCORP', 2) / 2, 31, buzz ? '#d02a2a' : '#5a1414', 2);
    ctx.fillStyle = '#26262c'; ctx.fillRect(W / 2 + 55, 22, 4, 26);
    if (Math.sin(t / 400) > 0) { ctx.fillStyle = '#e02828'; ctx.fillRect(W / 2 + 56, 20, 2, 2); }
    ctx.fillStyle = '#3a3a42'; ctx.fillRect(0, H - 42, W, 42);
    ctx.fillStyle = '#2b2b31'; ctx.fillRect(0, H - 42, W, 3);
    for (let x = 8; x < W - 8; x += 12) {
      const sag = Math.sin((x / W) * Math.PI) * 6;
      ctx.fillStyle = ['#e85e4e', '#f0c840', '#4e9ee8', '#e894e8'][(x / 12 | 0) % 4];
      ctx.fillRect(x, 66 + sag, 4, 4);
      ctx.fillStyle = '#141419'; ctx.fillRect(x, 65 + sag, 4, 1);
    }
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
    const stomp = Math.abs(Math.sin(t / 140)) * 4;
    ctx.drawImage(bizLean, 12, H - 44 - 26 - stomp, 32, 26);
    drawTinyText(ctx, 'NO!!', 18, H - 44 - 40 - stomp, '#d02a2a', 1);
    if (Math.random() < 0.35) {
      particles.push({
        x: Math.random() * W, y: -4, vx: (Math.random() - 0.5) * 12, vy: 16 + Math.random() * 14,
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
      ctx.fillRect(p.x | 0, p.y | 0, 2, 2);
    }
  }

  function drawHud(t) {
    if (phase === 'roof') return;
    const label = 'FLOOR ' + Math.min(FLOORS, myFloor + 1);
    drawTinyText(ctx, label, 5, 5, '#0d0d10', 1);
    drawTinyText(ctx, label, 4, 4, '#f8f0d8', 1);
    if (spectating) drawTinyText(ctx, 'SPECTATING', 4, 12, '#8a8a96', 1);
    let msg = null, col = '#57d557';
    if (transition || kick) msg = null;
    else if (questionActive && chosen == null && !spectating) { msg = 'WALK INTO A DOOR!'; col = '#f0c840'; }
    else if (questionActive && chosen != null) { msg = 'LOCKED IN — DOOR ' + (chosen + 1); col = DOOR_COLORS[chosen]; }
    else if (openDoor != null && pending) { msg = express ? 'EXPRESS! GET IN!' : 'DOOR OPEN — GET IN!'; col = '#57d557'; }
    if (msg && Math.sin(t / 170) > -0.4) {
      const mw = tinyTextWidth(msg, 1);
      drawTinyText(ctx, msg, W / 2 - mw / 2 + 1, 15, '#0d0d10', 1);
      drawTinyText(ctx, msg, W / 2 - mw / 2, 14, col, 1);
    }
    if (!locked && !spectating && phase !== 'idle' && !kick && !transition) {
      const hint = 'CLICK TO LOOK · WASD TO HOP';
      const hw = tinyTextWidth(hint, 1);
      ctx.fillStyle = 'rgba(13,13,16,.7)';
      ctx.fillRect(W / 2 - hw / 2 - 3, H - 34, hw + 6, 9);
      drawTinyText(ctx, hint, W / 2 - hw / 2, H - 32, '#f8f0d8', 1);
    }
    if (redVignette > 0) {
      ctx.fillStyle = `rgba(208,42,42,${redVignette})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---- main loop --------------------------------------------------------
  let lastT = 0;
  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    fitCanvas();
    update(dt);

    ctx.fillStyle = '#111116';
    ctx.fillRect(0, 0, W, H);

    if (phase === 'roof') {
      drawRoof(t);
    } else if (transition) {
      drawTransition(t);
    } else if (kick && t - kick.t0 > 1400 && t - kick.t0 < 2400) {
      drawKick(t);
    } else {
      const sh = shake ? (Math.random() - 0.5) * shake : 0;
      const bobY = (moving ? Math.abs(Math.sin(bobT * 9)) * -3 : 0) + sh;
      const horizon = HALF + pitch + bobY;
      // ceiling: cold dark office air
      ctx.fillStyle = '#1c1c22'; ctx.fillRect(0, 0, W, horizon);
      ctx.fillStyle = '#14141a'; ctx.fillRect(0, 0, W, horizon * 0.45);
      // floor: charcoal with a blood-red wash near your feet
      ctx.fillStyle = '#26262b'; ctx.fillRect(0, horizon, W, H);
      ctx.fillStyle = '#2e2228'; ctx.fillRect(0, H - Math.max(10, 40 - pitch * 0.5), W, 60);
      const zbuf = castWalls(t, bobY);
      drawGhosts(t, zbuf, bobY);
      drawKick(t);
      drawHands(t, bobY);
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
    init, setSelf, updateRoster, matchStart, newQuestion, startReveal,
    setWinners, markAnswered, clearAnswered, setChosen,
    input,
    set onChoose(cb) { onChoose = cb; },
    _debug: () => ({ x: cam.x, y: cam.y, dir: cam.dir, pitch, chosen, openDoor, myFloor, locked, phase, ghostCount: ghosts.size }),
    _step: dt => update(dt), // test hook: advance simulation without rAF
    _isTransition: () => !!transition, _isKick: () => !!kick,
  };
})();
