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
    { id:'diner',   name:'Diner',   icon:'🤼', x:1195, y:715, w:195, h:135, body:'#c06820', roof:'#8b4a14', door:'#6a3510', accent:'#ffa040' },
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

  // ── Draw ─────────────────────────────────────────────────────────────────────
  function drawGrass() {
    ctx.fillStyle = '#4a7a55';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#3d6b48';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 32) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += 32) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  function drawRoads() {
    ROADS.forEach(r => {
      // Asphalt
      ctx.fillStyle = '#5a5a4a';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      // Edge markings
      ctx.strokeStyle = '#777766';
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      if (r.w > r.h) {
        ctx.beginPath(); ctx.moveTo(r.x, r.y+3); ctx.lineTo(r.x+r.w, r.y+3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r.x, r.y+r.h-3); ctx.lineTo(r.x+r.w, r.y+r.h-3); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(r.x+3, r.y); ctx.lineTo(r.x+3, r.y+r.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r.x+r.w-3, r.y); ctx.lineTo(r.x+r.w-3, r.y+r.h); ctx.stroke();
      }
      // Center dash
      ctx.strokeStyle = '#f5e070';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([28, 20]);
      if (r.w > r.h) {
        ctx.beginPath(); ctx.moveTo(r.x, r.y+r.h/2); ctx.lineTo(r.x+r.w, r.y+r.h/2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(r.x+r.w/2, r.y); ctx.lineTo(r.x+r.w/2, r.y+r.h); ctx.stroke();
      }
      ctx.setLineDash([]);
    });
  }

  function drawTrees() {
    TREES.forEach(t => {
      ctx.fillStyle = '#3a2008';
      ctx.fillRect(t.x - 5, t.y + 4, 10, 15);
      ctx.fillStyle = '#246024';
      ctx.beginPath(); ctx.arc(t.x, t.y, 19, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#347834';
      ctx.beginPath(); ctx.arc(t.x - 4, t.y - 7, 13, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#469046';
      ctx.beginPath(); ctx.arc(t.x + 2, t.y - 12, 9, 0, Math.PI*2); ctx.fill();
    });
  }

  function drawBuildings() {
    BUILDINGS.forEach(b => {
      const glow = near?.id === b.id;

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(b.x + 9, b.y + 9, b.w, b.h);

      // Body
      ctx.fillStyle = b.body;
      ctx.fillRect(b.x, b.y, b.w, b.h);

      // Roof stripe
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x, b.y, b.w, 20);

      // Roof highlight
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(b.x, b.y, b.w, 4);

      // Windows
      const ww = 20, wh = 14, wgx = 10, wgy = 8;
      for (let wx = b.x + 15; wx < b.x + b.w - ww - 4; wx += ww + wgx) {
        for (let wy = b.y + 28; wy < b.y + b.h - 18; wy += wh + wgy) {
          ctx.fillStyle = 'rgba(255,230,100,0.5)';
          ctx.fillRect(wx, wy, ww, wh);
          ctx.strokeStyle = 'rgba(200,155,55,0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(wx + ww/2, wy); ctx.lineTo(wx + ww/2, wy + wh);
          ctx.moveTo(wx, wy + wh/2); ctx.lineTo(wx + ww, wy + wh/2);
          ctx.stroke();
        }
      }

      // Door
      const dw = 28, dh = 38;
      const dx = b.x + b.w/2 - dw/2, dy = b.y + b.h - dh;
      ctx.fillStyle = glow ? '#ffd700' : b.door;
      ctx.fillRect(dx, dy, dw, dh);
      // Door frame
      ctx.strokeStyle = glow ? '#fff8a0' : b.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(dx, dy, dw, dh);
      // Knob
      ctx.fillStyle = glow ? '#fff' : b.accent;
      ctx.beginPath(); ctx.arc(dx + dw - 7, dy + dh/2 + 3, 3, 0, Math.PI*2); ctx.fill();

      // Glow border when near
      if (glow) {
        ctx.save();
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 30;
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.restore();
      }

      // Label above building
      ctx.save();
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      const label = `${b.icon} ${b.name}`;
      ctx.strokeStyle = 'rgba(0,0,0,0.95)';
      ctx.lineWidth = 4;
      ctx.strokeText(label, b.x + b.w/2, b.y - 10);
      ctx.fillStyle = glow ? '#ffd700' : '#ffffff';
      ctx.fillText(label, b.x + b.w/2, b.y - 10);
      ctx.restore();
    });
  }

  function drawPlayer(pos, color, name, isMe) {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(pos.x + 3, pos.y + 6, PRAD, PRAD * 0.38, 0, 0, Math.PI*2);
    ctx.fill();
    // Body
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, PRAD, 0, Math.PI*2); ctx.fill();
    // Ring
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = isMe ? 2.5 : 1.8;
    ctx.stroke();
    // Inner shine
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.arc(pos.x - 5, pos.y - 5, 7, 0, Math.PI*2); ctx.fill();
    // Name tag
    ctx.save();
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(name).width;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(pos.x - tw/2 - 5, pos.y - PRAD - 25, tw + 10, 17);
    ctx.fillStyle = isMe ? '#a8d8ff' : '#ffcda0';
    ctx.fillText(name, pos.x, pos.y - PRAD - 11);
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

    if (dx && dy) { dx *= 0.707; dy *= 0.707; }
    const spd = SPEED * dt;
    const nx = clamp(myPos.x + dx * spd, PRAD, W - PRAD);
    const ny = clamp(myPos.y + dy * spd, PRAD, H - PRAD);
    if (!collides(nx, myPos.y)) myPos.x = nx;
    if (!collides(myPos.x, ny)) myPos.y = ny;
    if (dx || dy || joy.on) syncPos();

    if (oppPos && oppSmooth) {
      oppSmooth.x = lerp(oppSmooth.x, oppPos.x, LERP);
      oppSmooth.y = lerp(oppSmooth.y, oppPos.y, LERP);
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
      drawPlayer(oppSmooth, '#e07b54', oppProf?.displayName || 'Partner', false);
    }
    drawPlayer(myPos, '#5b9bd5', myProf?.displayName || 'You', true);
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

  function goPark(mode) {
    stopMap();
    document.getElementById('map-view')?.classList.add('hidden');
    document.getElementById('park-view')?.classList.remove('hidden');
    const tryInit = () => {
      if (typeof window.initPark !== 'function') { setTimeout(tryInit, 80); return; }
      window.initPark({ sid, role, myProf, oppProf, mode: mode || 'solo' });
    };
    tryInit();
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
      // Open game picker for the nudged building so user can pick a game
      const bld = BUILDINGS.find(b => b.id === buildingId);
      if (bld) showGamePicker(bld);
    };
    joinBtn.addEventListener('click', onJoin);
    dismissBtn.addEventListener('click', dismiss);

    // Auto-dismiss after 20s
    clearTimeout(banner._t);
    banner._t = setTimeout(dismiss, 20000);
  }

  // ── Building games config ─────────────────────────────────────────────────────
  const BUILDING_GAMES = {
    library: [
      { id: 'chess',     label: 'Chess',     icon: '♟️',  ready: true  },
      { id: 'connect4',  label: 'Connect 4', icon: '🔴',  ready: false },
      { id: 'mancala',   label: 'Mancala',   icon: '🟤',  ready: false },
    ],
    bar: [
      { id: 'pool',  label: 'Pool',  icon: '🎱', ready: true  },
      { id: 'darts', label: 'Darts', icon: '🎯', ready: false },
    ],
    casino: [
      { id: 'blackjack', label: 'Blackjack', icon: '🃏', ready: true  },
      { id: 'poker',     label: 'Poker',     icon: '♠️',  ready: false },
    ],
    park: [
      { id: 'soccer', label: 'Slingshot Soccer', icon: '⚽', ready: true  },
    ],
    diner: [
      { id: 'wrestling', label: 'Wrestling', icon: '🤼', ready: false },
    ],
  };

  // ── Mode select modal ─────────────────────────────────────────────────────────
  function enterBuilding(b) {
    const hasGames = BUILDING_GAMES[b.id];
    if (hasGames) {
      showGamePicker(b);
      return;
    }
    showComingSoon(b.name);
  }

  function showGamePicker(b) {
    const modal      = document.getElementById('mode-select');
    const gamePicker = document.getElementById('game-picker');
    const modePicker = document.getElementById('mode-picker');
    const icon       = document.getElementById('mode-select-icon');
    const title      = document.getElementById('mode-select-title');
    const gameList   = document.getElementById('game-list');
    const cancelBtn  = document.getElementById('game-cancel-btn');
    if (!modal || !gamePicker || !gameList) return;

    icon.textContent  = b.icon;
    title.textContent = b.name;

    // Populate game buttons
    gameList.innerHTML = '';
    const games = BUILDING_GAMES[b.id] || [];
    games.forEach(game => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        padding:14px 24px; border-radius:10px; border:none; font-size:16px;
        font-weight:bold; cursor:${game.ready ? 'pointer' : 'default'};
        background:${game.ready ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'};
        color:${game.ready ? '#ffffff' : '#888888'};
        transition:background 0.2s;
      `;
      btn.textContent = `${game.icon} ${game.label}${game.ready ? '' : '  (coming soon)'}`;
      if (game.ready) {
        btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,215,0,0.25)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(255,255,255,0.15)');
        btn.addEventListener('click', () => showModePicker(b, game));
      }
      gameList.appendChild(btn);
    });

    // Show game picker, hide mode picker
    gamePicker.classList.remove('hidden');
    modePicker.classList.add('hidden');
    modal.classList.remove('hidden');

    cancelBtn.onclick = () => modal.classList.add('hidden');
  }

  function showModePicker(b, game) {
    const gamePicker  = document.getElementById('game-picker');
    const modePicker  = document.getElementById('mode-picker');
    const gameIcon    = document.getElementById('mode-game-icon');
    const gameTitle   = document.getElementById('mode-game-title');
    const status      = document.getElementById('partner-status');
    const soloBtn     = document.getElementById('mode-solo-btn');
    const partnerBtn  = document.getElementById('mode-partner-btn');
    const nudgeBtn    = document.getElementById('mode-nudge-btn');
    const cancelBtn   = document.getElementById('mode-cancel-btn');
    const backBtn     = document.getElementById('mode-back-btn');
    if (!modePicker) return;

    gameIcon.textContent  = game.icon;
    gameTitle.textContent = game.label;

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

    gamePicker.classList.add('hidden');
    modePicker.classList.remove('hidden');

    const modal = document.getElementById('mode-select');
    const cleanup = () => {
      modal?.classList.add('hidden');
      soloBtn.onclick = null;
      partnerBtn.onclick = null;
      nudgeBtn.onclick = null;
      cancelBtn.onclick = null;
      backBtn.onclick = null;
    };

    backBtn.onclick   = () => { modePicker.classList.add('hidden'); gamePicker.classList.remove('hidden'); };
    soloBtn.onclick   = () => { cleanup(); launchGame(game.id, b.id, 'solo'); };
    partnerBtn.onclick = () => { if (partnerOnline) { cleanup(); launchGame(game.id, b.id, 'multi'); } };
    nudgeBtn.onclick  = () => { sendNudge(b.id); };
    cancelBtn.onclick = cleanup;
  }

  function launchGame(gameId, buildingId, mode) {
    if (gameId === 'chess') {
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
    if (gameId === 'pool')      { goBar(mode);    return; }
    if (gameId === 'blackjack') { goCasino(mode); return; }
    if (gameId === 'soccer')    { goPark(mode);   return; }
    showComingSoon(`${gameId.charAt(0).toUpperCase() + gameId.slice(1)}`);
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
    keys = {};
    if (sid) {
      const oppRole = role === 'host' ? 'guest' : 'host';
      window.db?.ref(`sessions/${sid}/players/${oppRole}`).off();
      window.db?.ref(`sessions/${sid}/profiles/${oppRole}`).off();
      window.db?.ref(`sessions/${sid}`).off();
    }
  }

  window.initMap = function (opts) {
    sid = opts.sid; role = opts.role;
    myProf = opts.myProf; oppProf = opts.oppProf || null;
    inChessAlready = false;
    keys = {}; joy = {on:false, dx:0, dy:0};
    oppPos = null; oppSmooth = null;

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
    window.stopPark?.();
    // Hide all game views, show map
    document.getElementById('game-main')?.classList.add('hidden');
    document.getElementById('bar-view')?.classList.add('hidden');
    document.getElementById('casino-view')?.classList.add('hidden');
    document.getElementById('park-view')?.classList.add('hidden');
    document.getElementById('map-view')?.classList.remove('hidden');
    // Wait one frame so the canvas has real dimensions before initMap
    requestAnimationFrame(() => {
      window.initMap({ sid, role, myProf, oppProf });
    });
  };
})();

