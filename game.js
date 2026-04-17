// ─── Game State ──────────────────────────────────────────────────────────────

const playerNames = {
  w: "Paul",
  b: "Caro"
};

function setPlayerNames(nextNames = {}) {
  if (typeof nextNames.w === 'string') playerNames.w = nextNames.w;
  if (typeof nextNames.b === 'string') playerNames.b = nextNames.b;
}

function getPlayerNames() {
  return { ...playerNames };
}

window.setPlayerNames = setPlayerNames;
window.getPlayerNames = getPlayerNames;

// ─── Who am I? ────────────────────────────────────────────────────────────────
// Stored in sessionStorage so refreshing keeps your role
function getMyColor() {
  return sessionStorage.getItem('myColor') || null;
}
function setMyColor(color) {
  sessionStorage.setItem('myColor', color);
}

function newGameState(timerMinutes = 10) {
  const secs = timerMinutes > 0 ? timerMinutes * 60 : null;
  return {
    board:       initialBoard(),
    turn:        'w',
    selected:    null,
    enPassant:   null,
    castling:    { wK:true, wQ:true, bK:true, bQ:true },
    moveHistory: [],
    capturedByWhite: [],
    capturedByBlack: [],
    inCheck:     false,
    gameOver:    false,
    lastMove:    null,
    clocks:      { w: secs, b: secs },
    clockStartedAt: secs !== null ? Date.now() : null,
    timerMinutes,
    result:      null,
    pendingPromo: null,
  };
}

// ─── Clock ───────────────────────────────────────────────────────────────────
let clockInterval = null;
let isPaused = false;
let lastMoveTimer = null;
const loggedMatchHistoryKeys = new Set();

function getMatchMode() {
  return document.getElementById('btn-ai')?.classList.contains('active') ? 'vs_robot' : 'pvp';
}

async function recordCurrentUserMatchHistory(state) {
  const user = window.currentUser || null;
  const db = window.db;
  const result = state?.result || null;
  const myColor = typeof getMyColor === 'function' ? getMyColor() : null;
  if (!user?.uid || !db || !result || !myColor) return;

  const endedAt = Number(result.endedAt || Date.now());
  const baseKey = String(GAME_ID || 'game').replace(/[^A-Za-z0-9_-]/g, '_');
  const historyKey = `${baseKey}_${endedAt}`;
  if (loggedMatchHistoryKeys.has(historyKey)) return;
  loggedMatchHistoryKeys.add(historyKey);

  const winner = result.winner || null;
  const outcome = winner === null ? 'draw' : (winner === myColor ? 'win' : 'loss');
  const oppColor = myColor === 'w' ? 'b' : 'w';
  const myName = (playerNames[myColor] || 'Player').trim() || 'Player';
  const opponentName = (playerNames[oppColor] || 'Opponent').trim() || 'Opponent';

  const payload = {
    gameId: GAME_ID,
    at: endedAt,
    mode: getMatchMode(),
    myColor,
    myName,
    opponentName,
    outcome,
    reason: String(result.type || 'game_over'),
    winnerColor: winner,
    moveCount: Array.isArray(state.moveHistory) ? state.moveHistory.length : 0,
    timerMinutes: Number.isFinite(state.timerMinutes) ? state.timerMinutes : null
  };

  try {
    await db.ref(`users/${user.uid}/matchHistory/${historyKey}`).set(payload);
  } catch (err) {
    loggedMatchHistoryKeys.delete(historyKey);
    console.warn('Could not save match history:', err);
  }
}

function maybeRecordMatchHistory(state) {
  if (!state?.gameOver || !state?.result) return;
  recordCurrentUserMatchHistory(state);
}

function getDisplaySeconds(state, color) {
  if (state.clocks[color] === null) return null;
  if (color !== state.turn || isPaused || !state.clockStartedAt) return state.clocks[color];
  const elapsed = (Date.now() - state.clockStartedAt) / 1000;
  return Math.max(0, state.clocks[color] - elapsed);
}

