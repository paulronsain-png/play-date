let state = null;
Object.defineProperty(window, '_gameState', { get: () => state });
let aiMode = false;

// ── Love heart interaction ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const heart   = document.getElementById('beating-heart');
  const overlay = document.getElementById('love-overlay');
  if (!heart || !overlay) return;

  let loveTimer = null;

  window.showLoveOverlay = function() {
    clearTimeout(loveTimer);
    overlay.classList.remove('hidden');
    for (let i = 0; i < 28; i++) {
      setTimeout(() => spawnSplashHeart(), i * 60);
    }
    loveTimer = setTimeout(() => {
      overlay.classList.add('hidden');
    }, 2000);
  };

  heart.style.cursor = 'pointer';
  heart.addEventListener('click', () => {
    window.showLoveOverlay();
    window.walleReact?.('love');
    // Broadcast to other player
    if (window.db) {
      window.db.ref('games/' + GAME_ID).update({ loveAt: Date.now() });
    }
  });

  function spawnSplashHeart() {
    const el = document.createElement('span');
    el.textContent = '♥';
    el.className = 'splash-heart';
    const size = (Math.random() * 1.5 + 0.8).toFixed(2);
    const angle = Math.random() * 360;
    const dist  = (Math.random() * 40 + 20).toFixed(1);
    const tx    = (Math.cos(angle * Math.PI / 180) * dist).toFixed(1) + 'vw';
    const ty    = (Math.sin(angle * Math.PI / 180) * dist).toFixed(1) + 'vh';
    const dur   = (Math.random() * 0.6 + 0.8).toFixed(2) + 's';
    const startX = (Math.random() * 90 + 5).toFixed(1) + 'vw';
    const startY = (Math.random() * 80 + 10).toFixed(1) + 'vh';
    el.style.cssText = `left:${startX};top:${startY};--sz:${size}rem;--tx:${tx};--ty:${ty};--dur:${dur};color:hsl(${Math.round(Math.random()*30+340)},90%,60%);`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }
});

function render() {
  renderBoard(state);
  renderCaptured(state.capturedByWhite, state.capturedByBlack);
  renderStatus(state);
  renderClocks(state);
}


function startNewGame() {
  clearInterval(clockInterval);
  clearTimeout(lastMoveTimer);
  const mins = parseInt(document.getElementById('timer-select').value);
  state = newGameState(mins);
  hideModal();
  hidePromoModal();
  // Do NOT reset seats automatically (prevents multiplayer desync)
  syncStateToFirebase(state);
  render();
  applyBoardOrientation();
  if (mins > 0) startClock(state);
}

function doAITurn(st) {
  if (st.gameOver || st.turn !== 'b') return;
  const move = getBestMove(st.board, st.enPassant, st.castling);
  if (!move) return;
  const captured = st.board[move.to[0]][move.to[1]];
  executeMove(st, move, 'Q');
  playSound(captured ? 'capture' : 'move');
  if (st.inCheck) playSound('check');
  render();
}

document.getElementById('board').addEventListener('click', e => {
  const sq = e.target.closest('.square');
  if (!sq || !state) return;
  const r = parseInt(sq.dataset.r);
  const c = parseInt(sq.dataset.c);
  const prevLen = state.moveHistory.length;
  handleSquareClick(state, r, c, aiMode, doAITurn);
  if (state.moveHistory.length !== prevLen) {
    window.hideRobotPanel?.();
    window.walleReact?.('happy');
  }
  if (!state.pendingPromo) render();
});

