(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────────
  const BALL_R    = 11;
  const POCKET_R  = 18;
  const FRICTION  = 0.984;
  const MIN_SPD   = 0.055;
  const MAX_POWER = 20;
  const CUSHION   = 28;

  // Ball colors indexed by id (1-15). Stripes 9-15 share colors with solids 1-7.
  const COLORS = [
    null,
    '#f0c010','#1a55c0','#cc2200','#881ec0','#e06000',
    '#116611','#882211','#111111',
    '#f0c010','#1a55c0','#cc2200','#881ec0','#e06000',
    '#116611','#882211',
  ];

  // ── State ─────────────────────────────────────────────────────────────────────
  let canvas, ctx;
  let sid, myRole, oppRole;
  let balls = [], pockets = [];
  let TABLE = {}, PF = {};
  let myTurn     = false;
  let myGroup    = null;   // null | 'solid' | 'stripe'
  let oppGroup   = null;
  let phase      = 'waiting'; // 'waiting'|'aiming'|'shooting'|'placing'|'gameover'
  let aimAngle   = 0;
  let shotPower  = 0;
  let mouseDown  = false;
  let mouse      = { x: 0, y: 0 };
  let raf        = null;
  let lastTs     = 0;
  let lastSyncTs = 0;
  let toast      = { msg: '', ttl: 0 };
  let gameOver   = false;
  let winner     = null;
  let turnPocketed   = [];
  let scratchThisTurn = false;

  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

  // ── Table geometry ────────────────────────────────────────────────────────────
  function setupTable() {
    const cw = canvas.width, ch = canvas.height;
    const tw = Math.min(cw * 0.86, ch * 1.92);
    const th = tw / 1.92;
    TABLE = { x: (cw - tw) / 2, y: (ch - th) / 2, w: tw, h: th };
    PF    = { x: TABLE.x + CUSHION, y: TABLE.y + CUSHION,
              w: TABLE.w - CUSHION * 2, h: TABLE.h - CUSHION * 2 };

    const pr = POCKET_R + 2;
    pockets = [
      { x: TABLE.x + pr,           y: TABLE.y + pr           },  // TL
      { x: TABLE.x + TABLE.w / 2,  y: TABLE.y - 2            },  // TM
      { x: TABLE.x + TABLE.w - pr, y: TABLE.y + pr           },  // TR
      { x: TABLE.x + pr,           y: TABLE.y + TABLE.h - pr },  // BL
      { x: TABLE.x + TABLE.w / 2,  y: TABLE.y + TABLE.h + 2  },  // BM
      { x: TABLE.x + TABLE.w - pr, y: TABLE.y + TABLE.h - pr },  // BR
    ];
  }

  // ── Ball rack ─────────────────────────────────────────────────────────────────
  // Standard 8-ball: 8 in centre, one stripe + one solid in back corners.
  function rackBalls() {
    const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
    const footX  = PF.x + PF.w * 0.75;
    const footY  = PF.y + PF.h * 0.5;
    const d      = BALL_R * 2 + 0.8;
    const rowH   = d * 0.866;

    balls = [];
    let idx = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col <= row; col++) {
        balls.push({
          id: order[idx++],
          x: footX + row * rowH,
          y: footY + (col - row / 2) * d,
          vx: 0, vy: 0, pocketed: false,
        });
      }
    }
    // Cue ball behind head string
    balls.push({
      id: 0,
      x: PF.x + PF.w * 0.25,
      y: PF.y + PF.h * 0.5,
      vx: 0, vy: 0, pocketed: false,
    });
  }

  // ── Physics ───────────────────────────────────────────────────────────────────
  function step() {
    for (const b of balls) {
      if (b.pocketed) continue;
      b.x += b.vx;
      b.y += b.vy;
      b.vx *= FRICTION;
      b.vy *= FRICTION;
      if (Math.abs(b.vx) < MIN_SPD) b.vx = 0;
      if (Math.abs(b.vy) < MIN_SPD) b.vy = 0;
      wallBounce(b);
    }
    // Resolve ball-ball collisions
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        resolveCollision(balls[i], balls[j]);
      }
    }
    // Pocket checks after collisions are settled
    for (const b of balls) checkPocket(b);
  }

  function wallBounce(b) {
    const minX = PF.x + BALL_R, maxX = PF.x + PF.w - BALL_R;
    const minY = PF.y + BALL_R, maxY = PF.y + PF.h - BALL_R;
    if (b.x < minX) { b.x = minX; b.vx =  Math.abs(b.vx) * 0.76; }
    if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * 0.76; }
    if (b.y < minY) { b.y = minY; b.vy =  Math.abs(b.vy) * 0.76; }
    if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy) * 0.76; }
  }

  function resolveCollision(a, b) {
    if (a.pocketed || b.pocketed) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist2 = dx * dx + dy * dy;
    const min   = BALL_R * 2;
    if (dist2 >= min * min) return;

    const dist = Math.sqrt(dist2) || 0.001;
    const nx = dx / dist, ny = dy / dist;
    const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
    const dot = dvx * nx + dvy * ny;
    if (dot <= 0) return;

    // Exchange momentum (equal mass, elastic)
    a.vx -= dot * nx; a.vy -= dot * ny;
    b.vx += dot * nx; b.vy += dot * ny;

    // Push apart so they don't overlap
    const overlap = (min - dist) / 2 + 0.1;
    a.x -= nx * overlap; a.y -= ny * overlap;
    b.x += nx * overlap; b.y += ny * overlap;
  }

  function checkPocket(b) {
    if (b.pocketed) return;
    for (const p of pockets) {
      const dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy < POCKET_R * POCKET_R) {
        b.pocketed = true;
        b.vx = 0; b.vy = 0;
        if (phase === 'shooting') {
          turnPocketed.push(b.id);
          if (b.id === 0) scratchThisTurn = true;
        }
        return;
      }
    }
  }

  function allStopped() {
    return balls.every(b => b.pocketed || (b.vx === 0 && b.vy === 0));
  }

  // ── Drawing ───────────────────────────────────────────────────────────────────
  function drawTable() {
    const t = TABLE;

    // Wood surround
    ctx.fillStyle = '#5c3010';
    ctx.fillRect(t.x - 20, t.y - 20, t.w + 40, t.h + 40);
    ctx.fillStyle = '#7a4520';
    ctx.fillRect(t.x - 14, t.y - 14, t.w + 28, t.h + 28);

    // Felt base
    ctx.fillStyle = '#1a6b35';
    ctx.fillRect(t.x, t.y, t.w, t.h);

    // Subtle felt grain
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    for (let lx = t.x; lx < t.x + t.w; lx += 20) {
      ctx.beginPath(); ctx.moveTo(lx, t.y); ctx.lineTo(lx, t.y + t.h); ctx.stroke();
    }

    // Cushions
    const cushionColor = '#1e8040';
    ctx.fillStyle = cushionColor;
    ctx.fillRect(t.x, t.y, t.w, CUSHION);
    ctx.fillRect(t.x, t.y + t.h - CUSHION, t.w, CUSHION);
    ctx.fillRect(t.x, t.y, CUSHION, t.h);
    ctx.fillRect(t.x + t.w - CUSHION, t.y, CUSHION, t.h);

    // Head string
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(PF.x + PF.w * 0.25, PF.y);
    ctx.lineTo(PF.x + PF.w * 0.25, PF.y + PF.h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pockets
    for (const p of pockets) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(p.x + 2, p.y + 3, POCKET_R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#050e08';
      ctx.beginPath(); ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function drawBall(b) {
    if (b.pocketed) return;
    const { x, y } = b;
    const r = BALL_R;

    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2); ctx.fill();

    if (b.id === 0) {
      // Cue ball — white with radial gradient
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 1, x, y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#cccccc');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    } else {
      const color  = COLORS[b.id];
      const stripe = b.id >= 9;

      if (stripe) {
        // White base
        ctx.fillStyle = '#f0efeb';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        // Colour stripe band (clipped to ball circle)
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = color;
        ctx.fillRect(x - r, y - r * 0.43, r * 2, r * 0.86);
        ctx.restore();
      } else {
        // Solid with radial gradient
        const g = ctx.createRadialGradient(x - r * 0.28, y - r * 0.32, 0, x, y, r * 1.05);
        g.addColorStop(0, lighten(color, 55));
        g.addColorStop(1, color);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }

      // Number disc
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(x, y, r * 0.37, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#1a1a1a';
      ctx.font = `bold ${Math.max(7, r * 0.43)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.id), x, y + 0.5);
    }

    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath(); ctx.arc(x - r * 0.27, y - r * 0.32, r * 0.21, 0, Math.PI * 2); ctx.fill();

    // Outline
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  }

  function drawAim() {
    if (!myTurn || phase !== 'aiming') return;
    const cb = cueBall();
    if (!cb) return;

    // Dotted aim line
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.moveTo(cb.x, cb.y);
    ctx.lineTo(cb.x + Math.cos(aimAngle) * 230, cb.y + Math.sin(aimAngle) * 230);
    ctx.stroke();
    ctx.setLineDash([]);

    // Cue stick
    const pullback = shotPower * 3.2;
    const tipX = cb.x - Math.cos(aimAngle) * (BALL_R + 3);
    const tipY = cb.y - Math.sin(aimAngle) * (BALL_R + 3);
    const butX = tipX - Math.cos(aimAngle) * (110 + pullback);
    const butY = tipY - Math.sin(aimAngle) * (110 + pullback);

    const cg = ctx.createLinearGradient(tipX, tipY, butX, butY);
    cg.addColorStop(0, '#e8d090');
    cg.addColorStop(0.25, '#c8a055');
    cg.addColorStop(1, '#7a4015');
    ctx.strokeStyle = cg;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(butX, butY); ctx.stroke();

    // Cue tip highlight
    ctx.strokeStyle = '#5090d0';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(aimAngle) * 6, tipY - Math.sin(aimAngle) * 6);
    ctx.stroke();

    ctx.restore();

    if (mouseDown) drawPowerBar();
  }

  function drawPowerBar() {
    const bx = TABLE.x + 10, by = TABLE.y + TABLE.h - 118;
    const bw = 14, bh = 108;
    const fill = (shotPower / MAX_POWER) * bh;
    const hue  = 120 - (shotPower / MAX_POWER) * 120;

    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = `hsl(${hue},88%,48%)`;
    ctx.fillRect(bx, by + bh - fill, bw, fill);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.fillStyle = '#aaa';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PWR', bx + bw / 2, by - 5);
  }

  function drawHUD() {
    const t = TABLE;
    ctx.save();
    ctx.font = 'bold 13px monospace';

    // Turn banner
    let turnText, turnColor;
    if (gameOver) {
      turnText  = winner === myRole ? '🎱 You win!' : '🎱 Opponent wins!';
      turnColor = '#ffd700';
    } else if (phase === 'placing') {
      turnText  = 'Click to place cue ball';
      turnColor = '#ffd700';
    } else {
      turnText  = myTurn ? 'Your turn' : "Opponent's turn";
      turnColor = myTurn ? '#a8ffa8' : '#ffcca0';
    }
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(t.x, t.y - 34, 230, 28);
    ctx.fillStyle = turnColor;
    ctx.textAlign = 'left';
    ctx.fillText(turnText, t.x + 8, t.y - 15);

    // Group labels
    if (myGroup) {
      const label = `You: ${myGroup}s  ·  Opp: ${oppGroup}s`;
      const lw = ctx.measureText(label).width + 18;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(t.x + t.w - lw, t.y - 34, lw, 28);
      ctx.fillStyle = '#ddd';
      ctx.textAlign = 'right';
      ctx.fillText(label, t.x + t.w - 8, t.y - 15);
    }

    // Toast
    if (toast.ttl > 0) {
      ctx.globalAlpha = Math.min(1, toast.ttl / 20);
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(toast.msg).width;
      ctx.fillStyle = 'rgba(0,0,0,0.88)';
      ctx.fillRect(t.x + t.w / 2 - tw / 2 - 14, t.y + t.h / 2 - 24, tw + 28, 40);
      ctx.fillStyle = '#ffd700';
      ctx.fillText(toast.msg, t.x + t.w / 2, t.y + t.h / 2 + 4);
      ctx.globalAlpha = 1;
    }

    // Back button
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(t.x + t.w - 90, t.y + t.h + 8, 90, 26);
    ctx.fillStyle = '#aaa';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('← Back to map', t.x + t.w - 45, t.y + t.h + 26);

    ctx.restore();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function cueBall() {
    return balls.find(b => b.id === 0 && !b.pocketed);
  }

  function isMyBall(id) {
    if (!myGroup || id === 0 || id === 8) return false;
    return myGroup === 'solid' ? id <= 7 : id >= 9;
  }

  function lighten(hex, amt) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${clamp(r+amt,0,255)},${clamp(g+amt,0,255)},${clamp(b+amt,0,255)})`;
  }

  function showToast(msg) {
    toast = { msg, ttl: 140 };
  }

  // ── Game logic ────────────────────────────────────────────────────────────────
  function shoot() {
    const cb = cueBall();
    if (!cb || !myTurn || phase !== 'aiming') return;
    cb.vx = Math.cos(aimAngle) * shotPower;
    cb.vy = Math.sin(aimAngle) * shotPower;
    phase           = 'shooting';
    turnPocketed    = [];
    scratchThisTurn = false;
  }

  function handleTurnEnd() {
    const nonSpecial = turnPocketed.filter(id => id !== 0 && id !== 8);

    // Assign groups on first pocketed object ball
    if (!myGroup && nonSpecial.length > 0) {
      myGroup  = nonSpecial[0] <= 7 ? 'solid' : 'stripe';
      oppGroup = myGroup === 'solid' ? 'stripe' : 'solid';
      showToast(`You got ${myGroup}s!`);
    }

    // 8-ball pocketed
    if (turnPocketed.includes(8)) {
      const myLeft = balls.filter(b => !b.pocketed && isMyBall(b.id)).length;
      endGame(myLeft === 0 && !scratchThisTurn ? myRole : oppRole);
      return;
    }

    // Scratch
    if (scratchThisTurn) {
      showToast('Scratch! Opponent places ball');
      endTurn(false, true);
      return;
    }

    // Pocketed own ball(s) → keep shooting
    const mySunk = nonSpecial.filter(id => isMyBall(id));
    if (mySunk.length > 0 && myGroup) {
      showToast(`+${mySunk.length} — keep shooting!`);
      endTurn(true, false);
    } else {
      endTurn(false, false);
    }
  }

  function endTurn(keepTurn, opponentPlaces) {
    pushState(keepTurn ? myRole : oppRole, opponentPlaces);
    myTurn = keepTurn;
    phase  = keepTurn ? 'aiming' : 'waiting';
  }

  function endGame(winRole) {
    gameOver = true;
    winner   = winRole;
    showToast(winRole === myRole ? '🎱 You win!' : '🎱 Opponent wins!');
    pushState(null, false);
    myTurn = false;
    phase  = 'gameover';
  }

  function placeCueBall(x, y) {
    const cx = clamp(x, PF.x + BALL_R, PF.x + PF.w * 0.25 - BALL_R);
    const cy = clamp(y, PF.y + BALL_R, PF.y + PF.h - BALL_R);
    let cb = balls.find(b => b.id === 0);
    if (!cb) {
      balls.push({ id: 0, x: cx, y: cy, vx: 0, vy: 0, pocketed: false });
    } else {
      Object.assign(cb, { x: cx, y: cy, vx: 0, vy: 0, pocketed: false });
    }
    phase = 'aiming';
  }

  // ── Firebase ──────────────────────────────────────────────────────────────────
  function pushState(nextTurn, opponentPlaces) {
    const groups = {};
    groups[myRole]  = myGroup;
    groups[oppRole] = oppGroup;
    window.db?.ref(`sessions/${sid}/pool`).set({
      balls: balls.map(b => ({ id: b.id, x: +b.x.toFixed(1), y: +b.y.toFixed(1), pocketed: b.pocketed })),
      groups,
      turn:           nextTurn,
      opponentPlaces: opponentPlaces || false,
      gameOver:       gameOver || false,
      winner:         winner   || null,
      t:              Date.now(),
    });
  }

  function listenPool() {
    window.db?.ref(`sessions/${sid}/pool`).on('value', snap => {
      const d = snap.val();
      if (!d || d.t <= lastSyncTs) return;
      lastSyncTs = d.t;
      if (d.turn !== myRole) return;  // not my turn yet
      applyNetState(d);
    });
  }

  function applyNetState(d) {
    for (const nb of d.balls) {
      const b = balls.find(b => b.id === nb.id);
      if (b) Object.assign(b, { x: nb.x, y: nb.y, pocketed: nb.pocketed, vx: 0, vy: 0 });
    }
    if (d.groups) {
      myGroup  = d.groups[myRole]  || null;
      oppGroup = d.groups[oppRole] || null;
    }
    if (d.gameOver) {
      gameOver = true; winner = d.winner;
      showToast(d.winner === myRole ? '🎱 You win!' : '🎱 Opponent wins!');
      phase = 'gameover'; myTurn = false;
      return;
    }
    myTurn = true;
    phase  = d.opponentPlaces ? 'placing' : 'aiming';
    if (d.opponentPlaces) showToast('Scratch! Place the cue ball');
  }

  // ── Input ─────────────────────────────────────────────────────────────────────
  function canvasPos(e) {
    const r  = canvas.getBoundingClientRect();
    const sx = canvas.width  / r.width;
    const sy = canvas.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  function updateAim() {
    const cb = cueBall();
    if (!cb) return;
    aimAngle = Math.atan2(mouse.y - cb.y, mouse.x - cb.x);
    if (mouseDown) {
      const dx   = mouse.x - cb.x, dy = mouse.y - cb.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Pull-back: distance dragged opposite to aim direction = power
      const pull = Math.max(0, -Math.cos(Math.atan2(dy, dx) - aimAngle) * dist);
      shotPower  = clamp(pull / 7.5, 0, MAX_POWER);
    }
  }

  function onDown(e) {
    mouse = canvasPos(e);
    if (phase === 'placing') { placeCueBall(mouse.x, mouse.y); return; }
    if (!myTurn || phase !== 'aiming') return;

    // Back button hit-test
    const t = TABLE;
    if (mouse.x > t.x + t.w - 90 && mouse.x < t.x + t.w &&
        mouse.y > t.y + t.h + 8  && mouse.y < t.y + t.h + 34) {
      window.returnToMap?.();
      return;
    }
    mouseDown = true;
    updateAim();
  }

  function onMove(e) {
    mouse = canvasPos(e.touches ? e.touches[0] : e);
    updateAim();
  }

  function onUp() {
    if (!mouseDown) return;
    mouseDown = false;
    if (shotPower > 0.5) shoot();
    shotPower = 0;
  }

  function setupInput() {
    canvas.addEventListener('mousedown',  onDown);
    canvas.addEventListener('mousemove',  onMove);
    canvas.addEventListener('mouseup',    onUp);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onDown(e.touches[0]); }, { passive: false });
    canvas.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e); },            { passive: false });
    canvas.addEventListener('touchend',   e => { e.preventDefault(); onUp();    },            { passive: false });
  }

  function teardownInput() {
    canvas.removeEventListener('mousedown',  onDown);
    canvas.removeEventListener('mousemove',  onMove);
    canvas.removeEventListener('mouseup',    onUp);
    canvas.removeEventListener('touchstart', onDown);
    canvas.removeEventListener('touchmove',  onMove);
    canvas.removeEventListener('touchend',   onUp);
  }

  // ── Game loop ─────────────────────────────────────────────────────────────────
  function resize() {
    if (!canvas) return;
    canvas.width  = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    setupTable();
  }

  function tick(ts) {
    const dt = Math.min((ts - lastTs) / 16.67, 3);
    lastTs = ts;
    if (toast.ttl > 0) toast.ttl--;

    if (phase === 'shooting') {
      // Multiple sub-steps per frame for stable collisions
      for (let i = 0; i < 3; i++) step();
      if (allStopped()) handleTurnEnd();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawTable();
    for (const b of balls) drawBall(b);
    drawAim();
    drawHUD();

    raf = requestAnimationFrame(tick);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.initBar = function (opts) {
    sid     = opts.sid;
    myRole  = opts.role;
    oppRole = myRole === 'host' ? 'guest' : 'host';

    canvas = document.getElementById('bar-canvas');
    if (!canvas) { console.warn('bar-canvas not found'); return; }
    ctx = canvas.getContext('2d');

    resize();
    window.addEventListener('resize', resize);

    rackBalls();
    setupInput();

    myTurn      = myRole === 'host';
    myGroup     = null;
    oppGroup    = null;
    gameOver    = false;
    winner      = null;
    phase       = myTurn ? 'aiming' : 'waiting';
    lastSyncTs  = 0;
    toast       = { msg: '', ttl: 0 };

    listenPool();
    lastTs = performance.now();
    raf = requestAnimationFrame(tick);
  };

  window.stopBar = function () {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    window.removeEventListener('resize', resize);
    teardownInput();
    window.db?.ref(`sessions/${sid}/pool`).off();
  };
})();