function startClock(state) {
  updateYappingVisibility(state);
  if (state.clocks.w === null) { clearInterval(clockInterval); renderClocks(state); return; }
  clearInterval(clockInterval);
  renderClocks(state); // immediate update before the 500ms interval fires
  clockInterval = setInterval(() => {
    if (state.gameOver) { clearInterval(clockInterval); return; }
    renderClocks(state);

    // Nudge yapping button after 60s of inactivity
    const yappingBtn = document.getElementById('yapping-btn');
    if (yappingBtn && !isPaused && state.clockStartedAt) {
      const idle = (Date.now() - state.clockStartedAt) / 1000;
      yappingBtn.classList.toggle('nudge', idle >= 60);
    }

    const secs = getDisplaySeconds(state, state.turn);
    if (!isPaused && secs <= 0) {
      clearInterval(clockInterval);
      const winner = state.turn === 'w' ? playerNames.b : playerNames.w;
      const winnerColor = state.turn === 'w' ? 'b' : 'w';
      state.clocks[state.turn] = 0;
      state.gameOver = true;
      state.result = { type: 'timeout', winner: winnerColor, endedAt: Date.now() };
      showModal('⏱', 'Time Out', `${winner} wins on time!`);
      syncStateToFirebase(state);
      maybeRecordMatchHistory(state);
    }
  }, 500);
}