// ── Touch drag-and-drop ───────────────────────────────────────────────────────
(function() {
  let ghost     = null;
  let dragFrom  = null;
  let lastOver  = null;
  let didDrag   = false; // true if finger moved enough to be a drag

  function removeGhost() {
    if (ghost) { ghost.remove(); ghost = null; }
  }
  function clearOver() {
    if (lastOver) { lastOver.classList.remove('drag-over'); lastOver = null; }
  }
  function squareFromPoint(x, y) {
    if (ghost) ghost.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (ghost) ghost.style.display = '';
    return el ? el.closest('.square') : null;
  }

  document.getElementById('board').addEventListener('touchstart', e => {
    const sq = e.target.closest('.square');
    if (!sq || !state) return;
    const r = parseInt(sq.dataset.r);
    const c = parseInt(sq.dataset.c);
    if (!state.board[r][c]) return; // no piece — let normal click handle it
    e.preventDefault();
    dragFrom = { r, c };
    didDrag  = false;

    const touch = e.touches[0];
    const pieceEl = sq.querySelector('.piece');
    if (pieceEl) {
      ghost = document.createElement('span');
      ghost.textContent = pieceEl.textContent;
      ghost.className   = pieceEl.className;
      const sz = parseFloat(getComputedStyle(pieceEl).fontSize) * 1.5;
      ghost.style.cssText = `position:fixed;pointer-events:none;z-index:9999;font-size:${sz}px;transform:translate(-50%,-65%);left:${touch.clientX}px;top:${touch.clientY}px;`;
      document.body.appendChild(ghost);
    }
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!dragFrom) return;
    e.preventDefault();
    didDrag = true;
    const touch = e.touches[0];
    if (ghost) {
      ghost.style.left = touch.clientX + 'px';
      ghost.style.top  = touch.clientY + 'px';
    }
    const sq = squareFromPoint(touch.clientX, touch.clientY);
    if (sq !== lastOver) {
      clearOver();
      if (sq) { sq.classList.add('drag-over'); lastOver = sq; }
    }
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (!dragFrom) return;
    const touch = e.changedTouches[0];
    const toSq = squareFromPoint(touch.clientX, touch.clientY);
    removeGhost();
    clearOver();

    if (didDrag && toSq) {
      // Drag: select origin then move to destination
      const { r: fr, c: fc } = dragFrom;
      const tr = parseInt(toSq.dataset.r);
      const tc = parseInt(toSq.dataset.c);
      state.selected = [fr, fc];
      if (tr !== fr || tc !== fc) {
        const prevLen2 = state.moveHistory.length;
        handleSquareClick(state, tr, tc, aiMode, doAITurn);
        if (state.moveHistory.length !== prevLen2) {
          window.hideRobotPanel?.();
          window.walleReact?.('happy');
        }
        if (!state.pendingPromo) render();
      } else {
        // Dropped on same square — treat as tap select
        handleSquareClick(state, fr, fc, aiMode, doAITurn);
        render();
      }
    }
    // If didDrag is false, the touchstart didn't move — let the click event handle it normally

    dragFrom = null;
    didDrag  = false;
  }, { passive: false });

  document.addEventListener('touchcancel', () => {
    removeGhost(); clearOver(); dragFrom = null; didDrag = false;
  });
})();

// Mobile panel toggle
const panelToggle = document.getElementById('panel-toggle');
const panelCollapsible = document.getElementById('panel-collapsible');
if (panelToggle && panelCollapsible) {
  panelToggle.addEventListener('click', () => {
    const open = panelCollapsible.classList.toggle('open');
    panelToggle.classList.toggle('open', open);
    if (open) renderClocks(state); // refresh clock display immediately on open
  });
}

document.getElementById('promo-choices').addEventListener('click', e => {
  const btn = e.target.closest('.promo-choice');
  if (!btn || !state?.pendingPromo) return;
  const type = btn.dataset.type;
  const { move } = state.pendingPromo;
  state.pendingPromo = null;
  hidePromoModal();
  executeMove(state, move, type);
  playSound('move');
  render();
  if (aiMode && !state.gameOver && state.turn === 'b')
    setTimeout(() => { doAITurn(state); render(); }, 350);
});

document.getElementById('btn-new-game').addEventListener('click', () => {
  showModal('↻', 'New Game', 'Are you sure you want to start a new game?');
  const confirmBtn = document.getElementById('modal-new');
  const closeBtn   = document.getElementById('modal-close');
  confirmBtn.onclick = () => startNewGame();
  closeBtn.onclick   = hideModal;
});

document.getElementById('modal-new').addEventListener('click', startNewGame);
document.getElementById('modal-close').addEventListener('click', hideModal);

