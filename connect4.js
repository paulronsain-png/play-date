(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────────
  const COLS = 7, ROWS = 6;
  const EMPTY = 0, RED = 1, YELLOW = 2;

  // ── State ─────────────────────────────────────────────────────────────────────
  let canvas, ctx;
  let sid, myRole, oppRole;
  let myProf, oppProf;
  let raf = null;
  let dbRef = null;

  let board       = [];   // [col][row], 0=empty, 1=red(host), 2=yellow(guest)
  let currentTurn = RED;  // whose turn: RED=host, YELLOW=guest
  let winner      = 0;    // 0=none, 1=red, 2=yellow, 3=draw
  let scores      = { host: 0, guest: 0 };
  let phase       = 'waiting'; // waiting | playing | result
  let toast       = '';
  let toastTimer  = 0;
  let hoverCol    = -1;

  // ── Board helpers ─────────────────────────────────────────────────────────────
  function emptyBoard() {
    const b = [];
    for (let c = 0; c < COLS; c++) { b.push([]); for (let r = 0; r < ROWS; r++) b[c].push(EMPTY); }
    return b;
  }

  function dropPiece(col, player) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[col][r] === EMPTY) { board[col][r] = player; return r; }
    }
    return -1;
  }

  function checkWin(col, row, player) {
    const dirs = [[1,0],[0,1],[1,1],[1,-1]];
    for (const [dc, dr] of dirs) {
      let count = 1;
      for (let s = 1; s <= 3; s++) {
        const c = col + dc*s, r = row + dr*s;
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS || board[c][r] !== player) break;
        count++;
      }
      for (let s = 1; s <= 3; s++) {
        const c = col - dc*s, r = row - dr*s;
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS || board[c][r] !== player) break;
        count++;
      }
      if (count >= 4) return true;
    }
    return false;
  }

  function isDraw() {
    return board.every(col => col[0] !== EMPTY);
  }

  // ── Firebase ──────────────────────────────────────────────────────────────────
  function pushState() {
    if (!window.db || !sid) return;
    window.db.ref(`sessions/${sid}/connect4`).set(buildState());
  }

  function buildState() {
    return { board, currentTurn, winner, scores, phase, t: Date.now() };
  }

  function applyState(d) {
    board       = d.board       || emptyBoard();
    currentTurn = d.currentTurn ?? RED;
    winner      = d.winner      ?? 0;
    scores      = d.scores      || { host: 0, guest: 0 };
    phase       = d.phase       || 'waiting';
  }

  function listenConnect4() {
    if (!window.db || !sid) return;
    dbRef = window.db.ref(`sessions/${sid}/connect4`);
    dbRef.on('value', snap => {
      const d = snap.val();
      if (!d) return;
      if (myRole !== 'host') applyState(d);
      else {
        // Host only syncs scores/phase from remote to handle play-again from guest
        scores = d.scores || scores;
      }
    });
  }

  function guestDrop(col) {
    if (!window.db || !sid) return;
    window.db.ref(`sessions/${sid}/connect4_action`).set({ role: myRole, col, t: Date.now() });
  }

  function listenGuestActions() {
    if (!window.db || !sid || myRole !== 'host') return;
    window.db.ref(`sessions/${sid}/connect4_action`).on('value', snap => {
      const d = snap.val();
      if (!d || d.role !== 'guest') return;
      if (Date.now() - d.t > 8000) return;
      if (phase !== 'playing' || currentTurn !== YELLOW) return;
      handleDrop(d.col, YELLOW);
      window.db.ref(`sessions/${sid}/connect4_action`).remove();
    });
  }

  // ── Game logic ────────────────────────────────────────────────────────────────
  function startGame() {
    if (myRole !== 'host') return;
    board = emptyBoard();
    currentTurn = RED;
    winner = 0;
    phase = 'playing';
    pushState();
    showToast('Game started — Red goes first');
  }

  function handleDrop(col, player) {
    if (phase !== 'playing') return;
    if (col < 0 || col >= COLS) return;
    if (board[col][0] !== EMPTY) return; // column full

    const row = dropPiece(col, player);
    if (row === -1) return;

    if (checkWin(col, row, player)) {
      winner = player;
      phase = 'result';
      const winRole = player === RED ? 'host' : 'guest';
      scores[winRole] = (scores[winRole] || 0) + 1;
      showToast(player === (myRole === 'host' ? RED : YELLOW) ? 'You win! 🏆' : 'They win!');
    } else if (isDraw()) {
      winner = 3;
      phase = 'result';
      showToast("It's a draw!");
    } else {
      currentTurn = player === RED ? YELLOW : RED;
    }
    pushState();
  }

  function tryDrop(col) {
    if (phase === 'waiting' || phase === 'result') {
      if (myRole === 'host') startGame();
      return;
    }
    if (phase !== 'playing') return;
    const myPiece = myRole === 'host' ? RED : YELLOW;
    if (currentTurn !== myPiece) return;
    if (myRole === 'host') {
      handleDrop(col, RED);
    } else {
      guestDrop(col);
    }
  }

  function showToast(msg, dur = 2400) {
    toast = msg; toastTimer = dur;
  }

  // ── Draw ──────────────────────────────────────────────────────────────────────
  function boardGeometry(cw, ch) {
    const size   = Math.min(cw * 0.92, ch * 0.72, 560);
    const cellSz = size / COLS;
    const boardW = cellSz * COLS;
    const boardH = cellSz * ROWS;
    const bx     = (cw - boardW) / 2;
    const by     = (ch - boardH) / 2 + 20;
    return { cellSz, boardW, boardH, bx, by };
  }

  function drawBackground(cw, ch) {
    const bg = ctx.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, '#0a0a1a');
    bg.addColorStop(1, '#101030');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);
  }

  function drawBoard(cw, ch) {
    const { cellSz, boardW, boardH, bx, by } = boardGeometry(cw, ch);
    const rad = cellSz * 0.38;

    // Board shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    if (ctx.roundRect) ctx.roundRect(bx + 6, by + 6, boardW, boardH, 12);
    else ctx.rect(bx + 6, by + 6, boardW, boardH);
    ctx.fill();

    // Board face
    ctx.fillStyle = '#1a3a8a';
    if (ctx.roundRect) ctx.roundRect(bx, by, boardW, boardH, 12);
    else ctx.rect(bx, by, boardW, boardH);
    ctx.fill();
    ctx.strokeStyle = '#2a5acc';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pieces in holes
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const cx = bx + c * cellSz + cellSz / 2;
        const cy = by + r * cellSz + cellSz / 2;
        const val = board[c][r];

        // Hole background
        ctx.fillStyle = '#060c20';
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();

        if (val !== EMPTY) {
          const isRed = val === RED;
          const grad = ctx.createRadialGradient(cx - rad*0.25, cy - rad*0.25, 1, cx, cy, rad);
          if (isRed) {
            grad.addColorStop(0, '#ff6060');
            grad.addColorStop(1, '#cc1010');
          } else {
            grad.addColorStop(0, '#ffe060');
            grad.addColorStop(1, '#cc9000');
          }
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(cx, cy, rad - 1, 0, Math.PI * 2); ctx.fill();

          // Shine
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.beginPath(); ctx.arc(cx - rad*0.28, cy - rad*0.28, rad * 0.32, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  function drawHoverPiece(cw, ch) {
    if (phase !== 'playing') return;
    const myPiece = myRole === 'host' ? RED : YELLOW;
    if (currentTurn !== myPiece || hoverCol < 0) return;
    if (board[hoverCol][0] !== EMPTY) return;

    const { cellSz, bx, by } = boardGeometry(cw, ch);
    const rad  = cellSz * 0.38;
    const cx   = bx + hoverCol * cellSz + cellSz / 2;
    const cy   = by - cellSz * 0.55;
    const isRed = myPiece === RED;

    ctx.globalAlpha = 0.7;
    const grad = ctx.createRadialGradient(cx - rad*0.25, cy - rad*0.25, 1, cx, cy, rad);
    if (isRed) { grad.addColorStop(0, '#ff6060'); grad.addColorStop(1, '#cc1010'); }
    else       { grad.addColorStop(0, '#ffe060'); grad.addColorStop(1, '#cc9000'); }
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawColumnHighlight(cw, ch) {
    if (phase !== 'playing' || hoverCol < 0) return;
    const { cellSz, boardH, bx, by } = boardGeometry(cw, ch);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(bx + hoverCol * cellSz, by, cellSz, boardH);
  }

  function drawScores(cw) {
    const hostName  = myRole === 'host'  ? (myProf?.displayName  || 'Host')  : (oppProf?.displayName || 'Host');
    const guestName = myRole === 'guest' ? (myProf?.displayName  || 'Guest') : (oppProf?.displayName || 'Guest');

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    if (ctx.roundRect) ctx.roundRect(cw/2 - 130, 10, 260, 34, 8);
    else ctx.rect(cw/2 - 130, 10, 260, 34);
    ctx.fill();

    ctx.fillStyle = '#cc2020'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`🔴 ${hostName}: ${scores.host}`, cw/2 - 8, 32);
    ctx.fillStyle = '#cc9000'; ctx.textAlign = 'left';
    ctx.fillText(`🟡 ${guestName}: ${scores.guest}`, cw/2 + 8, 32);
  }

  function drawTurnIndicator(cw, ch) {
    if (phase !== 'playing') return;
    const myPiece  = myRole === 'host' ? RED : YELLOW;
    const isMyTurn = currentTurn === myPiece;
    const color    = currentTurn === RED ? '#cc2020' : '#cc9000';
    const name     = currentTurn === (myRole === 'host' ? RED : YELLOW)
      ? 'Your turn'
      : `${oppProf?.displayName || 'Partner'}'s turn`;

    const { by } = boardGeometry(cw, ch);
    ctx.fillStyle = isMyTurn ? color : 'rgba(255,255,255,0.4)';
    ctx.font = `bold ${isMyTurn ? 16 : 14}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(name, cw / 2, by - 22);
  }

  function drawButtons(cw, ch) {
    if (phase !== 'waiting' && phase !== 'result') return;
    const isHost = myRole === 'host';
    const btnW = 200, btnH = 44;
    const bx   = cw/2 - btnW/2;
    const { by, boardH } = boardGeometry(cw, ch);
    const bbY  = by + boardH + 24;

    ctx.globalAlpha = isHost ? 1 : 0.4;
    ctx.fillStyle = '#1a5acc';
    if (ctx.roundRect) ctx.roundRect(bx, bbY, btnW, btnH, 10);
    else ctx.rect(bx, bbY, btnW, btnH);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(phase === 'result' ? 'Play Again' : 'Start Game', cw/2, bbY + 29);

    if (!isHost) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '12px sans-serif';
      ctx.fillText('Waiting for host…', cw/2, bbY + btnH + 18);
    }
  }

  function drawResult(cw, ch) {
    if (phase !== 'result') return;
    const myPiece = myRole === 'host' ? RED : YELLOW;
    let label;
    if (winner === 3) label = "It's a draw! 🤝";
    else if (winner === myPiece) label = 'You win! 🏆';
    else label = 'They win!';
    const color = winner === 3 ? '#ffd060' : winner === myPiece ? '#50ff80' : '#ff6060';
    const { by, boardH } = boardGeometry(cw, ch);
    ctx.fillStyle = color;
    ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, cw/2, by + boardH + 20);
  }

  function drawToast(cw, ch) {
    if (!toast || toastTimer <= 0) return;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    if (ctx.roundRect) ctx.roundRect(cw/2 - 160, ch/2 - 22, 320, 40, 10);
    else ctx.rect(cw/2 - 160, ch/2 - 22, 320, 40);
    ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(toast, cw/2, ch/2 + 4);
  }

  function drawBackButton() {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    if (ctx.roundRect) ctx.roundRect(12, 12, 90, 32, 8);
    else ctx.rect(12, 12, 90, 32);
    ctx.fill();
    ctx.fillStyle = '#bbb'; ctx.font = '13px monospace'; ctx.textAlign = 'left';
    ctx.fillText('← Map', 22, 32);
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

    drawBackground(cw, ch);
    drawScores(cw);
    drawColumnHighlight(cw, ch);
    drawBoard(cw, ch);
    drawHoverPiece(cw, ch);
    drawTurnIndicator(cw, ch);
    if (phase === 'result') drawResult(cw, ch);
    drawButtons(cw, ch);
    if (toastTimer > 0) { toastTimer -= 16; drawToast(cw, ch); }
    drawBackButton();

    raf = requestAnimationFrame(tick);
  }

  // ── Input ─────────────────────────────────────────────────────────────────────
  function colFromX(x, cw, ch) {
    const { cellSz, boardW, bx } = boardGeometry(cw, ch);
    if (x < bx || x > bx + boardW) return -1;
    return Math.floor((x - bx) / cellSz);
  }

  function onPointerMove(e) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.touches ? e.touches[0].clientX : e.clientX);
    const py = (e.touches ? e.touches[0].clientY : e.clientY);
    const x  = (px - rect.left) * scaleX;
    const y  = (py - rect.top)  * scaleY;
    hoverCol = colFromX(x, canvas.width, canvas.height);
  }

  function onPointer(e) {
    e.preventDefault();
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.touches ? e.touches[0].clientX : e.clientX);
    const py = (e.touches ? e.touches[0].clientY : e.clientY);
    const x  = (px - rect.left) * scaleX;
    const y  = (py - rect.top)  * scaleY;
    const cw = canvas.width, ch = canvas.height;

    // Back button
    if (x >= 12 && x <= 102 && y >= 12 && y <= 44) {
      window.returnToMap?.(); return;
    }

    // Play Again / Start Game button
    if ((phase === 'waiting' || phase === 'result') && myRole === 'host') {
      const btnW = 200, btnH = 44;
      const bx   = cw/2 - btnW/2;
      const { by, boardH } = boardGeometry(cw, ch);
      const bbY  = by + boardH + 24;
      if (x >= bx && x <= bx + btnW && y >= bbY && y <= bbY + btnH) {
        startGame(); return;
      }
    }

    // Column drop
    const col = colFromX(x, cw, ch);
    if (col >= 0) tryDrop(col);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.initConnect4 = function (opts) {
    sid     = opts.sid;
    myRole  = opts.role;
    oppRole = myRole === 'host' ? 'guest' : 'host';
    myProf  = opts.myProf;
    oppProf = opts.oppProf;

    canvas = document.getElementById('connect4-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();

    board = emptyBoard();
    currentTurn = RED; winner = 0; phase = 'waiting';
    toast = ''; toastTimer = 0; hoverCol = -1;

    if (window.db && sid) {
      window.db.ref(`sessions/${sid}/connect4/scores`).once('value', snap => {
        if (snap.val()) scores = snap.val();
      });
    }

    listenConnect4();
    listenGuestActions();

    canvas.addEventListener('pointerdown', onPointer);
    canvas.addEventListener('touchstart',  onPointer, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('mouseleave', () => { hoverCol = -1; });

    raf = requestAnimationFrame(tick);
  };

  window.stopConnect4 = function () {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (dbRef) { dbRef.off(); dbRef = null; }
    if (canvas) {
      canvas.removeEventListener('pointerdown', onPointer);
      canvas.removeEventListener('touchstart',  onPointer);
      canvas.removeEventListener('pointermove', onPointerMove);
    }
    if (window.db && sid) {
      window.db.ref(`sessions/${sid}/connect4_action`).off();
    }
  };

})();