function renderClocks(state) {
  ['w','b'].forEach(color => {
    const key = color === 'w' ? 'white' : 'black';
    const els = [
      document.getElementById('clock-' + key),
      document.getElementById('clock-' + key + '-menu')
    ].filter(Boolean);
    const secs = getDisplaySeconds(state, color);
    if (secs === null) {
      els.forEach(el => {
        el.textContent = '—';
        el.classList.remove('low');
      });
      return;
    }
    const s = Math.floor(secs);
    const m = Math.floor(s / 60);
    const txt = `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
    els.forEach(el => {
      el.textContent = txt;
      el.classList.toggle('low', secs <= 30);
    });
  });
}

// ─── Capture popup helper ─────────────────────────────────────────────────────
function showCapturePopup(type) {
  const popups = {
    r: ['✈️', 'Oh my god...', 'They hit the second tower!'],
    n: ['🐎⚰️', '...', ''],
    q: ['💔', 'Ouuuuch!!!', 'The queen is gone!'],
  };
  const key = type ? type.toLowerCase() : null;
  const [icon, title, msg] = popups[key] || ['🥲', 'Oof...', ''];
  setTimeout(() => {
    showModal(icon, title, msg);
    const confirmBtn = document.getElementById('modal-new');
    const closeBtn   = document.getElementById('modal-close');
    if (confirmBtn) confirmBtn.style.display = 'none';
    if (closeBtn) closeBtn.onclick = () => {
      if (confirmBtn) confirmBtn.style.display = 'block';
      hideModal();
    };
  }, 100);
}

// ─── Execute a move ───────────────────────────────────────────────────────────
function executeMove(state, move, promoType = 'Q') {
  const nb = copyBoard(state.board);
  const piece = nb[move.from[0]][move.from[1]];
  const captured = nb[move.to[0]][move.to[1]];
  const nc = {...state.castling};

  // Track captures & show popup
  if (captured) {
    const paulWinning = document.getElementById('paul-winning');
    const paulLosing  = document.getElementById('paul-losing');
    if (paulWinning) paulWinning.classList.add('hidden');
    if (paulLosing)  paulLosing.classList.add('hidden');
    if (captured.color === 'w' && paulLosing) {
      paulLosing.classList.remove('hidden');
      setTimeout(() => paulLosing.classList.add('hidden'), 5000);
    }
    if (captured.color === 'b' && paulWinning) {
      paulWinning.classList.remove('hidden');
      setTimeout(() => paulWinning.classList.add('hidden'), 5000);
    }
    if (piece.color === 'w') state.capturedByWhite.push(captured.type);
    else                     state.capturedByBlack.push(captured.type);
    // Record capture so Firebase can notify the victim
    state.lastCapture = { type: captured.type, color: captured.color, at: Date.now() };
    // Only show popup locally if it's YOUR piece being taken (or no color assigned — AI/local mode)
    const myColor = getMyColor();
    if (!myColor || captured.color === myColor) showCapturePopup(captured.type);
  }

  // Apply move
  nb[move.to[0]][move.to[1]] = piece;
  nb[move.from[0]][move.from[1]] = null;

  // En passant capture
  if (move.enPassant) {
    const dir = piece.color === 'w' ? 1 : -1;
    const epPiece = nb[move.to[0]+dir][move.to[1]];
    if (epPiece) {
      const epColor = piece.color === 'w' ? 'b' : 'w';
      if (piece.color === 'w') state.capturedByWhite.push(epPiece.type);
      else                     state.capturedByBlack.push(epPiece.type);
      state.lastCapture = { type: epPiece.type, color: epColor, at: Date.now() };
      const myColor = getMyColor();
      if (!myColor || epColor === myColor) showCapturePopup(epPiece.type);
    }
    nb[move.to[0]+dir][move.to[1]] = null;
  }

  // Castling — move rook
  if (move.castle) {
    const r = move.from[0];
    if (move.castle === 'K') { nb[r][5] = nb[r][7]; nb[r][7] = null; }
    else                     { nb[r][3] = nb[r][0]; nb[r][0] = null; }
  }

  // Promotion
  if (move.promo) {
    nb[move.to[0]][move.to[1]] = { color: piece.color, type: promoType };
  }

  // Update castling rights
  if (piece.type === 'K') { nc[piece.color+'K'] = false; nc[piece.color+'Q'] = false; }
  if (piece.type === 'R') {
    if (move.from[1] === 7) nc[piece.color+'K'] = false;
    if (move.from[1] === 0) nc[piece.color+'Q'] = false;
  }

  // En passant square
  const newEP = move.doublePush ? [move.to[0]+(piece.color==='w'?1:-1), move.to[1]] : null;

  // Check / checkmate / stalemate
  const opp = piece.color === 'w' ? 'b' : 'w';
  const oppInCheck = isInCheck(nb, opp);
  const oppMoves   = getAllLegalMoves(nb, opp, newEP, nc);
  const isMate     = oppMoves.length === 0 && oppInCheck;
  const isDraw     = oppMoves.length === 0 && !oppInCheck;

  let notation = moveToNotation(state.board, move, piece, captured, isMate, oppInCheck);
  if (move.promo) notation = notation.replace('=Q', '='+promoType);

  state.moveHistory.push(notation);
  state.lastMove  = [move.from[0], move.from[1], move.to[0], move.to[1]];
  clearTimeout(lastMoveTimer);
  lastMoveTimer = setTimeout(() => {
    state.lastMove = null;
    const board = document.getElementById('board');
    if (board) board.querySelectorAll('.last-move').forEach(el => el.classList.remove('last-move'));
  }, 3000);
  state.board     = nb;
  state.castling  = nc;
  state.enPassant = newEP;
  state.turn      = opp;
  state.inCheck   = oppInCheck;
  state.selected  = null;

  if (isMate) {
    state.gameOver = true;
    clearInterval(clockInterval);
    const winner = piece.color === 'w' ? playerNames.w : playerNames.b;
    state.result = { type: 'checkmate', winner: piece.color, endedAt: Date.now() };
    setTimeout(() => showModal('♛', 'Checkmate!', `${winner} wins by checkmate!`), 200);
  } else if (isDraw) {
    state.gameOver = true;
    clearInterval(clockInterval);
    state.result = { type: 'stalemate', winner: null, endedAt: Date.now() };
    setTimeout(() => showModal('🤝', 'Stalemate', 'The game is a draw!'), 200);
  }

  // Deduct elapsed time from the player who just moved, reset timestamp for new turn
  if (state.clocks.w !== null && state.clockStartedAt && !isMate && !isDraw) {
    const elapsed = (Date.now() - state.clockStartedAt) / 1000;
    state.clocks[piece.color] = Math.max(0, state.clocks[piece.color] - elapsed);
    state.clockStartedAt = Date.now();
  }
  document.getElementById('yapping-btn')?.classList.remove('nudge');

  syncStateToFirebase(state);
  maybeRecordMatchHistory(state);
  return { isMate, isDraw };
}

// ─── Handle square click ──────────────────────────────────────────────────────
function handleSquareClick(state, r, c, aiMode, onAITurn) {
  if (state.gameOver) return;

  // In multiplayer mode, only allow moving your own color
  const myColor = getMyColor();
  if (myColor && state.turn !== myColor) return;

  // In AI mode, block black's turn
  if (aiMode && state.turn === 'b') return;

  const piece = state.board[r][c];

  if (state.selected) {
    const [sr, sc] = state.selected;
    const legal = getLegalMoves(state.board, sr, sc, state.enPassant, state.castling);
    const move  = legal.find(m => m.to[0] === r && m.to[1] === c);

    if (move) {
      if (move.promo) {
        state.pendingPromo = { move, aiMode, onAITurn };
        showPromoModal(state.board[sr][sc].color);
        return;
      }
      const result = executeMove(state, move);
      playSound('move');
      if (!result.isMate && !result.isDraw && aiMode && !state.gameOver) {
        setTimeout(() => onAITurn(state), 350);
      }
      return;
    }

    if (piece?.color === state.turn) { state.selected = [r, c]; return; }
    state.selected = null;
    return;
  }

  if (piece?.color === state.turn) state.selected = [r, c];
}

// ─── Resign confirmation ──────────────────────────────────────────────────────
function showConfirmResign(onConfirm) {
  const overlay = document.getElementById('overlay');
  const modal   = document.getElementById('modal');
  const icon    = document.getElementById('modal-icon');
  const title   = document.getElementById('modal-title');
  const msg     = document.getElementById('modal-msg');
  const btnNew  = document.getElementById('modal-new');
  const btnClose = document.getElementById('modal-close');

  icon.textContent  = '⚑';
  title.textContent = 'Resign?';
  msg.textContent   = 'Are you sure you want to resign?';
  btnNew.textContent   = 'Yes, resign';
  btnClose.textContent = 'Cancel';

  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');

  const cleanup = () => {
    overlay.classList.add('hidden');
    modal.classList.add('hidden');
    btnNew.textContent   = 'Play Again';
    btnClose.textContent = 'Close';
    btnNew.replaceWith(btnNew.cloneNode(true));
    btnClose.replaceWith(btnClose.cloneNode(true));
    // Re-attach normal modal listeners
    document.getElementById('modal-new').addEventListener('click', () => { newGame(); hideModal(); });
    document.getElementById('modal-close').addEventListener('click', hideModal);
  };

  document.getElementById('modal-new').addEventListener('click', () => { cleanup(); onConfirm(); });
  document.getElementById('modal-close').addEventListener('click', cleanup);
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
function showModal(icon, title, msg) {
  document.getElementById('modal-icon').textContent = icon;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-msg').textContent = msg;
  document.getElementById('overlay').classList.remove('hidden');
}
function hideModal() {
  document.getElementById('overlay').classList.add('hidden');
}
function showPromoModal(color) {
  const types = ['Q','R','B','N'];
  const choices = document.getElementById('promo-choices');
  choices.innerHTML = '';
  types.forEach(t => {
    const btn = document.createElement('div');
    btn.className = 'promo-choice';
    btn.textContent = SYMBOLS[color+t];
    btn.dataset.type = t;
    choices.appendChild(btn);
  });
  document.getElementById('promo-overlay').classList.remove('hidden');
}
function hidePromoModal() {
  document.getElementById('promo-overlay').classList.add('hidden');
}

// ─── Sound effects ────────────────────────────────────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  return audioCtx;
}
function playSound(type) {
  if (!document.getElementById('toggle-sound').checked) return;
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === 'move')    { osc.frequency.value = 440; gain.gain.setValueAtTime(0.1,  ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.12); }
    if (type === 'capture') { osc.frequency.value = 280; gain.gain.setValueAtTime(0.15, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.18); }
    if (type === 'check')   { osc.frequency.value = 600; gain.gain.setValueAtTime(0.12, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.25); }
    osc.start(); osc.stop(ctx.currentTime+0.3);
  } catch(e) {}
}

// ─── Yapping Break ────────────────────────────────────────────────────────────
let yappingToastTimer = null;
let quickConvoSyncTimer = null;

function showYappingToast() {
  const toast = document.getElementById('yapping-toast');
  if (!toast) return;
  clearTimeout(yappingToastTimer);
  toast.classList.remove('hidden', 'hiding');
  yappingToastTimer = setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 3500);
}

function applyPauseTiming(state, paused) {
  if (!state || state.clocks?.w === null) return;
  if (paused) {
    if (state.clockStartedAt) {
      const elapsed = (Date.now() - state.clockStartedAt) / 1000;
      state.clocks[state.turn] = Math.max(0, state.clocks[state.turn] - elapsed);
      state.clockStartedAt = null;
    }
  } else if (!state.clockStartedAt) {
    state.clockStartedAt = Date.now();
  }
}

function setYappingPaused(paused) {
  isPaused = paused;
  const btn = document.getElementById('yapping-btn');
  if (btn) {
    btn.classList.toggle('active-break', !!isPaused);
    btn.classList.remove('nudge');
  }
  const resumeBtn = document.getElementById('yapping-resume-btn');
  if (resumeBtn) resumeBtn.disabled = !isPaused;
  if (!isPaused) {
    closeYappingMenu();
    closeQuickConvo();
  }
}

function syncYappingPause(next, opts = {}) {
  const { showToastOnPause = false } = opts;
  setYappingPaused(next);

  if (window._gameState) applyPauseTiming(window._gameState, next);
  if (next && showToastOnPause) showYappingToast();

  if (!(window.db && window._gameState)) return;
  const state = window._gameState;
  const toastAt = next ? Date.now() : null;
  if (toastAt) window._lastYappingToast = toastAt;
  window.db.ref("games/" + GAME_ID).update({
    yappingPaused:   next,
    yappingToastAt:  toastAt,
    clocks:          state.clocks,
    clockStartedAt:  state.clockStartedAt || null,
    updatedAt:       Date.now(),
  });
}

function closeYappingMenu() {
  const menu = document.getElementById('yapping-menu');
  if (menu) menu.classList.add('hidden');
}

function openYappingMenu() {
  const menu = document.getElementById('yapping-menu');
  const resumeBtn = document.getElementById('yapping-resume-btn');
  if (!menu) return;
  if (resumeBtn) resumeBtn.disabled = !isPaused;
  menu.classList.remove('hidden');
}

function getQuickConvoSlotData(color) {
  const key = color === 'w' ? 'white' : 'black';
  return {
    liveVideo: document.getElementById(`video-${key}`),
    overlayVideo: document.getElementById(color === 'w' ? 'quick-convo-video-bottom' : 'quick-convo-video-top'),
    overlayAvatar: document.getElementById(color === 'w' ? 'quick-convo-avatar-bottom' : 'quick-convo-avatar-top'),
    overlayName: document.getElementById(color === 'w' ? 'quick-convo-name-bottom' : 'quick-convo-name-top'),
    cardAvatar: document.querySelector(`#card-${key} .avatar-img`),
    cardName: document.querySelector(`#card-${key} .player-name`)
  };
}

function syncQuickConvoFeeds() {
  ['b', 'w'].forEach(color => {
    const slot = getQuickConvoSlotData(color);
    if (!slot.overlayVideo || !slot.overlayAvatar) return;

    const displayName = (slot.cardName?.textContent || (color === 'w' ? 'Player 1' : 'Player 2')).trim();
    if (slot.overlayName) slot.overlayName.textContent = displayName;

    if (slot.cardAvatar?.src) slot.overlayAvatar.src = slot.cardAvatar.src;

    const hasLiveVideo = !!(slot.liveVideo?.classList.contains('active') && slot.liveVideo?.srcObject);
    if (hasLiveVideo) {
      if (slot.overlayVideo.srcObject !== slot.liveVideo.srcObject) {
        slot.overlayVideo.srcObject = slot.liveVideo.srcObject;
      }
      slot.overlayVideo.classList.remove('hidden');
      slot.overlayAvatar.classList.add('hidden');
      const playPromise = slot.overlayVideo.play?.();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
    } else {
      slot.overlayVideo.classList.add('hidden');
      slot.overlayAvatar.classList.remove('hidden');
      if (slot.overlayVideo.srcObject) slot.overlayVideo.srcObject = null;
    }
  });
}

function openQuickConvo() {
  const overlay = document.getElementById('quick-convo-overlay');
  if (!overlay) return;
  if (!isPaused) syncYappingPause(true, { showToastOnPause: false });
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  syncQuickConvoFeeds();
  clearInterval(quickConvoSyncTimer);
  quickConvoSyncTimer = setInterval(syncQuickConvoFeeds, 450);
}

function closeQuickConvo() {
  const overlay = document.getElementById('quick-convo-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  clearInterval(quickConvoSyncTimer);
  quickConvoSyncTimer = null;
}

const yappingBtn = document.getElementById('yapping-btn');
if (yappingBtn) {
  yappingBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isPaused) syncYappingPause(true, { showToastOnPause: true });
    openYappingMenu();
  });
}