document.getElementById('btn-exit-game').addEventListener('click', async () => {
  const db = window.db;
  const user = window.currentUser;
  const gameId = String(window.GAME_ID || '').trim();
  const color = typeof getMyColor === 'function' ? getMyColor() : null;
  if (!gameId) return;
  try {
    if (db && user?.uid && color) {
      await db.ref(`games/${gameId}/seats/${color}`).remove();
    }
  } catch (_) {}
  sessionStorage.removeItem('myColor');
  window.GAME_ID = '';
  window.location.href = `${window.location.origin}${window.location.pathname}`;
});

document.getElementById('btn-resign').addEventListener('click', () => {
  if (!state || state.gameOver) return;
  showConfirmResign(() => {
    state.gameOver = true;
    clearInterval(clockInterval);
    const winnerColor = state.turn === 'w' ? 'b' : 'w';
    state.result = { type: 'resign', winner: winnerColor, endedAt: Date.now() };
    const loser  = playerNames[state.turn];
    const winner = state.turn === 'w' ? playerNames.b : playerNames.w;
    showModal('⚑', 'Resigned', `${loser} resigned. ${winner} wins!`);
    syncStateToFirebase(state);
  });
});

document.getElementById('btn-ask-robot').addEventListener('click', () => {
  if (!state || state.gameOver) return;
  if (typeof window.askRobot === 'function') window.askRobot(state);
});

// On mobile: move the robot button into the dedicated slot below the board
if (window.innerWidth <= 600) {
  const btn  = document.getElementById('btn-ask-robot');
  const slot = document.getElementById('mobile-robot-slot');
  if (btn && slot) slot.appendChild(btn);
}

document.getElementById('robot-panel-close').addEventListener('click', () => {
  if (typeof window.hideRobotPanel === 'function') window.hideRobotPanel();
});

document.getElementById('btn-pvp').addEventListener('click', () => {
  aiMode = false;
  document.getElementById('btn-pvp').classList.add('active');
  document.getElementById('btn-ai').classList.remove('active');
  applyModeUI();
  startNewGame();
});

document.getElementById('btn-ai').addEventListener('click', () => {
  aiMode = true;
  document.getElementById('btn-ai').classList.add('active');
  document.getElementById('btn-pvp').classList.remove('active');
  applyModeUI();
  startNewGame();
});

document.getElementById('toggle-hints').addEventListener('change', () => render());
document.getElementById('timer-select').addEventListener('change', () => startNewGame());

// ─── Theme toggle ─────────────────────────────────────────────────────────────
const btn = document.getElementById('theme-toggle');
const pvpBtn = document.getElementById('btn-pvp');
const aiBtn = document.getElementById('btn-ai');
const themeMenuWrap = document.getElementById('theme-menu-wrap');
const themeBtnDark    = document.getElementById('theme-dark');
const themeBtnLibrary = document.getElementById('theme-library');
const paulAvatar = document.querySelector('#card-white .avatar-img');
const caroAvatar = document.querySelector('#card-black .avatar-img');
const whiteNameEl = document.querySelector('#card-white .player-name');
const blackNameEl = document.querySelector('#card-black .player-name');
const seatIdentity = {
  w: { name: 'Player 1', avatar: '' },
  b: { name: 'Player 2', avatar: '' }
};

function defaultProfileAvatar(name) {
  if (typeof window.makeDefaultAvatarDataUri === 'function') return window.makeDefaultAvatarDataUri(name || 'Player');
  return 'icon.png';
}

function safeName(name, fallback) {
  const n = String(name || '').trim();
  return n || fallback;
}

function applyCardIdentity(identity) {
  const white = identity?.w || {};
  const black = identity?.b || {};

  const whiteName = safeName(white.name, 'Player 1');
  const blackName = safeName(black.name, 'Player 2');

  if (whiteNameEl) whiteNameEl.textContent = whiteName;
  if (blackNameEl) blackNameEl.textContent = blackName;
  if (paulAvatar) {
    paulAvatar.src = white.avatar || defaultProfileAvatar(whiteName);
    paulAvatar.alt = whiteName;
  }
  if (caroAvatar) {
    caroAvatar.src = black.avatar || defaultProfileAvatar(blackName);
    caroAvatar.alt = blackName;
  }
  if (typeof window.setPlayerNames === 'function') {
    window.setPlayerNames({ w: whiteName, b: blackName });
  }
  updateTopMenuLabels(whiteName, blackName);
}

