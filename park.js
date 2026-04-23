(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────────
  const FW = 900, FH = 520;
  const BALL_R = 15;
  const CHAR_R = 20;
  const FRICTION = 0.986;
  const REST = 0.68;
  const MAX_DRAG = 120;
  const POWER = 0.24;
  const GOAL_H = 160;
  const GOAL_Y = (FH - GOAL_H) / 2;
  const WIN_SCORE = 5;
  const SYNC_MS = 100;

  // ── State ─────────────────────────────────────────────────────────────────────
  let canvas, ctx, raf;
  let sid, role, myProf, oppProf, mode;
  let mySide; // 'left' | 'right'
  let ball, chars, score, phase, phaseTimer, lastScorer;
  let drag = null;
  let lastSync = 0;

  function initState() {
    ball  = { x: FW / 2, y: FH / 2, vx: 0, vy: 0 };
    chars = {
      left:  { x: FW * 0.22, y: FH / 2, vx: 0, vy: 0 },
      right: { x: FW * 0.78, y: FH / 2, vx: 0, vy: 0 },
    };
    score       = { left: 0, right: 0 };
    phase       = 'countdown';
    phaseTimer  = 150;
    lastScorer  = null;
    drag        = null;
  }

  function resetAfterGoal() {
    ball  = { x: FW / 2, y: FH / 2, vx: 0, vy: 0 };
    chars.left  = { x: FW * 0.22, y: FH / 2, vx: 0, vy: 0 };
    chars.right = { x: FW * 0.78, y: FH / 2, vx: 0, vy: 0 };
    drag        = null;
    phase       = 'countdown';
    phaseTimer  = 90;
  }

  // ── Physics ───────────────────────────────────────────────────────────────────
  function step() {
    if (phase !== 'live') return;

    // Ball movement
    ball.x += ball.vx; ball.y += ball.vy;
    ball.vx *= FRICTION; ball.vy *= FRICTION;

    // Top / bottom walls
    if (ball.y - BALL_R < 0)  { ball.y = BALL_R;      ball.vy =  Math.abs(ball.vy) * REST; }
    if (ball.y + BALL_R > FH) { ball.y = FH - BALL_R; ball.vy = -Math.abs(ball.vy) * REST; }

    // Left wall / goal mouth
    if (ball.x - BALL_R < 0) {
      if (ball.y >= GOAL_Y && ball.y <= GOAL_Y + GOAL_H) {
        lastScorer = 'right'; score.right++; onGoal(); return;
      } else {
        ball.x = BALL_R; ball.vx = Math.abs(ball.vx) * REST;
      }
    }
    // Right wall / goal mouth
    if (ball.x + BALL_R > FW) {
      if (ball.y >= GOAL_Y && ball.y <= GOAL_Y + GOAL_H) {
        lastScorer = 'left'; score.left++; onGoal(); return;
      } else {
        ball.x = FW - BALL_R; ball.vx = -Math.abs(ball.vx) * REST;
      }
    }

    // Characters
    for (const side of ['left', 'right']) {
      const c = chars[side];
      c.x += c.vx; c.y += c.vy;
      c.vx *= FRICTION; c.vy *= FRICTION;
      if (c.x - CHAR_R < 0)  { c.x = CHAR_R;      c.vx =  Math.abs(c.vx) * REST; }
      if (c.x + CHAR_R > FW) { c.x = FW - CHAR_R; c.vx = -Math.abs(c.vx) * REST; }
      if (c.y - CHAR_R < 0)  { c.y = CHAR_R;      c.vy =  Math.abs(c.vy) * REST; }
      if (c.y + CHAR_R > FH) { c.y = FH - CHAR_R; c.vy = -Math.abs(c.vy) * REST; }
      collide(c, CHAR_R, 3, ball, BALL_R, 1);
    }

    // Host broadcasts ball + char positions to guest
    if (role === 'host' && mode !== 'solo') {
      const now = Date.now();
      if (now - lastSync > SYNC_MS) {
        lastSync = now;
        window.db?.ref(`sessions/${sid}/park/state`).set({
          bx: ball.x, by: ball.y, bvx: ball.vx, bvy: ball.vy,
          lx: chars.left.x,  ly: chars.left.y,
          rx: chars.right.x, ry: chars.right.y,
          t: now,
        });
      }
    }
  }

  function collide(a, ra, ma, b, rb, mb) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    const mn = ra + rb;
    if (d >= mn || d < 0.001) return;
    const nx = dx / d, ny = dy / d;
    const ov = mn - d, t = ma + mb;
    a.x -= nx * ov * mb / t; a.y -= ny * ov * mb / t;
    b.x += nx * ov * ma / t; b.y += ny * ov * ma / t;
    const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
    const dot = dvx * nx + dvy * ny;
    if (dot > 0) return;
    const j = 2 * dot / t;
    a.vx += j * mb * nx; a.vy += j * mb * ny;
    b.vx -= j * ma * nx; b.vy -= j * ma * ny;
    b.vx *= REST; b.vy *= REST;
  }

  function onGoal() {
    if (mode !== 'solo' && role === 'host') {
      window.db?.ref(`sessions/${sid}/park/score`).set(
        { left: score.left, right: score.right, scorer: lastScorer, t: Date.now() }
      );
    }
    if (score.left >= WIN_SCORE || score.right >= WIN_SCORE) {
      phase = 'over';
    } else {
      phase      = 'scored';
      phaseTimer = 150;
    }
  }

  // ── Firebase ──────────────────────────────────────────────────────────────────
  function listenFirebase() {
    if (!window.db || !sid || mode === 'solo') return;

    if (role === 'guest') {
      // Guest receives physics state from host
      window.db.ref(`sessions/${sid}/park/state`).on('value', snap => {
        const d = snap.val();
        if (!d || Date.now() - d.t > 2000) return;
        ball.x = d.bx; ball.y = d.by; ball.vx = d.bvx; ball.vy = d.bvy;
        chars.left.x  = d.lx; chars.left.y  = d.ly;
        chars.right.x = d.rx; chars.right.y = d.ry;
      });
      window.db.ref(`sessions/${sid}/park/score`).on('value', snap => {
        const d = snap.val();
        if (!d) return;
        score.left = d.left; score.right = d.right; lastScorer = d.scorer;
        if (score.left >= WIN_SCORE || score.right >= WIN_SCORE) {
          phase = 'over';
        } else if (phase === 'live') {
          phase = 'scored'; phaseTimer = 150;
        }
      });
    } else {
      // Host receives guest shots
      window.db.ref(`sessions/${sid}/park/shot`).on('value', snap => {
        const d = snap.val();
        if (!d || d.side !== 'right' || Date.now() - d.t > 3000) return;
        chars.right.vx = d.vx; chars.right.vy = d.vy;
        if (phase === 'countdown') phase = 'live';
      });
    }
  }

  function sendShot(vx, vy) {
    if (!window.db || !sid || mode === 'solo') return;
    window.db.ref(`sessions/${sid}/park/shot`).set({ side: mySide, vx, vy, t: Date.now() });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); }
    else {
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
    }
  }

  // ── Draw ──────────────────────────────────────────────────────────────────────
  function draw() {
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    const s  = Math.min(cw / FW, ch / FH);
    const ox = (cw - FW * s) / 2, oy = (ch - FH * s) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);

    drawField();
    drawGoals();
    drawBall();
    drawChar('left');
    drawChar('right');
    if (drag && (phase === 'live' || phase === 'countdown')) drawSlingshot();
    drawHUD();

    if (phase === 'countdown') drawCountdown();
    if (phase === 'scored')   drawScoredBanner();
    if (phase === 'over')     drawGameOver();

    ctx.restore();
  }

  function drawField() {
    // Alternating stripes
    for (let i = 0; i < FW; i += 80) {
      ctx.fillStyle = Math.floor(i / 80) % 2 === 0 ? '#2a8038' : '#318f42';
      ctx.fillRect(i, 0, 80, FH);
    }
    // Outer line
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, FW - 8, FH - 8);
    // Center line (dashed)
    ctx.setLineDash([14, 8]);
    ctx.beginPath(); ctx.moveTo(FW / 2, 4); ctx.lineTo(FW / 2, FH - 4); ctx.stroke();
    ctx.setLineDash([]);
    // Center circle
    ctx.beginPath(); ctx.arc(FW / 2, FH / 2, 75, 0, Math.PI * 2); ctx.stroke();
    // Center spot
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(FW / 2, FH / 2, 5, 0, Math.PI * 2); ctx.fill();
    // Penalty boxes
    const pbW = 130, pbH = 240, pbY = (FH - pbH) / 2;
    ctx.strokeRect(4, pbY, pbW, pbH);
    ctx.strokeRect(FW - 4 - pbW, pbY, pbW, pbH);
    // Goal boxes
    const gbW = 55, gbH = GOAL_H + 40, gbY = (FH - gbH) / 2;
    ctx.strokeRect(4, gbY, gbW, gbH);
    ctx.strokeRect(FW - 4 - gbW, gbY, gbW, gbH);
    // Penalty spots
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(100, FH / 2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(FW - 100, FH / 2, 4, 0, Math.PI * 2); ctx.fill();
    // Corner arcs
    const corners = [[4, 4], [FW - 4, 4], [4, FH - 4], [FW - 4, FH - 4]];
    const angles  = [0, Math.PI / 2, 3 * Math.PI / 2, Math.PI];
    corners.forEach(([cx, cy], i) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 22, angles[i], angles[i] + Math.PI / 2);
      ctx.stroke();
    });
  }

  function drawGoals() {
    const nd = 52; // net depth (pixels to draw behind goal line)

    // ── Left goal ──
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(-nd, GOAL_Y, nd, GOAL_H);
    // Crossbar & posts
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, GOAL_Y);        ctx.lineTo(-nd, GOAL_Y);        ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, GOAL_Y + GOAL_H); ctx.lineTo(-nd, GOAL_Y + GOAL_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-nd, GOAL_Y);      ctx.lineTo(-nd, GOAL_Y + GOAL_H); ctx.stroke();
    // Net
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1; ctx.lineCap = 'butt';
    for (let y = GOAL_Y + 20; y < GOAL_Y + GOAL_H; y += 20) {
      ctx.beginPath(); ctx.moveTo(-nd, y); ctx.lineTo(0, y); ctx.stroke();
    }
    for (let x = -nd; x <= 0; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, GOAL_Y); ctx.lineTo(x, GOAL_Y + GOAL_H); ctx.stroke();
    }

    // ── Right goal ──
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(FW, GOAL_Y, nd, GOAL_H);
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(FW, GOAL_Y);         ctx.lineTo(FW + nd, GOAL_Y);         ctx.stroke();
    ctx.beginPath(); ctx.moveTo(FW, GOAL_Y + GOAL_H); ctx.lineTo(FW + nd, GOAL_Y + GOAL_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(FW + nd, GOAL_Y);    ctx.lineTo(FW + nd, GOAL_Y + GOAL_H); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1; ctx.lineCap = 'butt';
    for (let y = GOAL_Y + 20; y < GOAL_Y + GOAL_H; y += 20) {
      ctx.beginPath(); ctx.moveTo(FW, y); ctx.lineTo(FW + nd, y); ctx.stroke();
    }
    for (let x = FW; x <= FW + nd; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, GOAL_Y); ctx.lineTo(x, GOAL_Y + GOAL_H); ctx.stroke();
    }

    // Goal mouth highlight on field boundary
    ctx.strokeStyle = 'rgba(255,215,0,0.55)';
    ctx.lineWidth = 4; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(0, GOAL_Y); ctx.lineTo(0, GOAL_Y + GOAL_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(FW, GOAL_Y); ctx.lineTo(FW, GOAL_Y + GOAL_H); ctx.stroke();
  }

  function drawBall() {
    const { x, y } = ball;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 7, BALL_R * 0.85, BALL_R * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // Main
    ctx.fillStyle = '#f5f5f5';
    ctx.beginPath(); ctx.arc(x, y, BALL_R, 0, Math.PI * 2); ctx.fill();
    // Black patches (pentagon-ish)
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(x, y, BALL_R * 0.28, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const a  = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * BALL_R * 0.57;
      const py = y + Math.sin(a) * BALL_R * 0.57;
      ctx.beginPath(); ctx.arc(px, py, BALL_R * 0.22, 0, Math.PI * 2); ctx.fill();
    }
    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.beginPath(); ctx.arc(x - 4, y - 5, 4, 0, Math.PI * 2); ctx.fill();
  }

  function drawChar(side) {
    const c      = chars[side];
    const isMe   = side === mySide;
    const color  = side === 'left' ? '#3a7fc8' : '#d46830';
    const num    = side === 'left' ? '1' : '2';
    const name   = (side === mySide ? myProf?.displayName : oppProf?.displayName)
                 || (side === 'left' ? 'P1' : 'P2');

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(c.x + 3, c.y + 7, CHAR_R, CHAR_R * 0.33, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(c.x, c.y, CHAR_R, 0, Math.PI * 2); ctx.fill();

    // Outline — gold when it's mine and I can drag
    const canDrag = isMe && (phase === 'live' || phase === 'countdown');
    ctx.strokeStyle = canDrag ? '#ffd700' : '#ffffff';
    ctx.lineWidth   = canDrag ? 3 : 2;
    ctx.stroke();

    // Shirt shine
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.arc(c.x - 6, c.y - 6, CHAR_R * 0.42, 0, Math.PI * 2); ctx.fill();

    // Jersey number
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${CHAR_R}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(num, c.x, c.y + 1);
    ctx.textBaseline = 'alphabetic';

    // Name tag
    ctx.font = 'bold 11px monospace';
    const tw = ctx.measureText(name).width;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(c.x - tw / 2 - 4, c.y - CHAR_R - 23, tw + 8, 16);
    ctx.fillStyle = isMe ? '#a8d8ff' : '#ffcda0';
    ctx.fillText(name, c.x, c.y - CHAR_R - 10);
  }

  function drawSlingshot() {
    if (!drag || !mySide) return;
    const c  = chars[mySide];
    let dx   = drag.cx - c.x, dy = drag.cy - c.y;
    const ln = Math.sqrt(dx * dx + dy * dy);
    if (ln > MAX_DRAG) { dx = dx / ln * MAX_DRAG; dy = dy / ln * MAX_DRAG; }
    const ex = c.x + dx, ey = c.y + dy;

    // Rubber bands
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth   = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(c.x - 10, c.y - 8); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c.x + 10, c.y - 8); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);

    // Power arc around char
    const pct        = Math.min(ln / MAX_DRAG, 1);
    const powerColor = `hsl(${120 - pct * 120}, 100%, 55%)`;
    ctx.strokeStyle  = powerColor;
    ctx.lineWidth    = 3;
    ctx.beginPath();
    ctx.arc(c.x, c.y, CHAR_R + 7, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();

    // Trajectory preview dots
    const svx = -dx * POWER, svy = -dy * POWER;
    let tx = c.x, ty = c.y, tvx = svx, tvy = svy;
    ctx.fillStyle = 'rgba(255,215,0,0.55)';
    for (let i = 0; i < 30; i++) {
      tx += tvx * 1.4; ty += tvy * 1.4;
      tvx *= 0.965; tvy *= 0.965;
      const r = Math.max(0.4, 3.5 - i * 0.11);
      ctx.globalAlpha = 1 - i / 30;
      ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawHUD() {
    // Scoreboard pill
    const sw = 174, sh = 54, sx = FW / 2 - sw / 2, sy = 8;
    ctx.fillStyle = 'rgba(0,0,20,0.72)';
    rr(ctx, sx, sy, sw, sh, 12); ctx.fill();

    // Scores
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5b9bd5'; ctx.fillText(score.left,  FW / 2 - 40, sy + 40);
    ctx.fillStyle = '#555';    ctx.fillText('—',         FW / 2,      sy + 40);
    ctx.fillStyle = '#e07b54'; ctx.fillText(score.right, FW / 2 + 40, sy + 40);

    // Names
    const ln = (mySide === 'left'  ? myProf?.displayName : oppProf?.displayName) || 'P1';
    const rn = (mySide === 'right' ? myProf?.displayName : oppProf?.displayName) || 'P2';
    ctx.font = '9px monospace';
    ctx.fillStyle = '#5b9bd5'; ctx.fillText(ln.slice(0, 8), FW / 2 - 40, sy + 17);
    ctx.fillStyle = '#e07b54'; ctx.fillText(rn.slice(0, 8), FW / 2 + 40, sy + 17);

    // "First to N" label
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.fillText(`First to ${WIN_SCORE}`, FW / 2, sy + sh + 13);

    // Instruction at bottom
    if ((phase === 'live' || phase === 'countdown') && !drag) {
      ctx.font = '12px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('Drag your player to aim, release to shoot!', FW / 2, FH - 12);
    }
  }

  function drawCountdown() {
    ctx.fillStyle = 'rgba(0,0,0,0.46)';
    ctx.fillRect(0, 0, FW, FH);
    const secs = Math.ceil(phaseTimer / 60);
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px monospace';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('Get Ready!', FW / 2, FH / 2 - 14);
    ctx.font = 'bold 70px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(secs > 0 ? secs : 'GO!', FW / 2, FH / 2 + 65);
  }

  function drawScoredBanner() {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, FW, FH);
    const iScored = lastScorer === mySide;
    ctx.textAlign = 'center';
    ctx.font = 'bold 54px monospace';
    ctx.fillStyle = iScored ? '#ffd700' : '#ff6060';
    ctx.fillText('⚽ GOAL!', FW / 2, FH / 2 - 10);
    ctx.font = '22px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(iScored ? 'You scored!' : 'They scored!', FW / 2, FH / 2 + 36);
    ctx.font = '16px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`${score.left} — ${score.right}`, FW / 2, FH / 2 + 68);
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, FW, FH);

    const iWon = score[mySide] >= WIN_SCORE;
    ctx.textAlign = 'center';
    ctx.font = 'bold 52px monospace';
    ctx.fillStyle = iWon ? '#ffd700' : '#ff6060';
    ctx.fillText(iWon ? '🏆 You Win!' : '😅 They Win!', FW / 2, FH / 2 - 48);

    const ln = (mySide === 'left'  ? myProf?.displayName : oppProf?.displayName) || 'P1';
    const rn = (mySide === 'right' ? myProf?.displayName : oppProf?.displayName) || 'P2';
    ctx.font = '20px monospace';
    ctx.fillStyle = '#ccc';
    ctx.fillText(`${ln}  ${score.left} — ${score.right}  ${rn}`, FW / 2, FH / 2 + 10);

    // Back to Map
    ctx.fillStyle = '#1e3a6a';
    rr(ctx, FW / 2 - 95, FH / 2 + 44, 190, 46, 10); ctx.fill();
    ctx.font = 'bold 16px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText('← Back to Map', FW / 2, FH / 2 + 73);

    // Play Again
    ctx.fillStyle = '#1a5a28';
    rr(ctx, FW / 2 - 85, FH / 2 + 108, 170, 46, 10); ctx.fill();
    ctx.font = 'bold 16px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText('⚽ Play Again', FW / 2, FH / 2 + 137);
  }

  // ── Input ─────────────────────────────────────────────────────────────────────
  function logical(e) {
    const r   = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    const cx  = (src.clientX - r.left)  * (canvas.width  / r.width);
    const cy  = (src.clientY - r.top)   * (canvas.height / r.height);
    const s   = Math.min(canvas.width / FW, canvas.height / FH);
    const ox  = (canvas.width  - FW * s) / 2;
    const oy  = (canvas.height - FH * s) / 2;
    return [(cx - ox) / s, (cy - oy) / s];
  }

  function onDown(e) {
    e.preventDefault();
    const [lx, ly] = logical(e);

    if (phase === 'over') {
      // Back to Map button area
      if (lx > FW / 2 - 95 && lx < FW / 2 + 95 && ly > FH / 2 + 44 && ly < FH / 2 + 90) {
        window.returnToMap?.(); return;
      }
      // Play Again button area
      if (lx > FW / 2 - 85 && lx < FW / 2 + 85 && ly > FH / 2 + 108 && ly < FH / 2 + 154) {
        initState(); return;
      }
      return;
    }

    if (!mySide || (phase !== 'live' && phase !== 'countdown')) return;
    const c  = chars[mySide];
    const dx = lx - c.x, dy = ly - c.y;
    if (Math.sqrt(dx * dx + dy * dy) < CHAR_R * 2.8) {
      drag = { cx: lx, cy: ly };
    }
  }

  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    const [lx, ly] = logical(e);
    drag.cx = lx; drag.cy = ly;
  }

  function onUp(e) {
    if (!drag || !mySide) return;
    e.preventDefault();
    const c  = chars[mySide];
    let dx   = drag.cx - c.x, dy = drag.cy - c.y;
    const ln = Math.sqrt(dx * dx + dy * dy);
    if (ln < 8) { drag = null; return; } // too small — ignore tap
    if (ln > MAX_DRAG) { dx = dx / ln * MAX_DRAG; dy = dy / ln * MAX_DRAG; }

    const vx = -dx * POWER;
    const vy = -dy * POWER;
    chars[mySide].vx = vx;
    chars[mySide].vy = vy;
    drag = null;

    if (phase === 'countdown') phase = 'live';
    sendShot(vx, vy);
  }

  function resize() {
    if (!canvas) return;
    canvas.width  = canvas.clientWidth  || window.innerWidth;
    canvas.height = canvas.clientHeight || window.innerHeight;
  }

  // ── Game loop ─────────────────────────────────────────────────────────────────
  function tick() {
    if (phase === 'countdown') {
      phaseTimer--;
      if (phaseTimer <= 0) phase = 'live';
    } else if (phase === 'scored') {
      phaseTimer--;
      if (phaseTimer <= 0) resetAfterGoal();
    }
    step();
    draw();
    raf = requestAnimationFrame(tick);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.initPark = function (opts) {
    sid    = opts.sid;    role    = opts.role;
    myProf = opts.myProf; oppProf = opts.oppProf;
    mode   = opts.mode || 'solo';
    mySide = (mode === 'solo' || role === 'host') ? 'left' : 'right';

    canvas = document.getElementById('park-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    initState();

    canvas.addEventListener('mousedown',  onDown, { passive: false });
    canvas.addEventListener('mousemove',  onMove, { passive: false });
    canvas.addEventListener('mouseup',    onUp,   { passive: false });
    canvas.addEventListener('touchstart', onDown, { passive: false });
    canvas.addEventListener('touchmove',  onMove, { passive: false });
    canvas.addEventListener('touchend',   onUp,   { passive: false });

    listenFirebase();
    raf = requestAnimationFrame(tick);
  };

  window.stopPark = function () {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    window.removeEventListener('resize', resize);
    if (canvas) {
      canvas.removeEventListener('mousedown',  onDown);
      canvas.removeEventListener('mousemove',  onMove);
      canvas.removeEventListener('mouseup',    onUp);
      canvas.removeEventListener('touchstart', onDown);
      canvas.removeEventListener('touchmove',  onMove);
      canvas.removeEventListener('touchend',   onUp);
      canvas = null;
    }
    if (window.db && sid && mode !== 'solo') {
      window.db.ref(`sessions/${sid}/park`).off();
    }
    sid = null;
  };
})();