document.getElementById('yapping-resume-btn')?.addEventListener('click', () => {
  syncYappingPause(false, { showToastOnPause: false });
});

document.getElementById('yapping-quick-btn')?.addEventListener('click', () => {
  closeYappingMenu();
  openQuickConvo();
});

document.getElementById('quick-convo-end-btn')?.addEventListener('click', () => {
  closeQuickConvo();
});

document.getElementById('quick-convo-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'quick-convo-overlay') closeQuickConvo();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeYappingMenu();
    closeQuickConvo();
  }
});

document.addEventListener('click', (e) => {
  const menu = document.getElementById('yapping-menu');
  if (!menu || menu.classList.contains('hidden')) return;
  if (e.target.closest('#yapping-btn') || e.target.closest('#yapping-menu')) return;
  closeYappingMenu();
});

function updateYappingVisibility(state) {
  const btn = document.getElementById('yapping-btn');
  if (!btn) return;
  if (state.clocks.w === null) {
    btn.classList.add('hidden');
    closeYappingMenu();
    closeQuickConvo();
  } else {
    btn.classList.remove('hidden');
  }
}

// ─── Firebase Multiplayer ─────────────────────────────────────────────────────
const GAME_ID = (() => {
  const fromWindow = typeof window !== 'undefined' ? (window.GAME_ID || '') : '';
  if (/^[A-Za-z0-9_-]{6,64}$/.test(fromWindow)) return fromWindow;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('game') || '';
    if (/^[A-Za-z0-9_-]{6,64}$/.test(fromUrl)) return fromUrl;
  } catch (_) {}
  return '';
})();
if (typeof window !== 'undefined') window.GAME_ID = GAME_ID;
let isListening = false;
let seatsIdentityListening = false;