function compactPlayerLabel(name, fallback) {
  const n = safeName(name, fallback);
  return n.length > 12 ? `${n.slice(0, 11)}…` : n;
}

function updateTopMenuLabels(whiteName, blackName) {
  if (pvpBtn) {
    pvpBtn.textContent = `${compactPlayerLabel(whiteName, 'Player 1')} vs ${compactPlayerLabel(blackName, 'Player 2')}`;
  }
  if (aiBtn) {
    aiBtn.textContent = aiMode ? 'vs Robot' : 'vs Computer';
  }
}

function robotAvatarDataUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#eaf8ff" stop-opacity="0.95"/>
        <stop offset="1" stop-color="#9ed5f3" stop-opacity="0.82"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="120" height="120" rx="60" fill="#0f2233"/>
    <rect x="30" y="28" width="60" height="44" rx="10" fill="url(#g)" stroke="#bde8ff" stroke-opacity="0.65" stroke-width="2"/>
    <ellipse cx="48" cy="50" rx="7.8" ry="5.0" transform="rotate(-36 48 50)" fill="#2f5f86"/>
    <ellipse cx="72" cy="50" rx="7.8" ry="5.0" transform="rotate(36 72 50)" fill="#2f5f86"/>
    <rect x="44" y="62" width="32" height="4" rx="2" fill="#2f5f86" fill-opacity="0.8"/>
    <rect x="36" y="80" width="48" height="24" rx="10" fill="url(#g)" stroke="#bde8ff" stroke-opacity="0.5" stroke-width="2"/>
    <rect x="56" y="18" width="8" height="10" rx="4" fill="#bde8ff"/>
    <circle cx="60" cy="14" r="5" fill="#7bc9ff"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function applyModeUI() {
  const inAIMode = aiMode;
  if (inAIMode) {
    const me = window.currentProfile || {};
    const white = {
      name: safeName(me.displayName, 'Player 1'),
      avatar: me.avatarDataUrl || defaultProfileAvatar(me.displayName || 'Player 1')
    };
    const black = { name: 'Robot', avatar: robotAvatarDataUri() };
    applyCardIdentity({ w: white, b: black });
    updateTopMenuLabels(white.name, black.name);
    return;
  }
  applyCardIdentity(seatIdentity);
  updateTopMenuLabels(seatIdentity.w?.name, seatIdentity.b?.name);
}

window.setMultiplayerIdentity = function(nextIdentity = {}) {
  if (nextIdentity.w) seatIdentity.w = { ...seatIdentity.w, ...nextIdentity.w };
  if (nextIdentity.b) seatIdentity.b = { ...seatIdentity.b, ...nextIdentity.b };
  if (!aiMode) applyCardIdentity(seatIdentity);
};

function applyPieceTheme() {
  Object.assign(SYMBOLS, {
    wK:'♥\uFE0E', wQ:'♛\uFE0E', wR:'♜\uFE0E', wB:'♝\uFE0E', wN:'♞\uFE0E', wP:'♟\uFE0E',
    bK:'♥\uFE0E', bQ:'♛\uFE0E', bR:'♜\uFE0E', bB:'♝\uFE0E', bN:'♞\uFE0E', bP:'♟\uFE0E'
  });
}

const THEME_MAP = {
  dark:    'dark-mode',
  library: 'library-mode'
};

const bookSVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="display:inline-block;vertical-align:middle"><path d="M4 3 Q4 2 5 2 L16 2 Q18 2 18 4 L18 19 Q18 21 16 21 L5 21 Q4 21 4 20 Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><line x1="4" y1="21" x2="18" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.7"/><line x1="8" y1="10" x2="14" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.7"/><line x1="8" y1="13" x2="12" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.5"/></svg>`;

const eyeSVG    = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="display:inline-block;vertical-align:middle"><path d="M1 12C1 12 5 5 12 5C19 5 23 12 23 12C23 12 19 19 12 19C5 19 1 12 1 12Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`;
const moonSVG   = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="display:inline-block;vertical-align:middle"><path d="M20.3 14.2A8.6 8.6 0 0 1 9.8 3.7a.7.7 0 0 0-1-.8A9.9 9.9 0 1 0 21.1 15.2a.7.7 0 0 0-.8-1z"/></svg>`;
const sunSVG    = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="display:inline-block;vertical-align:middle"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.6v2.5M12 18.9v2.5M2.6 12h2.5M18.9 12h2.5M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const rewindSVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="display:inline-block;vertical-align:middle"><path d="M3.5 12A8.5 8.5 0 1 0 7 5.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 8v4.5H8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function closeThemeMenu() {
  if (!themeMenuWrap) return;
  themeMenuWrap.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function openThemeMenu() {
  if (!themeMenuWrap) return;
  themeMenuWrap.classList.add('open');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function setTheme(mode) {
  const className = THEME_MAP[mode] || THEME_MAP.dark;
  document.body.classList.remove('dark-mode', 'light-mode', 'cream-mode', 'og-mode', 'library-mode');
  document.body.classList.add(className);

  if (themeBtnDark)    themeBtnDark.classList.toggle('active', mode === 'dark');
  if (themeBtnLibrary) themeBtnLibrary.classList.toggle('active', mode === 'library');
  if (themeBtnDark)    themeBtnDark.classList.toggle('hidden-selected', mode === 'dark');
  if (themeBtnLibrary) themeBtnLibrary.classList.toggle('hidden-selected', mode === 'library');

  if (btn) {
    btn.innerHTML = mode === 'library' ? bookSVG : moonSVG;
    btn.style.color = '';
  }

  const heartEl = document.getElementById('beating-heart');
  if (heartEl) heartEl.textContent = '♥\uFE0E';

  applyPieceTheme();
  applyModeUI();
  if (state) render();
}

document.body.classList.add('library-mode');
applyModeUI();
setTheme('library');

let currentTheme = 'library';
btn.addEventListener('click', e => {
  e.preventDefault();
  currentTheme = currentTheme === 'dark' ? 'library' : 'dark';
  setTheme(currentTheme);
});

// ─── Boot sequence ────────────────────────────────────────────────────────────
let gameBooted = false;
function bootGame() {
  if (gameBooted) return;
  gameBooted = true;

  if (!window.GAME_ID) {
    console.warn('No game id found. Waiting for lobby selection.');
    return;
  }

  claimSeat(() => {
    const mins = parseInt(document.getElementById('timer-select').value);
    state = newGameState(mins);

    if (window.db) {
      window.db.ref("games/" + GAME_ID).once("value", snapshot => {
        const data = snapshot.val();

        if (data && data.board) {
          try {
            const firstCell = data.board[0][0];
            if (typeof firstCell === 'string' || firstCell === '') {
              state.board = deserializeBoard(data.board);
            } else {
              state.board = data.board.map(row => row.map(sq => sq || null));
            }
            state.turn            = data.turn            || 'w';
            state.enPassant       = data.enPassant       || null;
            state.castling        = data.castling        || { wK:true, wQ:true, bK:true, bQ:true };
            state.capturedByWhite = data.capturedByWhite || [];
            state.capturedByBlack = data.capturedByBlack || [];
            state.lastMove        = data.lastMove        || null;
            state.inCheck         = data.inCheck         || false;
            state.clocks          = data.clocks          || state.clocks;
            state.moveHistory     = data.moveHistory     || [];
          } catch (e) {
            console.warn('Could not resume game, starting fresh:', e);
            state = newGameState(mins);
            syncStateToFirebase(state);
          }
        } else {
          // Only create a new game if none exists yet
          syncStateToFirebase(state);
        }

        render();
        applyBoardOrientation();
        applyPanelOrientation();
        updatePlayerBanner();
        if (state.clocks.w !== null && !state.gameOver) startClock(state);
        listenToFirebase(state, () => { render(); applyBoardOrientation(); });
      });
    } else {
      render();
      applyBoardOrientation();
      applyPanelOrientation();
      updatePlayerBanner();
    }
  });
}

(async function waitForAuthAndBoot() {
  if (window.appReadyPromise) await window.appReadyPromise;
  bootGame();
})();

if (typeof showModal === 'function') window.showModal = showModal;
