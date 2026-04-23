(function () {
  'use strict';

  // ── World ────────────────────────────────────────────────────────────────────
  const W = 1800, H = 1100;
  const PRAD = 16, SPEED = 3.5, SYNC_MS = 80, LERP = 0.14;

  const BUILDINGS = [
    { id:'library', name:'Library', icon:'📚', x:270,  y:85,  w:235, h:155, body:'#5c3d1e', roof:'#3d2509', door:'#2a1506', accent:'#c8a040' },
    { id:'bar',     name:'Bar',     icon:'🍺', x:755,  y:760, w:195, h:135, body:'#7a3b1e', roof:'#4a1e0e', door:'#3a1508', accent:'#d4a060' },
    { id:'casino',  name:'Casino',  icon:'🃏', x:1195, y:120, w:235, h:165, body:'#6b0000', roof:'#420000', door:'#260000', accent:'#ffd700' },
    { id:'park',    name:'Park',    icon:'⚽', x:130,  y:610, w:295, h:235, body:'#2d7a3c', roof:'#1e5a2a', door:'#4aaa5a', accent:'#90ee90' },
    { id:'diner',    name:'Diner',    icon:'🤼', x:1195, y:715, w:195, h:135, body:'#c06820', roof:'#8b4a14', door:'#6a3510', accent:'#ffa040' },
    { id:'connect4', name:'Arcade',   icon:'🔴', x:870,  y:95,  w:215, h:145, body:'#1a3a8a', roof:'#0d2060', door:'#061040', accent:'#4488ff' },
  ];

  const ROADS = [
    { x:0,   y:455, w:W,  h:85 },
    { x:725, y:0,   w:85, h:H  },
  ];

  const TREES = [
    {x:75, y:75}, {x:145,y:330}, {x:580,y:75}, {x:648,y:675},
    {x:955,y:75}, {x:1050,y:310},{x:1480,y:105},{x:1600,y:450},
    {x:75, y:875},{x:468,y:895}, {x:965,y:910},{x:1490,y:870},
    {x:1605,y:640},{x:558,y:570},{x:1100,y:650},{x:378,y:435},
    {x:1082,y:435},{x:490,y:200},{x:1380,y:680},{x:220,y:510},
  ];

  // ── State ────────────────────────────────────────────────────────────────────
  let canvas, ctx;
  let sid = null, role = null;
  let myPos = {x:855, y:500};
  let oppPos = null, oppSmooth = null;
  let myProf = null, oppProf = null;
  let near = null;
  let lastSync = 0, lastTs = 0;
  let raf = null;
  let keys = {};
  let joy = {on:false, dx:0, dy:0};
  let cam = {x:0, y:0};
  let inChessAlready = false;
  let partnerOnline  = false;
  let nudgeListener  = null;
  let myAvatarCfg    = null;
  let oppAvatarCfg   = null;
  let myWalkPhase    = 0;
  let oppWalkPhase   = 0;
  let prevMyPos      = null;
  let targetPos      = null; // click-to-navigate target

  const clamp = (v,lo,hi) => v<lo?lo:v>hi?hi:v;
  const lerp  = (a,b,t)   => a + (b-a)*t;

  // ── Firebase ─────────────────────────────────────────────────────────────────
  function syncPos() {
    const now = Date.now();
    if (now - lastSync < SYNC_MS) return;
    lastSync = now;
    window.db?.ref(`sessions/${sid}/players/${role}`).update({
      x: Math.round(myPos.x), y: Math.round(myPos.y), t: now
    });
  }

  function listenSession() {
    const oppRole = role === 'host' ? 'guest' : 'host';
    window.db?.ref(`sessions/${sid}/players/${oppRole}`).on('value', snap => {
      const d = snap.val();
      if (!d) return;
      oppPos = {x: d.x, y: d.y};
      if (!oppSmooth) oppSmooth = {...oppPos};
    });
    // Listen for opponent profile joining
    window.db?.ref(`sessions/${sid}/profiles/${oppRole}`).on('value', snap => {
      const d = snap.val();
      if (d) oppProf = d;
    });
    // Listen for chess flag
    window.db?.ref(`sessions/${sid}`).on('value', snap => {
      const d = snap.val() || {};
      if (d.inChess && d.chessGameId) goChess(d.chessGameId);
    });
  }

  // ── Collision ─────────────────────────────────────────────────────────────────
  function collides(x, y) {
    return BUILDINGS.some(b =>
      x + PRAD > b.x + 8 && x - PRAD < b.x + b.w - 8 &&
      y + PRAD > b.y + 8 && y - PRAD < b.y + b.h - 8
    );
  }

  function getNear(px, py) {
    for (const b of BUILDINGS) {
      const cx = b.x + b.w / 2, cy = b.y + b.h;
      const dx = px - cx, dy = py - cy;
      if (Math.sqrt(dx*dx + dy*dy) < 68 + b.w * 0.22) return b;
    }
    return null;
  }

  // ── Camera ───────────────────────────────────────────────────────────────────
  function updateCam(cw, ch) {
    cam.x = clamp(myPos.x - cw / 2, 0, Math.max(0, W - cw));
    cam.y = clamp(myPos.y - ch / 2, 0, Math.max(0, H - ch));
  }

  // ── Draw helpers ─────────────────────────────────────────────────────────────
  function rr(x, y, w, h, r) {
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function drawGrass() {
    // Base grass
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#52865e');
    g.addColorStop(0.5, '#4a7a55');
    g.addColorStop(1, '#3e6e4a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Subtle grass tile pattern
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += 48) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // Grass tufts / variation
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    const offsets = [
      {x:420,y:180},{x:650,y:320},{x:1050,y:210},{x:1380,y:380},
      {x:340,y:700},{x:880,y:850},{x:1450,y:620},{x:200,y:400},
    ];
    for (const o of offsets) {
      ctx.beginPath(); ctx.ellipse(o.x, o.y, 40, 24, 0, 0, Math.PI*2); ctx.fill();
    }

    // Cobblestone paths from each building door to nearest road
    const paths = [
      { fx:387, fy:240, tx:387, ty:455 },  // library → h-road
      { fx:852, fy:895, tx:810, ty:895 },  // bar → v-road
      { fx:1312, fy:285, tx:1312, ty:455 }, // casino → h-road
      { fx:277, fy:845, tx:277, ty:845 },  // park entrance
      { fx:1292, fy:850, tx:1292, ty:850 }, // diner
      { fx:977, fy:240, tx:977, ty:455 },  // arcade → h-road
    ];
    ctx.fillStyle = '#8a7a65';
    for (const p of paths) {
      const isHoriz = Math.abs(p.tx - p.fx) > Math.abs(p.ty - p.fy);
      if (isHoriz) {
        const x0 = Math.min(p.fx, p.tx), x1 = Math.max(p.fx, p.tx);
        ctx.fillRect(x0, p.fy - 14, x1 - x0, 28);
      } else {
        const y0 = Math.min(p.fy, p.ty), y1 = Math.max(p.fy, p.ty);
        ctx.fillRect(p.fx - 14, y0, 28, y1 - y0);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.setLineDash([6,6]);
    for (const p of paths) {
      ctx.beginPath(); ctx.moveTo(p.fx, p.fy); ctx.lineTo(p.tx, p.ty); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawRoads() {
    ROADS.forEach(r => {
      // Asphalt base
      ctx.fillStyle = '#4a4a3e';
      ctx.fillRect(r.x, r.y, r.w, r.h);

      // Sidewalk on both edges
      ctx.fillStyle = '#6e6e5e';
      if (r.w > r.h) {
        ctx.fillRect(r.x, r.y, r.w, 8);
        ctx.fillRect(r.x, r.y + r.h - 8, r.w, 8);
      } else {
        ctx.fillRect(r.x, r.y, 8, r.h);
        ctx.fillRect(r.x + r.w - 8, r.y, 8, r.h);
      }

      // Lane divider dashes
      ctx.strokeStyle = '#f0d060';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([28, 20]);
      if (r.w > r.h) {
        ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h/2); ctx.lineTo(r.x + r.w, r.y + r.h/2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(r.x + r.w/2, r.y); ctx.lineTo(r.x + r.w/2, r.y + r.h); ctx.stroke();
      }
      ctx.setLineDash([]);

      // Crosswalk stripes at intersection
    });

    // Intersection box
    const ix = 725, iy = 455, iw = 85, ih = 85;
    ctx.fillStyle = '#4a4a3e'; ctx.fillRect(ix, iy, iw, ih);
    // Crosswalk on intersection
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(ix + 8 + i*16, iy, 9, ih);
      ctx.fillRect(ix, iy + 8 + i*16, iw, 9);
    }

    // Streetlamps
    const lamps = [
      {x:722, y:320},{x:722, y:140},{x:818, y:320},{x:818, y:140},
      {x:618, y:452},{x:618, y:548},{x:460, y:452},{x:460, y:548},
      {x:900, y:452},{x:900, y:548},{x:1080, y:452},{x:1080, y:548},
    ];
    for (const l of lamps) {
      ctx.fillStyle = '#5a5040'; ctx.fillRect(l.x - 2, l.y, 4, 30);
      ctx.fillStyle = '#4a4030'; ctx.fillRect(l.x - 6, l.y - 4, 12, 6);
      ctx.fillStyle = 'rgba(255,240,120,0.35)';
      ctx.beginPath(); ctx.arc(l.x, l.y - 8, 18, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffe060';
      ctx.beginPath(); ctx.arc(l.x, l.y - 8, 5, 0, Math.PI*2); ctx.fill();
    }
  }

  function drawTree(tx, ty) {
    ctx.fillStyle = '#3a2a0a'; ctx.fillRect(tx - 4, ty + 2, 8, 18);
    const g = ctx.createRadialGradient(tx - 4, ty - 10, 2, tx, ty, 22);
    g.addColorStop(0, '#5aaa40'); g.addColorStop(1, '#2a6020');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(tx, ty, 21, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#4a9030';
    ctx.beginPath(); ctx.arc(tx - 6, ty - 8, 14, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#60b040';
    ctx.beginPath(); ctx.arc(tx + 3, ty - 14, 10, 0, Math.PI*2); ctx.fill();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(tx - 4, ty - 4, 7, 0, Math.PI*2); ctx.fill();
  }

  function drawTrees() {
    TREES.forEach(t => drawTree(t.x, t.y));
  }

  // ── Building draw functions ───────────────────────────────────────────────────
  function glowBorder(b) {
    ctx.save();
    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 32;
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 3;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }

  function buildingLabel(b, glow) {
    ctx.save();
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    const label = `${b.icon} ${b.name}`;
    ctx.strokeStyle = 'rgba(0,0,0,0.95)'; ctx.lineWidth = 4;
    ctx.strokeText(label, b.x + b.w/2, b.y - 10);
    ctx.fillStyle = glow ? '#ffd700' : '#ffffff';
    ctx.fillText(label, b.x + b.w/2, b.y - 10);
    ctx.restore();
  }

  function drawLibrary(b, glow) {
    const {x, y, w, h} = b;
    // Stone facade
    ctx.fillStyle = '#e8dfc8';
    ctx.fillRect(x, y + 24, w, h - 24);
    // Stone texture lines
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1;
    for (let wy = y + 40; wy < y + h - 10; wy += 18) {
      ctx.beginPath(); ctx.moveTo(x + 2, wy); ctx.lineTo(x + w - 2, wy); ctx.stroke();
    }
    // Pediment (triangle roof)
    ctx.fillStyle = '#d4c8a8';
    ctx.beginPath();
    ctx.moveTo(x - 8, y + 28); ctx.lineTo(x + w/2, y - 8); ctx.lineTo(x + w + 8, y + 28);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#b0a080'; ctx.lineWidth = 2; ctx.stroke();
    // Frieze band
    ctx.fillStyle = '#c8ba94'; ctx.fillRect(x, y + 22, w, 10);
    // Columns (4)
    const colW = 14, colH = h - 55;
    const cols = [x + 22, x + w/2 - 20, x + w/2 + 6, x + w - 36];
    for (const cx_ of cols) {
      // Column base
      ctx.fillStyle = '#d8caa8'; ctx.fillRect(cx_ - 2, y + h - 22, colW + 4, 8);
      // Shaft
      const cg = ctx.createLinearGradient(cx_, 0, cx_ + colW, 0);
      cg.addColorStop(0, '#e0d4b4'); cg.addColorStop(0.4, '#f0e8d0'); cg.addColorStop(1, '#d0c4a0');
      ctx.fillStyle = cg; ctx.fillRect(cx_, y + 32, colW, colH);
      // Capital
      ctx.fillStyle = '#d0c4a0'; ctx.fillRect(cx_ - 3, y + 29, colW + 6, 6);
    }
    // Windows (arched)
    const wins = [x + 52, x + w - 82];
    for (const wx of wins) {
      ctx.fillStyle = '#b8d4e8'; ctx.fillRect(wx, y + 55, 26, 36);
      // Arch
      ctx.beginPath(); ctx.arc(wx + 13, y + 55, 13, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#b0a880'; ctx.lineWidth = 2;
      ctx.strokeRect(wx, y + 55, 26, 36);
      ctx.beginPath(); ctx.arc(wx + 13, y + 55, 13, Math.PI, 0); ctx.stroke();
      // Window cross
      ctx.lineWidth = 1; ctx.strokeStyle = '#8a9aaa';
      ctx.beginPath(); ctx.moveTo(wx + 13, y + 55); ctx.lineTo(wx + 13, y + 91); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx, y + 72); ctx.lineTo(wx + 26, y + 72); ctx.stroke();
    }
    // Steps
    for (let s = 0; s < 3; s++) {
      ctx.fillStyle = `rgba(0,0,0,${0.08 + s*0.05})`;
      ctx.fillRect(x - 4 + s*4, y + h - 16 + s*5, w + 8 - s*8, 5);
    }
    // Door (double)
    const dw = 36, dh = 44, dx = x + w/2 - dw/2, dy = y + h - dh - 2;
    ctx.fillStyle = glow ? '#ffe080' : '#7a5020';
    ctx.fillRect(dx, dy, dw/2 - 1, dh);
    ctx.fillRect(dx + dw/2 + 1, dy, dw/2 - 1, dh);
    // Door arch
    ctx.beginPath(); ctx.arc(dx + dw/2, dy, dw/2, Math.PI, 0);
    ctx.fillStyle = glow ? '#ffe080' : '#7a5020'; ctx.fill();
    ctx.strokeStyle = glow ? '#fff8a0' : '#5a3810'; ctx.lineWidth = 2; ctx.stroke();
    // Door knobs
    ctx.fillStyle = glow ? '#fff' : '#c8a040';
    ctx.beginPath(); ctx.arc(dx + dw/2 - 4, dy + dh*0.55, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(dx + dw/2 + 4, dy + dh*0.55, 3, 0, Math.PI*2); ctx.fill();
    // Sign
    ctx.save(); ctx.font = 'bold 9px serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#7a6020'; ctx.fillText('LIBRARY', x + w/2, y + 46); ctx.restore();
    if (glow) glowBorder(b);
    buildingLabel(b, glow);
  }

  function drawBar(b, glow) {
    const {x, y, w, h} = b;
    // Brick facade
    ctx.fillStyle = '#5a2810';
    ctx.fillRect(x, y, w, h);
    // Brick pattern
    for (let row = 0; row < Math.ceil(h/12); row++) {
      const wy = y + row * 12;
      const offset = (row % 2) * 18;
      for (let bx = x - offset; bx < x + w; bx += 36) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
        ctx.strokeRect(bx + 2, wy + 2, 32, 10);
      }
    }
    // Awning (red/white stripes)
    ctx.save();
    const aw = w + 14, ah = 22, ax = x - 7, ay = y + 22;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + aw, ay);
    ctx.lineTo(ax + aw - 8, ay + ah); ctx.lineTo(ax + 8, ay + ah); ctx.closePath();
    const stripW = aw / 6;
    ctx.clip();
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#cc2020' : '#f8f0e0';
      ctx.fillRect(ax + i * stripW, ay, stripW, ah + 2);
    }
    ctx.restore();
    ctx.strokeStyle = '#8a1a1a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + aw, ay);
    ctx.lineTo(ax + aw - 8, ay + ah); ctx.lineTo(ax + 8, ay + ah); ctx.stroke();
    // Windows
    for (const wx of [x + 16, x + w - 62]) {
      ctx.fillStyle = 'rgba(255,180,60,0.45)'; ctx.fillRect(wx, y + 52, 42, 40);
      ctx.strokeStyle = '#8a5020'; ctx.lineWidth = 2; ctx.strokeRect(wx, y + 52, 42, 40);
      // Bar stool silhouette inside
      ctx.fillStyle = 'rgba(60,20,0,0.4)';
      ctx.fillRect(wx + 8, y + 72, 8, 18); ctx.fillRect(wx + 26, y + 72, 8, 18);
      ctx.beginPath(); ctx.arc(wx + 12, y + 72, 6, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.arc(wx + 30, y + 72, 6, Math.PI, 0); ctx.fill();
    }
    // Neon sign
    ctx.save();
    ctx.shadowColor = '#ff4040'; ctx.shadowBlur = 14;
    ctx.strokeStyle = glow ? '#ffb060' : '#ff5050'; ctx.lineWidth = 2.5;
    ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = ctx.strokeStyle;
    ctx.fillText('🍺  BAR  🍺', x + w/2, y + 18);
    ctx.restore();
    // Door
    const dw = 30, dh = 40, dx = x + w/2 - dw/2, dy = y + h - dh;
    ctx.fillStyle = glow ? '#ffe080' : '#4a2808';
    ctx.fillRect(dx, dy, dw, dh);
    // Porthole window
    ctx.fillStyle = 'rgba(255,180,60,0.5)'; ctx.strokeStyle = '#8a5020'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(dx + dw/2, dy + 12, 8, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = glow ? '#fff8a0' : '#6a3818'; ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);
    if (glow) glowBorder(b);
    buildingLabel(b, glow);
  }

  function drawCasino(b, glow) {
    const {x, y, w, h} = b;
    // Dark exterior
    ctx.fillStyle = '#1a0808';
    ctx.fillRect(x, y, w, h);
    // Gold trim panels
    ctx.strokeStyle = '#c8a030'; ctx.lineWidth = 3;
    ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
    ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);
    // Marquee light border
    const step = 18;
    ctx.fillStyle = glow ? '#ffe080' : '#ffd040';
    for (let lx = x + 8; lx < x + w - 8; lx += step) {
      ctx.beginPath(); ctx.arc(lx, y + 8, 4, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(lx, y + h - 8, 4, 0, Math.PI*2); ctx.fill();
    }
    for (let ly = y + 8; ly < y + h - 8; ly += step) {
      ctx.beginPath(); ctx.arc(x + 8, ly, 4, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w - 8, ly, 4, 0, Math.PI*2); ctx.fill();
    }
    // Card suit symbols
    const suits = ['♠', '♥', '♦', '♣'];
    ctx.font = '18px serif'; ctx.textAlign = 'center';
    suits.forEach((s, i) => {
      ctx.fillStyle = (s === '♥' || s === '♦') ? '#cc2020' : '#c8a030';
      ctx.fillText(s, x + 28 + i * 46, y + 55);
    });
    // "CASINO" sign
    ctx.save();
    ctx.shadowColor = '#ffd040'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#ffd040';
    ctx.font = 'bold 20px serif'; ctx.textAlign = 'center';
    ctx.fillText('CASINO', x + w/2, y + 38);
    ctx.restore();
    // Windows
    for (const wx of [x + 20, x + w - 64]) {
      ctx.fillStyle = 'rgba(255,200,40,0.2)'; ctx.fillRect(wx, y + 65, 40, 50);
      ctx.strokeStyle = '#c8a030'; ctx.lineWidth = 2; ctx.strokeRect(wx, y + 65, 40, 50);
    }
    // Grand entrance
    const dw = 44, dh = 52, dx = x + w/2 - dw/2, dy = y + h - dh;
    ctx.fillStyle = glow ? '#ffe080' : '#2a1808';
    ctx.fillRect(dx, dy, dw/2 - 1, dh); ctx.fillRect(dx + dw/2 + 1, dy, dw/2 - 1, dh);
    // Arch
    ctx.beginPath(); ctx.arc(dx + dw/2, dy, dw/2, Math.PI, 0);
    ctx.fillStyle = glow ? '#ffe080' : '#2a1808'; ctx.fill();
    ctx.strokeStyle = '#c8a030'; ctx.lineWidth = 2; ctx.stroke();
    // Gold handles
    ctx.fillStyle = '#c8a030';
    ctx.fillRect(dx + dw/2 - 8, dy + 24, 4, 12);
    ctx.fillRect(dx + dw/2 + 4, dy + 24, 4, 12);
    if (glow) glowBorder(b);
    buildingLabel(b, glow);
  }

  function drawPark(b, glow) {
    const {x, y, w, h} = b;
    // Fenced area
    ctx.fillStyle = '#3a8040';
    ctx.fillRect(x, y, w, h);
    // Soccer field
    const fx = x + 20, fy = y + 30, fw = w - 40, fh = h - 60;
    ctx.fillStyle = '#458040'; ctx.fillRect(fx, fy, fw, fh);
    // Field lines
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
    ctx.strokeRect(fx + 4, fy + 4, fw - 8, fh - 8);
    ctx.beginPath(); ctx.moveTo(fx + fw/2, fy); ctx.lineTo(fx + fw/2, fy + fh); ctx.stroke();
    ctx.beginPath(); ctx.arc(fx + fw/2, fy + fh/2, 22, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(fx + fw/2, fy + fh/2, 4, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    // Goal boxes
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(fx + 4, fy + fh/2 - 20, 20, 40);
    ctx.strokeRect(fx + fw - 24, fy + fh/2 - 20, 20, 40);
    // Goal posts
    ctx.strokeStyle = '#f0f0f0'; ctx.lineWidth = 3;
    ctx.strokeRect(fx, fy + fh/2 - 16, 8, 32);
    ctx.strokeRect(fx + fw - 8, fy + fh/2 - 16, 8, 32);
    // Fence around park
    ctx.strokeStyle = '#5a4020'; ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);
    for (let px = x; px <= x + w; px += 14) {
      ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px, y + h - 12); ctx.lineTo(px, y + h); ctx.stroke();
    }
    // Entry gate
    ctx.fillStyle = '#2a1808'; ctx.fillRect(x + w/2 - 16, y + h - 8, 32, 8);
    ctx.fillStyle = glow ? '#ffe080' : '#5a4020';
    ctx.fillRect(x + w/2 - 4, y + h - 14, 8, 14);
    if (glow) glowBorder(b);
    buildingLabel(b, glow);
  }

  function drawDiner(b, glow) {
    const {x, y, w, h} = b;
    // Chrome/silver base
    ctx.fillStyle = '#c8c8b8';
    ctx.fillRect(x, y, w, h);
    // Red trim band
    ctx.fillStyle = '#cc2020'; ctx.fillRect(x, y, w, 16);
    ctx.fillStyle = '#cc2020'; ctx.fillRect(x, y + h - 10, w, 10);
    // Chrome horizontal stripe
    const cg = ctx.createLinearGradient(0, y + 16, 0, y + 28);
    cg.addColorStop(0, '#e8e8d8'); cg.addColorStop(0.5, '#ffffff'); cg.addColorStop(1, '#c0c0b0');
    ctx.fillStyle = cg; ctx.fillRect(x, y + 16, w, 12);
    // Large windows with booth silhouettes
    for (const wx of [x + 10, x + w - 68]) {
      ctx.fillStyle = '#d0eaf8'; ctx.fillRect(wx, y + 32, 55, 50);
      ctx.strokeStyle = '#888878'; ctx.lineWidth = 3; ctx.strokeRect(wx, y + 32, 55, 50);
      // Booth silhouettes
      ctx.fillStyle = 'rgba(60,30,20,0.35)';
      ctx.fillRect(wx + 6, y + 60, 18, 20); ctx.fillRect(wx + 30, y + 60, 18, 20);
      ctx.beginPath(); ctx.arc(wx + 15, y + 60, 7, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.arc(wx + 39, y + 60, 7, Math.PI, 0); ctx.fill();
    }
    // "DINER" retro sign
    ctx.save(); ctx.shadowColor = '#ff8060'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#ff2020'; ctx.font = 'bold 16px serif'; ctx.textAlign = 'center';
    ctx.fillText('DINER', x + w/2, y + 12);
    ctx.restore();
    // Checkerboard trim
    for (let i = 0; i < Math.floor(w / 8); i++) {
      ctx.fillStyle = i % 2 === 0 ? '#cc2020' : '#f0f0e0';
      ctx.fillRect(x + i * 8, y + h - 10, 8, 10);
    }
    // Door
    const dw = 28, dh = 38, dx = x + w/2 - dw/2, dy = y + h - dh;
    ctx.fillStyle = glow ? '#ffe080' : '#8a8a78';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = glow ? '#fff8a0' : '#cc2020'; ctx.lineWidth = 2; ctx.strokeRect(dx, dy, dw, dh);
    ctx.fillStyle = glow ? '#fff' : '#cc2020';
    ctx.beginPath(); ctx.arc(dx + dw - 7, dy + dh/2 + 3, 3, 0, Math.PI*2); ctx.fill();
    if (glow) glowBorder(b);
    buildingLabel(b, glow);
  }

  function drawArcade(b, glow) {
    const {x, y, w, h} = b;
    // Colorful facade
    ctx.fillStyle = '#2a0848';
    ctx.fillRect(x, y, w, h);
    // Gradient overlay
    const ag = ctx.createLinearGradient(x, y, x + w, y + h);
    ag.addColorStop(0, 'rgba(80,0,120,0.6)'); ag.addColorStop(1, 'rgba(0,80,160,0.4)');
    ctx.fillStyle = ag; ctx.fillRect(x, y, w, h);
    // Pixel art border pattern
    ctx.strokeStyle = '#c020c0'; ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
    ctx.strokeStyle = '#20a0ff'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 8, y + 8, w - 16, h - 16);
    // "ARCADE" pixel style sign
    ctx.save(); ctx.shadowColor = '#ff40ff'; ctx.shadowBlur = 16;
    ctx.fillStyle = glow ? '#ff80ff' : '#ff40ff';
    ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
    ctx.fillText('ARCADE', x + w/2, y + 28);
    ctx.restore();
    // Flashing dots decoration
    const t = Date.now() / 500;
    const dotColors = ['#ff40ff','#40ffff','#ff8040','#40ff40'];
    for (let i = 0; i < 8; i++) {
      const pulsed = Math.sin(t + i * 0.8) > 0;
      ctx.fillStyle = pulsed ? dotColors[i % 4] : 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.arc(x + 18 + i * (w - 36)/7, y + 40, 4, 0, Math.PI*2); ctx.fill();
    }
    // Arcade machine silhouettes in windows
    for (const wx of [x + 16, x + w - 62]) {
      ctx.fillStyle = 'rgba(0,200,255,0.15)'; ctx.fillRect(wx, y + 52, 42, 52);
      ctx.strokeStyle = '#40a0ff'; ctx.lineWidth = 1.5; ctx.strokeRect(wx, y + 52, 42, 52);
      // Cabinet shape
      ctx.fillStyle = 'rgba(0,40,80,0.7)';
      ctx.fillRect(wx + 5, y + 56, 32, 44);
      // Screen
      ctx.fillStyle = 'rgba(0,200,255,0.4)'; ctx.fillRect(wx + 9, y + 60, 24, 20);
      // Controls
      ctx.fillStyle = '#ff4040'; ctx.beginPath(); ctx.arc(wx + 17, y + 88, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#4040ff'; ctx.beginPath(); ctx.arc(wx + 28, y + 88, 4, 0, Math.PI*2); ctx.fill();
    }
    // Door
    const dw = 30, dh = 40, dx = x + w/2 - dw/2, dy = y + h - dh;
    ctx.fillStyle = glow ? '#ff80ff' : '#1a0830';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = glow ? '#fff8ff' : '#c020c0'; ctx.lineWidth = 2; ctx.strokeRect(dx, dy, dw, dh);
    // Coin slot
    ctx.fillStyle = '#c020c0'; ctx.fillRect(dx + dw/2 - 6, dy + 18, 12, 3);
    if (glow) glowBorder(b);
    buildingLabel(b, glow);
  }

  function drawBuildings() {
    BUILDINGS.forEach(b => {
      // Shadow under building
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(b.x + 8, b.y + 8, b.w, b.h);

      const glow = near?.id === b.id || targetPos?.buildingId === b.id;
      switch (b.id) {
        case 'library':  drawLibrary(b, glow);  break;
        case 'bar':      drawBar(b, glow);      break;
        case 'casino':   drawCasino(b, glow);   break;
        case 'park':     drawPark(b, glow);     break;
        case 'diner':    drawDiner(b, glow);    break;
        case 'connect4': drawArcade(b, glow);   break;
      }
    });
  }

  // ── Avatar / character drawing ────────────────────────────────────────────────
  const DEFAULT_AVATAR = { skin:'#f5c99a', hair:'#3a1a08', top:'#2a5caa', bot:'#1a2a50', hat:'none' };
  const OPP_AVATAR     = { skin:'#f5c99a', hair:'#8a3020', top:'#6a2020', bot:'#2a1a10', hat:'none' };

  function drawAvatar(pos, cfg, walkPhase, name, isMe) {
    const r = PRAD;
    cfg = cfg || (isMe ? DEFAULT_AVATAR : OPP_AVATAR);
    const {skin, hair, top: topColor, bot: botColor, hat, hatColor} = cfg;
    const swing = Math.sin(walkPhase) * 0.42;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(pos.x + 2, pos.y + r*0.6, r*0.75, r*0.22, 0, 0, Math.PI*2); ctx.fill();

    // Legs
    for (const [side, sign] of [[-1, -1],[1, 1]]) {
      ctx.save();
      ctx.translate(pos.x + side * r * 0.22, pos.y + r * 0.28);
      ctx.rotate(sign * swing);
      ctx.fillStyle = botColor;
      ctx.fillRect(-r*0.18, 0, r*0.36, r*0.75);
      // Shoe
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(-r*0.2, r*0.68, r*0.4, r*0.16);
      ctx.restore();
    }

    // Torso
    ctx.fillStyle = topColor;
    ctx.beginPath();
    rr(pos.x - r*0.48, pos.y - r*0.28, r*0.96, r*0.6, 3);
    ctx.fill();

    // Arms
    for (const [side, sign] of [[-1, 1],[1, -1]]) {
      ctx.save();
      ctx.translate(pos.x + side * r * 0.55, pos.y - r * 0.18);
      ctx.rotate(sign * swing * 0.85);
      ctx.fillStyle = topColor;
      ctx.fillRect(-r*0.15, 0, r*0.3, r*0.58);
      // Hand
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(0, r*0.62, r*0.14, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // Neck
    ctx.fillStyle = skin;
    ctx.fillRect(pos.x - r*0.14, pos.y - r*0.58, r*0.28, r*0.32);

    // Head
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(pos.x, pos.y - r*0.82, r*0.52, 0, Math.PI*2); ctx.fill();

    // Hair
    ctx.fillStyle = hair;
    ctx.beginPath(); ctx.arc(pos.x, pos.y - r*0.92, r*0.52, Math.PI*0.9, 0.1); ctx.fill();
    ctx.fillRect(pos.x - r*0.52, pos.y - r*0.92, r*0.14, r*0.28);
    ctx.fillRect(pos.x + r*0.38, pos.y - r*0.92, r*0.14, r*0.28);

    // Eyes
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(pos.x - r*0.19, pos.y - r*0.82, r*0.08, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(pos.x + r*0.19, pos.y - r*0.82, r*0.08, 0, Math.PI*2); ctx.fill();
    // Eye shine
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(pos.x - r*0.16, pos.y - r*0.85, r*0.03, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(pos.x + r*0.22, pos.y - r*0.85, r*0.03, 0, Math.PI*2); ctx.fill();
    // Smile
    ctx.strokeStyle = '#663a1a'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(pos.x, pos.y - r*0.72, r*0.18, 0.2, Math.PI - 0.2); ctx.stroke();

    // Hat
    if (hat === 'cap') {
      ctx.fillStyle = hatColor || '#cc2020';
      ctx.beginPath(); ctx.arc(pos.x, pos.y - r*1.18, r*0.5, Math.PI, 0); ctx.fill();
      ctx.fillRect(pos.x - r*0.72, pos.y - r*1.18, r*1.44, r*0.14); // brim
    } else if (hat === 'beanie') {
      ctx.fillStyle = hatColor || '#2244aa';
      ctx.beginPath(); ctx.arc(pos.x, pos.y - r*1.08, r*0.52, Math.PI*1.18, -Math.PI*0.18); ctx.fill();
      ctx.fillStyle = hatColor ? hatColor : '#4466cc';
      ctx.fillRect(pos.x - r*0.52, pos.y - r*1.08, r*1.04, r*0.16);
    }

    // Selection ring (me = blue ring)
    if (isMe) {
      ctx.strokeStyle = 'rgba(100,180,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r*1.1, 0, Math.PI*2); ctx.stroke();
    }

    // Name tag
    ctx.save();
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    const tw = ctx.measureText(name).width;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(pos.x - tw/2 - 6, pos.y - r*1.8, tw + 12, 18);
    ctx.fillStyle = isMe ? '#a8d8ff' : '#ffcda0';
    ctx.fillText(name, pos.x, pos.y - r*1.65);
    ctx.restore();
  }

  function drawHUD(cw, ch) {
    if (!near) return;
    const enterKey = /iPhone|iPad|Android/i.test(navigator.userAgent) ? 'Tap Enter' : 'Press E';
    const text = `${enterKey} to enter ${near.name}`;
    ctx.save();
    ctx.font = 'bold 15px monospace';
    const tw = ctx.measureText(text).width;
    const bw = tw + 38, bh = 38;
    const bx = (cw - bw) / 2, by = ch - 68;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 9);
    else ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1.5;
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 9);
    else ctx.rect(bx, by, bw, bh);
    ctx.stroke();
    ctx.fillStyle = '#ffd700';
    ctx.textAlign = 'center';
    ctx.fillText(text, cw/2, by + 25);
    ctx.restore();
  }

  // ── Game loop ─────────────────────────────────────────────────────────────────
  function tick(ts) {
    const dt = Math.min((ts - lastTs) / 16.67, 3);
    lastTs = ts;

    let dx = 0, dy = 0;
    if (keys['ArrowLeft']  || keys['a'] || keys['A']) dx -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) dx += 1;
    if (keys['ArrowUp']    || keys['w'] || keys['W']) dy -= 1;
    if (keys['ArrowDown']  || keys['s'] || keys['S']) dy += 1;
    if (joy.on) { dx += joy.dx; dy += joy.dy; }

    // Click-to-navigate auto-walk
    if (targetPos && !dx && !dy && !joy.on) {
      const tdx = targetPos.x - myPos.x, tdy = targetPos.y - myPos.y;
      const dist = Math.sqrt(tdx*tdx + tdy*tdy);
      if (dist > 6) {
        dx = tdx / dist; dy = tdy / dist;
      } else {
        targetPos = null;
      }
    }

    if (dx && dy) { dx *= 0.707; dy *= 0.707; }
    const spd = SPEED * dt;
    const prevX = myPos.x, prevY = myPos.y;
    const nx = clamp(myPos.x + dx * spd, PRAD, W - PRAD);
    const ny = clamp(myPos.y + dy * spd, PRAD, H - PRAD);
    if (!collides(nx, myPos.y)) myPos.x = nx;
    if (!collides(myPos.x, ny)) myPos.y = ny;

    const moved = Math.hypot(myPos.x - prevX, myPos.y - prevY);
    myWalkPhase += moved * 0.18;

    if (dx || dy || joy.on) syncPos();

    if (oppPos && oppSmooth) {
      const prevOx = oppSmooth.x, prevOy = oppSmooth.y;
      oppSmooth.x = lerp(oppSmooth.x, oppPos.x, LERP);
      oppSmooth.y = lerp(oppSmooth.y, oppPos.y, LERP);
      oppWalkPhase += Math.hypot(oppSmooth.x - prevOx, oppSmooth.y - prevOy) * 0.18;
    }

    near = getNear(myPos.x, myPos.y);

    const cw = canvas.width, ch = canvas.height;
    updateCam(cw, ch);
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    drawGrass();
    drawRoads();
    drawTrees();
    drawBuildings();
    if (oppSmooth) {
      drawAvatar(oppSmooth, oppAvatarCfg, oppWalkPhase, oppProf?.displayName || 'Partner', false);
    }
    drawAvatar(myPos, myAvatarCfg, myWalkPhase, myProf?.displayName || 'You', true);
    ctx.restore();
    drawHUD(cw, ch);

    // Update mobile enter button visibility
    const enterBtn = document.getElementById('map-enter-btn');
    if (enterBtn) enterBtn.classList.toggle('hidden', !near);

    raf = requestAnimationFrame(tick);
  }

  // ── Building bridges ──────────────────────────────────────────────────────────
  function goChess(chessGameId) {
    if (inChessAlready) return;
    inChessAlready = true;
    stopMap();
    document.getElementById('map-view')?.classList.add('hidden');
    document.getElementById('game-main')?.classList.remove('hidden');
    window.bootGameFromSession?.(chessGameId);
  }

  function goCasino(mode) {
    stopMap();
    document.getElementById('map-view')?.classList.add('hidden');
    document.getElementById('casino-view')?.classList.remove('hidden');
    const tryInit = () => {
      if (typeof window.initCasino !== 'function') { setTimeout(tryInit, 80); return; }
      window.initCasino({ sid, role, myProf, oppProf, mode: mode || 'multi' });
    };
    tryInit();
  }

  function goConnect4(mode) {
    stopMap();
    document.getElementById('map-view')?.classList.add('hidden');
    document.getElementById('connect4-view')?.classList.remove('hidden');
    const tryInit = () => {
      if (typeof window.initConnect4 !== 'function') { setTimeout(tryInit, 80); return; }
      window.initConnect4({ sid, role, myProf, oppProf, mode: mode || 'multi' });
    };
    tryInit();
  }

  function goBar(mode) {
    stopMap();
    document.getElementById('map-view')?.classList.add('hidden');
    document.getElementById('bar-view')?.classList.remove('hidden');
    const tryInit = () => {
      if (typeof window.initBar !== 'function') { setTimeout(tryInit, 80); return; }
      window.initBar({ sid, role, myProf, oppProf, mode: mode || 'multi' });
    };
    tryInit();
  }

  // ── Presence tracking ─────────────────────────────────────────────────────────
  let presenceReady = false;
  function setupPresence() {
    if (!window.db || !sid || !role || presenceReady) return;
    presenceReady = true;
    const presRef = window.db.ref(`sessions/${sid}/presence/${role}`);
    window.db.ref('.info/connected').on('value', snap => {
      if (!snap.val()) return;
      presRef.set(true);
      presRef.onDisconnect().remove();
    });
    const oppRole = role === 'host' ? 'guest' : 'host';
    window.db.ref(`sessions/${sid}/presence/${oppRole}`).on('value', snap => {
      partnerOnline = !!snap.val();
    });
  }

  // ── Nudge system ──────────────────────────────────────────────────────────────
  function setupNudgeListener() {
    if (!window.db || !sid || nudgeListener) return;
    nudgeListener = window.db.ref(`sessions/${sid}/nudge`);
    nudgeListener.on('value', snap => {
      const d = snap.val();
      if (!d || d.to !== role) return;
      if (Date.now() - d.t > 30000) return; // ignore old nudges
      const bld = BUILDINGS.find(b => b.id === d.building);
      if (!bld) return;
      const senderName = oppProf?.displayName || 'Your partner';
      showNudgeBanner(`${senderName} wants to play at the ${bld.name}!`, d.building);
    });
  }

  function sendNudge(buildingId) {
    if (!window.db || !sid) return;
    window.db.ref(`sessions/${sid}/nudge`).set({
      from: role,
      to: role === 'host' ? 'guest' : 'host',
      building: buildingId,
      t: Date.now()
    });
    showToastMsg('Nudge sent! 👋');
  }

  function showNudgeBanner(text, buildingId) {
    const banner   = document.getElementById('nudge-banner');
    const bannerTxt = document.getElementById('nudge-banner-text');
    const joinBtn  = document.getElementById('nudge-join-btn');
    const dismissBtn = document.getElementById('nudge-dismiss-btn');
    if (!banner) return;
    bannerTxt.textContent = text;
    banner.classList.remove('hidden');
    banner.style.display = 'flex';

    const dismiss = () => {
      banner.classList.add('hidden');
      joinBtn.removeEventListener('click', onJoin);
      dismissBtn.removeEventListener('click', dismiss);
    };
    const onJoin = () => {
      dismiss();
      window.db?.ref(`sessions/${sid}/nudge`).remove();
      launchGame(buildingId, 'multi');
    };
    joinBtn.addEventListener('click', onJoin);
    dismissBtn.addEventListener('click', dismiss);

    // Auto-dismiss after 20s
    clearTimeout(banner._t);
    banner._t = setTimeout(dismiss, 20000);
  }

  // ── Mode select modal ─────────────────────────────────────────────────────────
  function enterBuilding(b) {
    const minigames = ['library','bar','casino','park','diner','connect4'];
    if (!minigames.includes(b.id)) { showComingSoon(b.name); return; }
    if (b.id === 'library') { showLibraryPicker(); return; }
    showModeSelect(b);
  }

  function showLibraryPicker() {
    const modal = document.getElementById('library-picker');
    if (!modal) { showModeSelect(BUILDINGS.find(b => b.id === 'library')); return; }
    modal.classList.remove('hidden');
    document.getElementById('library-pick-chess')?.addEventListener('click', function onChess() {
      this.removeEventListener('click', onChess);
      modal.classList.add('hidden');
      showModeSelect(Object.assign({}, BUILDINGS.find(b => b.id === 'library'), { _game: 'chess' }));
    }, { once: true });
    document.getElementById('library-pick-connect4')?.addEventListener('click', function onC4() {
      this.removeEventListener('click', onC4);
      modal.classList.add('hidden');
      showModeSelect(Object.assign({}, BUILDINGS.find(b => b.id === 'library'), { _game: 'connect4', icon: '🔴', name: 'Connect 4' }));
    }, { once: true });
    document.getElementById('library-pick-cancel')?.addEventListener('click', function onCancel() {
      this.removeEventListener('click', onCancel);
      modal.classList.add('hidden');
    }, { once: true });
  }

  function showModeSelect(b) {
    const modal      = document.getElementById('mode-select');
    const icon       = document.getElementById('mode-select-icon');
    const title      = document.getElementById('mode-select-title');
    const status     = document.getElementById('partner-status');
    const soloBtn    = document.getElementById('mode-solo-btn');
    const partnerBtn = document.getElementById('mode-partner-btn');
    const nudgeBtn   = document.getElementById('mode-nudge-btn');
    const cancelBtn  = document.getElementById('mode-cancel-btn');
    if (!modal) return;

    icon.textContent  = b.icon;
    title.textContent = b.name;

    // Partner status
    if (partnerOnline) {
      status.textContent = '🟢 Partner is online';
      status.style.color = '#60d080';
      nudgeBtn.classList.add('hidden');
      partnerBtn.style.opacity = '1';
      partnerBtn.style.pointerEvents = 'auto';
    } else {
      status.textContent = '🔴 Partner is offline';
      status.style.color = '#d06060';
      nudgeBtn.classList.remove('hidden');
      partnerBtn.style.opacity = '0.45';
      partnerBtn.style.pointerEvents = 'none';
    }

    modal.classList.remove('hidden');

    const cleanup = () => {
      modal.classList.add('hidden');
      soloBtn.onclick = null;
      partnerBtn.onclick = null;
      nudgeBtn.onclick = null;
      cancelBtn.onclick = null;
    };

    const gameId = b._game || b.id;
    soloBtn.onclick = () => { cleanup(); launchGame(gameId, 'solo'); };
    partnerBtn.onclick = () => { if (partnerOnline) { cleanup(); launchGame(gameId, 'multi'); } };
    nudgeBtn.onclick = () => { sendNudge(b.id); };
    cancelBtn.onclick = cleanup;
  }

  function launchGame(buildingId, mode) {
    if (buildingId === 'library' || buildingId === 'chess') {
      const db = window.db;
      if (!db || !sid) return;
      db.ref(`sessions/${sid}`).once('value', snap => {
        const d = snap.val() || {};
        const updates = { inChess: true };
        if (!d.chessGameId) updates.chessGameId = rndId();
        db.ref(`sessions/${sid}`).update(updates);
      });
      return;
    }
    if (buildingId === 'bar')      { goBar(mode);      return; }
    if (buildingId === 'casino')   { goCasino(mode);   return; }
    if (buildingId === 'connect4') { goConnect4(mode); return; }
    showComingSoon(buildingId);
  }

  function showComingSoon(name) {
    const el = document.getElementById('map-toast');
    if (!el) return;
    el.textContent = `${name} — coming soon!`;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  function showToastMsg(msg) {
    const el = document.getElementById('map-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  // ── Input ─────────────────────────────────────────────────────────────────────
  function onKey(e) {
    keys[e.key] = e.type === 'keydown';
    if (e.type === 'keydown' && (e.key === 'e' || e.key === 'E') && near) {
      enterBuilding(near);
    }
  }

  let joystickReady = false;
  function setupJoystick() {
    if (joystickReady) return;
    joystickReady = true;
    const pad = document.getElementById('map-dpad');
    if (!pad) return;
    let cx = 0, cy = 0;
    const start = (x, y) => {
      const r = pad.getBoundingClientRect();
      cx = r.left + r.width/2; cy = r.top + r.height/2;
      joy.on = true; move(x, y);
    };
    const move = (x, y) => {
      if (!joy.on) return;
      let dx = x - cx, dy = y - cy;
      const m = Math.sqrt(dx*dx + dy*dy);
      if (m < 14) { joy.dx = 0; joy.dy = 0; return; }
      joy.dx = dx / Math.max(m, 60);
      joy.dy = dy / Math.max(m, 60);
    };
    const end = () => { joy.on = false; joy.dx = 0; joy.dy = 0; };

    pad.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: false });
    pad.addEventListener('touchmove',  e => { e.preventDefault(); const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: false });
    pad.addEventListener('touchend',   e => { e.preventDefault(); end(); }, { passive: false });

    document.getElementById('map-enter-btn')?.addEventListener('click', () => {
      if (near) enterBuilding(near);
    });
  }

  function resize() {
    if (!canvas) return;
    canvas.width  = canvas.clientWidth  || window.innerWidth;
    canvas.height = canvas.clientHeight || window.innerHeight;
  }

  function rndId() {
    const c = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({length: 10}, () => c[Math.floor(Math.random() * c.length)]).join('');
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  function stopMap() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup',   onKey);
    window.removeEventListener('resize', resize);
    canvas?.removeEventListener('click', onMapClick);
    keys = {};
    if (sid) {
      const oppRole = role === 'host' ? 'guest' : 'host';
      window.db?.ref(`sessions/${sid}/players/${oppRole}`).off();
      window.db?.ref(`sessions/${sid}/profiles/${oppRole}`).off();
      window.db?.ref(`sessions/${sid}`).off();
    }
  }

  function onMapClick(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const wx = (e.clientX - rect.left) * scaleX + cam.x;
    const wy = (e.clientY - rect.top)  * scaleY + cam.y;

    // Check if a building was clicked
    for (const b of BUILDINGS) {
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) {
        // Walk to just in front of the door
        targetPos = { x: b.x + b.w / 2, y: b.y + b.h + 45, buildingId: b.id };
        return;
      }
    }
    // Otherwise walk to clicked spot
    targetPos = { x: clamp(wx, PRAD, W - PRAD), y: clamp(wy, PRAD, H - PRAD) };
  }

  window.initMap = function (opts) {
    sid = opts.sid; role = opts.role;
    myProf = opts.myProf; oppProf = opts.oppProf || null;
    myAvatarCfg  = opts.myProf?.avatar  || null;
    oppAvatarCfg = opts.oppProf?.avatar || null;
    inChessAlready = false;
    keys = {}; joy = {on:false, dx:0, dy:0};
    oppPos = null; oppSmooth = null;
    myWalkPhase = 0; oppWalkPhase = 0;
    targetPos = null;

    canvas = document.getElementById('map-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    myPos = role === 'host' ? {x: 800, y: 500} : {x: 920, y: 500};
    window.db?.ref(`sessions/${sid}/players/${role}`).update({
      x: Math.round(myPos.x), y: Math.round(myPos.y), t: Date.now()
    });

    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup',   onKey);
    canvas.addEventListener('click', onMapClick);
    setupJoystick();
    listenSession();
    setupPresence();
    setupNudgeListener();
    lastTs = performance.now();
    raf = requestAnimationFrame(tick);
  };

  window.stopMap = stopMap;

  // ── Map Preview (login background) ───────────────────────────────────────────
  window.startMapPreview = function (previewCanvas) {
    if (!previewCanvas) return;
    const pc = previewCanvas;
    const px = pc.getContext('2d');
    let praf = null;
    let panX = 200, panY = 50;
    const PAN_SPEED = 0.25;

    function resizePreview() {
      pc.width  = pc.offsetWidth  || window.innerWidth;
      pc.height = pc.offsetHeight || window.innerHeight;
    }

    function tickPreview() {
      resizePreview();
      const cw = pc.width, ch = pc.height;
      panX += PAN_SPEED;
      if (panX > W - cw) panX = 0;

      px.clearRect(0, 0, cw, ch);
      px.save();
      px.translate(-Math.round(panX), -Math.round(panY));

      // reuse draw functions with preview context swap
      const origCtx = ctx;
      ctx = px;
      drawGrass();
      drawRoads();
      drawTrees();
      drawBuildings();
      ctx = origCtx;

      px.restore();
      praf = requestAnimationFrame(tickPreview);
    }

    resizePreview();
    praf = requestAnimationFrame(tickPreview);

    window.stopMapPreview = function () {
      if (praf) cancelAnimationFrame(praf);
      praf = null;
      pc.style.display = 'none';
    };
  };

  window.returnToMap = function () {
    if (!sid) return;
    inChessAlready = false;
    window.db?.ref(`sessions/${sid}`).update({ inChess: false });
    window.stopBar?.();
    window.stopCasino?.();
    window.stopConnect4?.();
    // Hide all game views, show map
    document.getElementById('game-main')?.classList.add('hidden');
    document.getElementById('bar-view')?.classList.add('hidden');
    document.getElementById('casino-view')?.classList.add('hidden');
    document.getElementById('connect4-view')?.classList.add('hidden');
    document.getElementById('map-view')?.classList.remove('hidden');
    // Wait one frame so the canvas has real dimensions before initMap
    requestAnimationFrame(() => {
      window.initMap({ sid, role, myProf, oppProf });
    });
  };
})();