// Serialize board for Firebase (Firebase can't store null in arrays reliably)
function serializeBoard(board) {
  return board.map(row => row.map(sq => sq ? `${sq.color}${sq.type}` : ''));
}
function deserializeBoard(raw) {
  return raw.map(row => row.map(sq => sq ? { color: sq[0], type: sq[1] } : null));
}

function syncStateToFirebase(state) {
  if (!window.db) return;
  window.db.ref("games/" + GAME_ID).update({
    board:           serializeBoard(state.board),
    turn:            state.turn,
    enPassant:       state.enPassant || null,
    castling:        state.castling,
    capturedByWhite: state.capturedByWhite,
    capturedByBlack: state.capturedByBlack,
    lastMove:        state.lastMove || null,
    lastCapture:     state.lastCapture || null,
    inCheck:         state.inCheck,
    gameOver:        state.gameOver,
    clocks:          state.clocks,
    clockStartedAt:  state.clockStartedAt || null,
    result:          state.result || null,
    moveHistory:     state.moveHistory,
    updatedAt:       Date.now(),
  });
}

// Reactively show/hide the invite box based on whether black seat is live.
// Calling this once sets up a persistent listener — the box appears whenever
// Caro is gone and disappears the moment she joins.
function watchShareBox() {
  const box   = document.getElementById('share-box');
  const input = document.getElementById('share-link');
  if (!box || !input || !window.db) return;
  input.value = window.location.href;

  // Show immediately — don't wait for the async Firebase callback
  box.classList.remove('hidden');

  // Then reactively hide/re-show as Caro joins or leaves
  window.db.ref("games/" + GAME_ID + "/seats/b").on("value", snap => {
    if (getMyColor() !== 'w') return;
    if (isSeatLive(snap.val())) {
      box.classList.add('hidden');
    } else {
      box.classList.remove('hidden');
    }
  });
}

