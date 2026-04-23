(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────────
  const CARD_W = 72, CARD_H = 100;
  const SUITS = ['♠','♥','♦','♣'];
  const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const RED_SUITS = new Set(['♥','♦']);

  // ── State ─────────────────────────────────────────────────────────────────────
  let canvas, ctx;
  let sid, myRole, oppRole;
  let myProf, oppProf;
  let raf = null;
  let dbRef = null;

  // Game state (mirrored from Firebase for non-host)
  let deck        = [];
  let dealerHand  = [];
  let hands       = { host: [], guest: [] };  // each card: {rank, suit, faceUp}
  let stood       = { host: false, guest: false };
  let results     = null;  // null | { host: 'win'|'lose'|'push', guest: ... }
  let phase       = 'waiting'; // waiting | dealing | player-host | player-guest | dealer | result
  let scores      = { host: 0, guest: 0 };
  let toast       = '';
  let toastTimer  = 0;
  let roundActive = false;

  // ── Card helpers ──────────────────────────────────────────────────────────────
  function cardValue(rank) {
    if (rank === 'A') return 11;
    if (['J','Q','K'].includes(rank)) return 10;
    return parseInt(rank, 10);
  }

  function handTotal(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
      if (!c.faceUp) continue;
      total += cardValue(c.rank);
      if (c.rank === 'A') aces++;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  }

  function handTotalAll(cards) {
    // total ignoring faceUp flag (for final dealer reveal)
    let total = 0, aces = 0;
    for (const c of cards) {
      total += cardValue(c.rank);
      if (c.rank === 'A') aces++;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  }

  function makeDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s, faceUp: true });
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function popCard(faceUp = true) {
    const c = deck.pop();
    if (c) c.faceUp = faceUp;
    return c;
  }

  // ── Firebase ──────────────────────────────────────────────────────────────────
  function pushState(state) {
    if (!window.db || !sid) return;
    window.db.ref(`sessions/${sid}/casino`).set(state);
  }

  function buildState() {
    return { deck, dealerHand, hands, stood, results, phase, scores, t: Date.now() };
  }

  function applyState(d) {
    deck       = d.deck       || [];
    dealerHand = d.dealerHand || [];
    hands      = d.hands      || { host: [], guest: [] };
    stood      = d.stood      || { host: false, guest: false };
    results    = d.results    || null;
    phase      = d.phase      || 'waiting';
    scores     = d.scores     || { host: 0, guest: 0 };
  }

  function listenCasino() {
    if (!window.db || !sid) return;
    dbRef = window.db.ref(`sessions/${sid}/casino`);
    dbRef.on('value', snap => {
      const d = snap.val();
      if (!d) return;
      if (myRole !== 'host') applyState(d);
    });
  }

  // ── Game logic ────────────────────────────────────────────────────────────────
  function startRound() {
    if (myRole !== 'host') return;
    deck = makeDeck();
    hands = { host: [], guest: [] };
    dealerHand = [];
    stood = { host: false, guest: false };
    results = null;

    // Deal: player host, player guest, dealer, player host, player guest, dealer(hidden)
    hands.host.push(popCard());
    hands.guest.push(popCard());
    dealerHand.push(popCard());
    hands.host.push(popCard());
    hands.guest.push(popCard());
    dealerHand.push(popCard(false)); // dealer second card face down

    phase = 'player-host';
    roundActive = true;
    pushState(buildState());
    showToast('Round started — Host goes first');
  }

  function hit() {
    if (myRole !== 'host' && phase !== `player-${myRole}`) return;
    if (phase !== `player-${myRole}`) return;
    hands[myRole].push(popCard());
    const total = handTotal(hands[myRole]);
    if (total > 21) {
      stood[myRole] = true;
      advanceTurn();
    } else {
      pushState(buildState());
    }
  }

  function stand() {
    if (phase !== `player-${myRole}`) return;
    stood[myRole] = true;
    advanceTurn();
  }

  function advanceTurn() {
    if (myRole !== 'host') return;
    if (phase === 'player-host') {
      phase = 'player-guest';
      pushState(buildState());
      showToast('Guest\'s turn');
    } else if (phase === 'player-guest') {
      runDealer();
    }
  }

  function runDealer() {
    if (myRole !== 'host') return;
    // Reveal dealer hidden card
    dealerHand.forEach(c => c.faceUp = true);
    phase = 'dealer';

    // Dealer hits until 17+
    while (handTotalAll(dealerHand) < 17) {
      dealerHand.push(popCard());
    }

    const dealerTotal = handTotalAll(dealerHand);
    results = {};
    for (const role of ['host', 'guest']) {
      const pTotal = handTotalAll(hands[role]);
      const busted = pTotal > 21;
      if (busted) {
        results[role] = 'lose';
      } else if (dealerTotal > 21 || pTotal > dealerTotal) {
        results[role] = 'win';
        scores[role] = (scores[role] || 0) + 1;
      } else if (pTotal === dealerTotal) {
        results[role] = 'push';
      } else {
        results[role] = 'lose';
      }
    }

    phase = 'result';
    roundActive = false;
    pushState(buildState());
  }

  function guestAction(action) {
    // Guest sends action to host via Firebase
    if (!window.db || !sid) return;
    window.db.ref(`sessions/${sid}/casino_action`).set({ role: myRole, action, t: Date.now() });
  }

  function listenGuestActions() {
    if (!window.db || !sid || myRole !== 'host') return;
    window.db.ref(`sessions/${sid}/casino_action`).on('value', snap => {
      const d = snap.val();
      if (!d || d.role !== 'guest') return;
      if (Date.now() - d.t > 5000) return; // ignore old actions
      if (phase !== 'player-guest') return;
      if (d.action === 'hit') {
        hands.guest.push(popCard());
        const total = handTotal(hands.guest);
        if (total > 21) { stood.guest = true; runDealer(); }
        else pushState(buildState());
      } else if (d.action === 'stand') {
        stood.guest = true;
        runDealer();
      }
      // Clear action
      window.db.ref(`sessions/${sid}/casino_action`).remove();
    });
  }

  function showToast(msg, dur = 2200) {
    toast = msg; toastTimer = dur;
  }

  // ── Draw ──────────────────────────────────────────────────────────────────────
  function drawCard(x, y, card, faceUp) {
    const r = 6;
    ctx.save();

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.roundRect(x+3, y+3, CARD_W, CARD_H, r);
    ctx.fill();

    if (!faceUp) {
      // Card back
      const bg = ctx.createLinearGradient(x, y, x+CARD_W, y+CARD_H);
      bg.addColorStop(0, '#1a3a7a');
      bg.addColorStop(1, '#0d2050');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(x, y, CARD_W, CARD_H, r); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5;
      ctx.stroke();
      // Pattern
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
      for (let i = 0; i < CARD_W; i += 8) {
        ctx.beginPath(); ctx.moveTo(x+i, y); ctx.lineTo(x, y+i); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x+i, y+CARD_H); ctx.lineTo(x+CARD_W, y+CARD_H-i); ctx.stroke();
      }
      ctx.restore(); return;
    }

    // Card face
    ctx.fillStyle = '#fafaf8';
    ctx.beginPath(); ctx.roundRect(x, y, CARD_W, CARD_H, r); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
    ctx.stroke();

    const isRed = RED_SUITS.has(card.suit);
    const color = isRed ? '#cc2020' : '#111';

    // Rank + suit top-left
    ctx.fillStyle = color;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(card.rank, x+5, y+16);
    ctx.font = '13px serif';
    ctx.fillText(card.suit, x+5, y+30);

    // Center suit
    ctx.font = '28px serif';
    ctx.textAlign = 'center';
    ctx.fillText(card.suit, x + CARD_W/2, y + CARD_H/2 + 10);

    // Rank + suit bottom-right (rotated)
    ctx.save();
    ctx.translate(x + CARD_W - 4, y + CARD_H - 4);
    ctx.rotate(Math.PI);
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.fillText(card.rank, 0, 12);
    ctx.font = '13px serif';
    ctx.fillText(card.suit, 0, 26);
    ctx.restore();

    ctx.restore();
  }

  function drawHand(cards, cx, cy, label, isMe, showTotal) {
    const spacing = Math.min(CARD_W + 10, (canvas.width * 0.4) / Math.max(cards.length, 1));
    const totalW = (cards.length - 1) * spacing + CARD_W;
    let x = cx - totalW / 2;

    for (const card of cards) {
      drawCard(x, cy, card, card.faceUp !== false);
      x += spacing;
    }

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy - 12);

    // Total
    if (showTotal && cards.some(c => c.faceUp !== false)) {
      const total = handTotal(cards);
      const bust  = total > 21;
      ctx.fillStyle = bust ? '#ff6060' : '#a0ffa0';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(bust ? `${total} BUST` : total, cx, cy + CARD_H + 22);
    }
  }

  function drawTable(cw, ch) {
    // Room background
    ctx.fillStyle = '#1a0a05';
    ctx.fillRect(0, 0, cw, ch);

    // Felt table
    const tw = Math.min(cw - 40, 900), th = ch - 60;
    const tx = (cw - tw) / 2, ty = 30;
    const feltGrad = ctx.createRadialGradient(cw/2, ch/2, 0, cw/2, ch/2, Math.max(tw,th)*0.7);
    feltGrad.addColorStop(0, '#1a6b35');
    feltGrad.addColorStop(1, '#0d4020');
    ctx.fillStyle = feltGrad;
    ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 24); ctx.fill();
    ctx.strokeStyle = '#c8a040'; ctx.lineWidth = 3;
    ctx.stroke();

    // Inner border
    ctx.strokeStyle = 'rgba(200,160,64,0.3)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(tx+10, ty+10, tw-20, th-20, 18); ctx.stroke();

    // Center divider line
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.setLineDash([8,8]);
    ctx.beginPath(); ctx.moveTo(tx+20, ch/2); ctx.lineTo(tx+tw-20, ch/2); ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawScores(cw) {
    const hostName  = myRole === 'host'  ? (myProf?.displayName  || 'Host')  : (oppProf?.displayName || 'Host');
    const guestName = myRole === 'guest' ? (myProf?.displayName  || 'Guest') : (oppProf?.displayName || 'Guest');

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.roundRect(cw/2 - 110, 8, 220, 32, 8); ctx.fill();
    ctx.fillStyle = '#f5e070';
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${hostName}: ${scores.host}   |   ${guestName}: ${scores.guest}`, cw/2, 28);
  }

  function drawButtons(cw, ch) {
    const isMyTurn = (phase === `player-${myRole}`);
    const canAct   = isMyTurn && !stood[myRole];

    if (phase === 'waiting' || phase === 'result') {
      const isHost = myRole === 'host';
      const btnW = 180, btnH = 44;
      const bx = cw/2 - btnW/2, by = ch/2 - btnH/2;
      const alpha = isHost ? 1 : 0.4;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#c8a040';
      ctx.beginPath(); ctx.roundRect(bx, by, btnW, btnH, 10); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1a0a05';
      ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(phase === 'result' ? 'Play Again' : 'Deal Cards', cw/2, by + 28);
      if (!isHost) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '12px sans-serif';
        ctx.fillText('Waiting for host to deal…', cw/2, by + btnH + 18);
      }
      return;
    }

    if (canAct) {
      const btnH = 44, gap = 16;
      const btnW = 120;
      const totalW = btnW*2 + gap;
      const bx = cw/2 - totalW/2, by = ch - 65;

      // Hit
      ctx.fillStyle = '#2a6ad4';
      ctx.beginPath(); ctx.roundRect(bx, by, btnW, btnH, 10); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Hit', bx + btnW/2, by + 28);

      // Stand
      ctx.fillStyle = '#b03030';
      ctx.beginPath(); ctx.roundRect(bx + btnW + gap, by, btnW, btnH, 10); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText('Stand', bx + btnW + gap + btnW/2, by + 28);
    } else if (phase.startsWith('player-') && phase !== `player-${myRole}`) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      const waitName = phase === 'player-host'
        ? (myRole === 'host' ? 'Your turn' : (oppProf?.displayName || 'Host') + '\'s turn')
        : (myRole === 'guest' ? 'Your turn' : (oppProf?.displayName || 'Guest') + '\'s turn');
      ctx.fillText(waitName, cw/2, ch - 44);
    }
  }

  function drawToast(cw, ch) {
    if (!toast || toastTimer <= 0) return;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath(); ctx.roundRect(cw/2 - 160, ch/2 - 22, 320, 40, 10); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(toast, cw/2, ch/2 + 4);
  }

  function drawResult(cw, ch) {
    if (phase !== 'result' || !results) return;
    const myResult  = results[myRole];
    const color = myResult === 'win' ? '#50ff80' : myResult === 'push' ? '#ffd060' : '#ff6060';
    const label = myResult === 'win' ? 'You Win! 🏆' : myResult === 'push' ? 'Push — Tie!' : 'You Lose';
    ctx.fillStyle = color;
    ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, cw/2, ch/2 + 4);
  }

  // ── Tick ──────────────────────────────────────────────────────────────────────
  function resize() {
    canvas.width  = canvas.offsetWidth  || window.innerWidth;
    canvas.height = canvas.offsetHeight || window.innerHeight;
  }

  function tick() {
    resize();
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    drawTable(cw, ch);
    drawScores(cw);

    const dealerCX = cw / 2;
    const dealerCY = 70;
    const hostCY   = ch - 200;
    const guestCY  = hostCY;
    const hostCX   = cw * 0.27;
    const guestCX  = cw * 0.73;

    const hostName  = myRole === 'host'  ? (myProf?.displayName  || 'You')     : (oppProf?.displayName || 'Host');
    const guestName = myRole === 'guest' ? (myProf?.displayName  || 'You')     : (oppProf?.displayName || 'Guest');

    // Dealer hand
    if (dealerHand.length) {
      const dTotal = dealerHand.every(c => c.faceUp) ? handTotalAll(dealerHand) : '?';
      drawHand(dealerHand, dealerCX, dealerCY, `Dealer ${phase === 'result' ? `(${dTotal})` : ''}`, false, phase === 'result');
    }

    // Player hands
    if (hands.host.length) {
      const showHostTotal  = phase !== 'waiting';
      drawHand(hands.host,  hostCX,  hostCY,  `${hostName}${stood.host  ? ' (stood)' : ''}`, myRole === 'host',  showHostTotal);
    }
    if (hands.guest.length) {
      const showGuestTotal = phase !== 'waiting';
      drawHand(hands.guest, guestCX, guestCY, `${guestName}${stood.guest ? ' (stood)' : ''}`, myRole === 'guest', showGuestTotal);
    }

    // Turn highlight
    if (phase === `player-${myRole}`) {
      const myCX = myRole === 'host' ? hostCX : guestCX;
      ctx.strokeStyle = '#f5e070'; ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.roundRect(myCX - CARD_W*1.5, hostCY - 20, CARD_W*3.5, CARD_H + 50, 10); ctx.stroke();
      ctx.setLineDash([]);
    }

    if (phase === 'result') drawResult(cw, ch);
    drawButtons(cw, ch);
    if (toastTimer > 0) { toastTimer -= 16; drawToast(cw, ch); }

    // Back button
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.roundRect(12, 12, 90, 32, 8); ctx.fill();
    ctx.fillStyle = '#bbb'; ctx.font = '13px monospace'; ctx.textAlign = 'left';
    ctx.fillText('← Map', 22, 32);

    raf = requestAnimationFrame(tick);
  }

  // ── Input ─────────────────────────────────────────────────────────────────────
  function onPointer(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.touches ? e.touches[0].clientX : e.clientX);
    const py = (e.touches ? e.touches[0].clientY : e.clientY);
    const x = (px - rect.left) * scaleX;
    const y = (py - rect.top)  * scaleY;
    const cw = canvas.width, ch = canvas.height;

    // Back button
    if (x >= 12 && x <= 102 && y >= 12 && y <= 44) {
      window.returnToMap?.(); return;
    }

    // Deal / Play Again button
    if ((phase === 'waiting' || phase === 'result') && myRole === 'host') {
      const btnW = 180, btnH = 44;
      const bx = cw/2 - btnW/2, by = ch/2 - btnH/2;
      if (x >= bx && x <= bx+btnW && y >= by && y <= by+btnH) {
        startRound(); return;
      }
    }

    // Hit / Stand buttons
    if (phase === `player-${myRole}` && !stood[myRole]) {
      const btnH = 44, gap = 16, btnW = 120;
      const totalW = btnW*2 + gap;
      const bx = cw/2 - totalW/2, by = ch - 65;

      if (x >= bx && x <= bx+btnW && y >= by && y <= by+btnH) {
        // Hit
        if (myRole === 'host') hit();
        else { guestAction('hit'); }
        return;
      }
      if (x >= bx+btnW+gap && x <= bx+totalW && y >= by && y <= by+btnH) {
        // Stand
        if (myRole === 'host') stand();
        else { guestAction('stand'); }
        return;
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.initCasino = function (opts) {
    sid     = opts.sid;
    myRole  = opts.role;
    oppRole = myRole === 'host' ? 'guest' : 'host';
    myProf  = opts.myProf;
    oppProf = opts.oppProf;

    canvas = document.getElementById('casino-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();

    // Reset local state
    deck = []; dealerHand = []; hands = { host: [], guest: [] };
    stood = { host: false, guest: false }; results = null;
    phase = 'waiting'; roundActive = false; toast = ''; toastTimer = 0;

    // Load existing scores if any
    if (window.db && sid) {
      window.db.ref(`sessions/${sid}/casino/scores`).once('value', snap => {
        if (snap.val()) scores = snap.val();
      });
    }

    listenCasino();
    listenGuestActions();

    canvas.addEventListener('pointerdown', onPointer);
    canvas.addEventListener('touchstart',  onPointer, { passive: false });
    raf = requestAnimationFrame(tick);
  };

  window.stopCasino = function () {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (dbRef) { dbRef.off(); dbRef = null; }
    if (canvas) {
      canvas.removeEventListener('pointerdown', onPointer);
      canvas.removeEventListener('touchstart',  onPointer);
    }
    if (window.db && sid) {
      window.db.ref(`sessions/${sid}/casino_action`).off();
    }
  };

})();
