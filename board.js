let boardFlipped = false;

function renderCoords() {
  const ranks = ['8','7','6','5','4','3','2','1'];
  const left  = document.getElementById('coords-left');
  const right = document.getElementById('coords-right');
  left.innerHTML = ''; right.innerHTML = '';
  const displayRanks = boardFlipped ? [...ranks].reverse() : ranks;
  for (const r of displayRanks) {
    const sl = document.createElement('span'); sl.textContent = r; left.appendChild(sl);
    const sr = document.createElement('span'); sr.textContent = r; right.appendChild(sr);
  }
}

function renderBoard(state) {
  const el = document.getElementById('board');
  el.innerHTML = '';
  renderCoords();

  const showHints = document.getElementById('toggle-hints').checked;
  const legalTargets = new Set(
    (state.selected
      ? getLegalMoves(state.board, state.selected[0], state.selected[1], state.enPassant, state.castling)
      : []
    ).map(m => m.to[0]*8+m.to[1])
  );

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      // Fix orientation: white pieces at bottom by default
      const r = boardFlipped ? 7 - row : row;
      const c = boardFlipped ? 7 - col : col;

      const sq = document.createElement('div');
      sq.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
      sq.dataset.r = r;
      sq.dataset.c = c;

      if (state.lastMove) {
        const [fr,fc,tr,tc] = state.lastMove;
        if ((r===fr&&c===fc)||(r===tr&&c===tc)) sq.classList.add('last-move');
      }
      if (state.selected && state.selected[0]===r && state.selected[1]===c)
        sq.classList.add('selected');
      if (showHints && legalTargets.has(r*8+c)) {
        sq.classList.add(state.board[r][c] ? 'hint-capture' : 'hint-move');
      }
      if (state.inCheck) {
        const king = findKing(state.board, state.turn);
        if (king && king[0]===r && king[1]===c) sq.classList.add('in-check');
      }

      const piece = state.board[r][c];
      if (piece) {
        const span = document.createElement('span');
        const toneClass = piece.color === 'w' ? 'piece-white' : 'piece-black';
        span.className = `piece ${toneClass}${piece.type === 'K' ? ' piece-king' : ''}`;
        span.textContent = SYMBOLS[piece.color + piece.type] || '?';
        span.dataset.r = r;
        span.dataset.c = c;
        sq.appendChild(span);
      }

      el.appendChild(sq);
    }
  }
}

function flipBoard(state) {
  boardFlipped = !boardFlipped;
  renderBoard(state);
}

function renderCaptured(capturedByWhite, capturedByBlack) {
  const PTS   = { Q:9, R:5, B:3, N:3, P:1 };
  const order = ['Q','R','B','N','P'];

  const fmt = (arr, color) =>
    order.flatMap(t => arr.filter(p => p === t).map(() => SYMBOLS[color + t])).join('');

  document.getElementById('captured-by-white').textContent = fmt(capturedByWhite, 'b');
  document.getElementById('captured-by-black').textContent = fmt(capturedByBlack, 'w');

  const scoreWhite = capturedByWhite.reduce((s, t) => s + (PTS[t] || 0), 0);
  const scoreBlack = capturedByBlack.reduce((s, t) => s + (PTS[t] || 0), 0);
  const diff = scoreWhite - scoreBlack;
  window.currentDiff = diff;

  const advWhite = document.getElementById('adv-white');
  const advBlack = document.getElementById('adv-black');

  advWhite.classList.add('hidden');
  advBlack.classList.add('hidden');

  if (diff > 0) {
    advWhite.textContent = '+' + diff;
    advWhite.classList.remove('hidden');
  } else if (diff < 0) {
    advBlack.textContent = '+' + Math.abs(diff);
    advBlack.classList.remove('hidden');
  }

  // Toggle Paul's speech bubbles based on advantage
  const paulWinning = document.getElementById('paul-winning');
  const paulLosing  = document.getElementById('paul-losing');

  if (paulWinning && paulLosing) {
    if (diff > 0) {
      // Paul (white) is winning
      paulWinning.classList.remove('hidden');
      paulLosing.classList.add('hidden');
    } else if (diff < 0) {
      // Paul is losing
      paulWinning.classList.add('hidden');
      paulLosing.classList.remove('hidden');
    } else {
      // equal position
      paulWinning.classList.add('hidden');
      paulLosing.classList.add('hidden');
    }
  }
}

function renderStatus(state) {
  const dot  = document.querySelector('.turn-dot');
  const txt  = document.getElementById('turn-text');
  const check = document.getElementById('check-alert');

  dot.className = 'turn-dot ' + (state.turn === 'w' ? 'white-dot' : 'black-dot');
  const playerNames = typeof window.getPlayerNames === 'function'
    ? window.getPlayerNames()
    : { w: "Paul", b: "Caro" };
  txt.textContent = `${playerNames[state.turn]}'s Turn`;

  if (state.inCheck && !state.gameOver) check.classList.remove('hidden');
  else check.classList.add('hidden');

  document.getElementById('card-white').classList.toggle('active', state.turn==='w' && !state.gameOver);
  document.getElementById('card-black').classList.toggle('active', state.turn==='b' && !state.gameOver);
  
  // Ensure Paul's speech bubbles update based on current advantage
  try {
    const diff = window.currentDiff || 0;

    const paulWinning = document.getElementById('paul-winning');
    const paulLosing  = document.getElementById('paul-losing');

    if (paulWinning && paulLosing) {
      if (diff > 0) {
        paulWinning.classList.remove('hidden');
        paulLosing.classList.add('hidden');
      } else if (diff < 0) {
        paulWinning.classList.add('hidden');
        paulLosing.classList.remove('hidden');
      } else {
        paulWinning.classList.add('hidden');
        paulLosing.classList.add('hidden');
      }
    }
  } catch (e) {}
}