document.getElementById('copy-link-btn')?.addEventListener('click', () => {
  const input = document.getElementById('share-link');
  const btn   = document.getElementById('copy-link-btn');
  if (!input || !btn) return;
  navigator.clipboard.writeText(input.value).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  }).catch(() => {
    input.select();
    document.execCommand('copy');
  });
});

// A seat is "live" if its heartbeat was updated within the last 30 seconds
const SEAT_TTL_MS = 30000;
function isSeatLive(seat) {
  if (!seat || !seat.connectedAt) return false;
  return (Date.now() - seat.connectedAt) < SEAT_TTL_MS;
}

function seatToIdentity(seat, fallbackName) {
  const fallback = fallbackName || 'Player';
  if (!seat || !isSeatLive(seat)) return { name: fallback, avatar: '' };
  const nameFromEmail = seat.email ? String(seat.email).split('@')[0] : '';
  const name = String(seat.name || seat.displayName || nameFromEmail || fallback).trim() || fallback;
  const avatar = seat.avatarDataUrl || '';
  return { name, avatar };
}

function startSeatsIdentityWatcher() {
  if (seatsIdentityListening || !window.db) return;
  seatsIdentityListening = true;
  window.db.ref("games/" + GAME_ID + "/seats").on("value", snap => {
    const seats = snap.val() || {};
    const identity = {
      w: seatToIdentity(seats.w, 'Player 1'),
      b: seatToIdentity(seats.b, 'Player 2')
    };
    if (typeof window.setMultiplayerIdentity === 'function') {
      window.setMultiplayerIdentity(identity);
    }
  });
}

