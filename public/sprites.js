// FROG TOWER — pixel sprite data + tiny bitmap font.
// Sprites are string grids; each char is a palette key, '.' = transparent.
'use strict';

const FROG_COLORS = [
  { name: 'green',  body: '#4ec44e', belly: '#c9f0a1', dark: '#2e8f3e' },
  { name: 'blue',   body: '#4e9ee8', belly: '#b9e0f8', dark: '#2e6eb0' },
  { name: 'red',    body: '#e85e4e', belly: '#f8c1a9', dark: '#b03a2e' },
  { name: 'yellow', body: '#e8c84e', belly: '#f8eab1', dark: '#b09a2e' },
  { name: 'purple', body: '#a86ee8', belly: '#dcc9f8', dark: '#7a4ab0' },
  { name: 'orange', body: '#e8944e', belly: '#f8d1a9', dark: '#b06a2e' },
];

const FROG_IDLE = [
  '..KKK....KKK..',
  '.KWWWK..KWWWK.',
  '.KWPWK..KWPWK.',
  '.K111KKKK111K.',
  'K111111111111K',
  'K11KKKKKKKK11K',
  'K122222222221K',
  'K122222222221K',
  '.K1222222221K.',
  'K311222222113K',
  '.K3KK1111KK3K.',
  '.KK..KKKK..KK.',
];

const FROG_BLINK = [
  '..KKK....KKK..',
  '.K111K..K111K.',
  '.KKKKK..KKKKK.',
  '.K111KKKK111K.',
  'K111111111111K',
  'K11KKKKKKKK11K',
  'K122222222221K',
  'K122222222221K',
  '.K1222222221K.',
  'K311222222113K',
  '.K3KK1111KK3K.',
  '.KK..KKKK..KK.',
];

const FROG_JUMP = [
  '..KKK....KKK..',
  '.KWWWK..KWWWK.',
  '.KWPWK..KWPWK.',
  '.K111KKKK111K.',
  'K111111111111K',
  'K122222222221K',
  'K122222222221K',
  '.K1222222221K.',
  '..K11KKKK11K..',
  '..K1K....K1K..',
  '..K1K....K1K..',
  '.KK1KK..KK1KK.',
];

// Evil businessman leaning out of a window
const BIZ_LEAN = [
  '.....KKKKKK.....',
  '....KHHHHHHK....',
  '....KSSSSSSK....',
  '....KSKSSKSK....',
  '....KSSSSSSK....',
  '....KSKKKKSK....',
  '.....KSSSSK.....',
  '....KKKWWKKK....',
  '...K333WW333K...',
  '..K3333RR3333K..',
  '..K3333RR3333K..',
  '..K3333333333K..',
  '..KKKKKKKKKKKK..',
];

// Kick frame: leg + boot out to the left (toward the frog on the ledge)
const BIZ_KICK = [
  '.........KKKKKK.....',
  '........KHHHHHHK....',
  '........KSSSSSSK....',
  '........KSKSSKSK....',
  '........KSSSSSSK....',
  '........KSKKKKSK....',
  '.........KSSSSK.....',
  '........KKKWWKKK....',
  '.......K333WW333K...',
  '......K3333RR3333K..',
  'KKKKK3333333R3333K..',
  'KKKKK.K3333333333K..',
  '......KKKKKKKKKKKK..',
];

const CROWN = [
  'Y.Y.Y',
  'YYYYY',
  'YYYYY',
];

const SPRITE_PALETTE = {
  K: '#141419',
  W: '#f5f5ef',
  P: '#141419',
  S: '#e8b088',
  H: '#9a9aa2',
  R: '#d02a2a',
  Y: '#f0c840',
  3: '#33333d', // businessman suit (frogs override 1/2/3 per color)
};

// Render a string-grid sprite to an offscreen canvas. extra = palette overrides.
function makeSprite(grid, extra) {
  const h = grid.length, w = grid[0].length;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = grid[y][x];
      if (ch === '.') continue;
      const col = (extra && extra[ch]) || SPRITE_PALETTE[ch];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// Build the recolored frog frame set for each player color.
function buildFrogSprites() {
  return FROG_COLORS.map(col => {
    const map = { 1: col.body, 2: col.belly, 3: col.dark };
    return {
      idle: makeSprite(FROG_IDLE, map),
      blink: makeSprite(FROG_BLINK, map),
      jump: makeSprite(FROG_JUMP, map),
    };
  });
}

// ------------------------------------------------------------- 3x5 pixel font
const FONT3 = {
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 5, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4],
  Q: [2, 5, 5, 2, 1], R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 5, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7],
  0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [6, 1, 2, 4, 7], 3: [7, 1, 3, 1, 7],
  4: [5, 5, 7, 1, 1], 5: [7, 4, 6, 1, 6], 6: [3, 4, 7, 5, 7], 7: [7, 1, 2, 2, 2],
  8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 6],
  '!': [2, 2, 2, 0, 2], '?': [6, 1, 2, 0, 2], '.': [0, 0, 0, 0, 2],
  '-': [0, 0, 7, 0, 0], ':': [0, 2, 0, 2, 0], "'": [2, 2, 0, 0, 0],
  '/': [1, 1, 2, 4, 4], ' ': [0, 0, 0, 0, 0],
};

// Draw tiny text at integer pixel coords. scale = pixel size multiplier.
function drawTinyText(g, text, x, y, color, scale) {
  scale = scale || 1;
  g.fillStyle = color;
  let cx = x;
  for (const chRaw of String(text).toUpperCase()) {
    const glyph = FONT3[chRaw] || FONT3[' '];
    for (let row = 0; row < 5; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 3; col++) {
        if (bits & (4 >> col)) g.fillRect(cx + col * scale, y + row * scale, scale, scale);
      }
    }
    cx += 4 * scale;
  }
  return cx - x;
}
function tinyTextWidth(text, scale) { return String(text).length * 4 * (scale || 1) - (scale || 1); }