// Ping our seat's connectedAt every 10 seconds so others know we're here.
// Also registers onDisconnect so Firebase removes the seat server-side the
// instant the WebSocket drops (handles crashes/mobile/force-close reliably).
let heartbeatInterval = null;
function startHeartbeat(color) {
  clearInterval(heartbeatInterval);
  const seatRef     = window.db.ref("games/" + GAME_ID + "/seats/" + color);
  const connectedAt = seatRef.child('connectedAt');
  seatRef.onDisconnect().remove();
  heartbeatInterval = setInterval(() => connectedAt.set(Date.now()), 10000);
}

// Belt-and-suspenders: also remove on normal tab close
window.addEventListener('beforeunload', () => {
  const color = getMyColor();
  if (!window.db || !color) return;
  window.db.ref("games/" + GAME_ID + "/seats/" + color).remove();
});

// Called once on page load — claims a color if seats are available
function claimSeat(onDone) {
  if (!window.db) { onDone(); return; }

  const myId = getSessionId();
  const me = window.currentUser || null;
  const profile = window.currentProfile || {};
  const seatData = () => ({
    id: myId,
    uid: me?.uid || myId,
    email: me?.email || '',
    name: String(profile.displayName || '').trim(),
    avatarDataUrl: profile.avatarDataUrl || '',
    reunionPartnerEmail: String(profile.reunionPartnerEmail || '').trim().toLowerCase(),
    reunionAt: Number.isFinite(Number(profile.reunionAt)) ? Number(profile.reunionAt) : null,
    connectedAt: Date.now()
  });
  const seatsRef = window.db.ref("games/" + GAME_ID + "/seats");
  startSeatsIdentityWatcher();

  seatsRef.once("value", snapshot => {
    const seats = snapshot.val() || {};

    // Already seated (returning tab within TTL window)?
    if (seats.w && seats.w.id === myId) {
      setMyColor('w');
      seatsRef.child('w').set(seatData());
      startHeartbeat('w');
      updatePlayerBanner(); applyPanelOrientation();
      watchShareBox();
      onDone();
      return;
    }
    if (seats.b && seats.b.id === myId) {
      setMyColor('b');
      seatsRef.child('b').set(seatData());
      startHeartbeat('b');
      updatePlayerBanner(); applyPanelOrientation();
      onDone();
      return;
    }

    // Claim white if the seat is empty or the previous occupant has gone
    if (!isSeatLive(seats.w)) {
      setMyColor('w');
      seatsRef.child('w').set(seatData());
      startHeartbeat('w');
      updatePlayerBanner(); applyPanelOrientation();
      watchShareBox();
      onDone();
      return;
    }

    // White is live — claim black if it's open
    if (!isSeatLive(seats.b)) {
      setMyColor('b');
      seatsRef.child('b').set(seatData());
      startHeartbeat('b');
      updatePlayerBanner(); applyPanelOrientation();
      onDone();
      return;
    }

    // Both seats live — spectator
    updatePlayerBanner();
    onDone();
  });
}

// Auto-flip board to match your color
function applyBoardOrientation() {
  const myColor = getMyColor();
  if (myColor === 'b' && !boardFlipped) flipBoard(state);
  if (myColor === 'w' && boardFlipped)  flipBoard(state);
}

// Put your own card at the bottom of the panel
function applyPanelOrientation() {
  const myColor = getMyColor();
  const panel = document.querySelector('.panel-left');
  if (!panel) return;
  // 'b' = Caro is viewing: show black card at bottom, white card at top
  panel.classList.toggle('viewer-black', myColor === 'b');
}

// Show a small "You are playing as X" banner
function updatePlayerBanner() {
  const myColor = getMyColor();
  const banner = document.getElementById('my-color-banner');
  if (!banner) return;
  if (!myColor) {
    banner.textContent = '👁 Spectating';
    banner.className = 'color-banner spectator';
  } else if (myColor === 'w') {
    banner.textContent = '♙ You are Paul (White)';
    banner.className = 'color-banner playing-white';
  } else {
    banner.textContent = '♟ You are Caro (Black)';
    banner.className = 'color-banner playing-black';
  }
  banner.classList.remove('hidden');
}

// Unique ID per browser — localStorage so it persists across new tabs,
// letting the same person reclaim their color when they reopen the link.
function getSessionId() {
  const uid = window.currentUser && window.currentUser.uid;
  if (uid) return uid;
  let id = localStorage.getItem('sessionId');
  if (!id) { id = Math.random().toString(36).slice(2); localStorage.setItem('sessionId', id); }
  return id;
}

// Listen for remote moves.
// Uses updatedAt as a version token — every real game action writes a new
// timestamp, so we apply the update; heartbeat writes to seats/*/connectedAt
// and never touch updatedAt, so those fire-and-return silently.
let lastAppliedUpdate = 0;
let lastCaptureAt = 0;
function listenToFirebase(stateRef, renderFn) {
  if (!window.db || isListening) return;
  isListening = true;

  window.db.ref("games/" + GAME_ID).on("value", snapshot => {
    const data = snapshot.val();
    if (!data || !data.board) return;

    // On the very first load, silently absorb timestamps so they don't trigger on page open
    const isFirstLoad = lastAppliedUpdate === 0;
    if (isFirstLoad && data.yappingToastAt) window._lastYappingToast = data.yappingToastAt;
    if (isFirstLoad && data.loveAt) window._lastLoveAt = data.loveAt;
    if (isFirstLoad && data.robotEvent) window.absorbRobotEvent?.(data.robotEvent);

    // Always check loveAt — it's written separately and doesn't update updatedAt
    if (!isFirstLoad && data.loveAt && data.loveAt > (window._lastLoveAt || 0)) {
      window._lastLoveAt = data.loveAt;
      if (typeof window.showLoveOverlay === 'function') window.showLoveOverlay();
    }

    // Robot events — synced separately, delivered to all clients
    if (!isFirstLoad && data.robotEvent) {
      window.onRobotEvent?.(data.robotEvent);
    }

    // Skip if we've already applied this version (our own write or a heartbeat)
    if (data.updatedAt && data.updatedAt <= lastAppliedUpdate) return;
    if (data.updatedAt) lastAppliedUpdate = data.updatedAt;

    // Show capture popup to the victim (the player whose piece was just taken)
    if (data.lastCapture && data.lastCapture.at > lastCaptureAt) {
      lastCaptureAt = data.lastCapture.at;
      if (data.lastCapture.color === getMyColor()) {
        showCapturePopup(data.lastCapture.type);
      }
    }

    // Apply remote state
    stateRef.board           = deserializeBoard(data.board);
    stateRef.turn            = data.turn;
    stateRef.enPassant       = data.enPassant || null;
    stateRef.castling        = data.castling  || { wK:true, wQ:true, bK:true, bQ:true };
    stateRef.capturedByWhite = data.capturedByWhite || [];
    stateRef.capturedByBlack = data.capturedByBlack || [];
    stateRef.lastMove        = data.lastMove  || null;
    stateRef.inCheck         = data.inCheck   || false;
    stateRef.gameOver        = data.gameOver  || false;
    stateRef.clocks          = data.clocks          || stateRef.clocks;
    stateRef.clockStartedAt  = data.clockStartedAt  || null;
    stateRef.result          = data.result || stateRef.result || null;
    stateRef.moveHistory     = data.moveHistory || [];

    if (typeof data.yappingPaused === 'boolean') setYappingPaused(data.yappingPaused);
    if (data.yappingToastAt && data.yappingToastAt > (window._lastYappingToast || 0)) {
      window._lastYappingToast = data.yappingToastAt;
      showYappingToast();
    }


    playSound('move');
    if (stateRef.inCheck) playSound('check');

    if (stateRef.gameOver) {
      clearInterval(clockInterval);
      maybeRecordMatchHistory(stateRef);
    } else {
      startClock(stateRef);
    }

    renderFn();
  });
}
