// ─── Piece symbols ──────────────────────────────────────────────────────────
const SYMBOLS = {
  wK:'♥\uFE0E', wQ:'♛\uFE0E', wR:'♜\uFE0E', wB:'♝\uFE0E', wN:'♞\uFE0E', wP:'♟\uFE0E',
  bK:'♥\uFE0E', bQ:'♛\uFE0E', bR:'♜\uFE0E', bB:'♝\uFE0E', bN:'♞\uFE0E', bP:'♟\uFE0E'
};

// ─── Initial board position ─────────────────────────────────────────────────
function initialBoard() {
  const b = Array(8).fill(null).map(() => Array(8).fill(null));
  const backRank = ['R','N','B','Q','K','B','N','R'];
  for (let c = 0; c < 8; c++) {
    b[0][c] = { color:'b', type: backRank[c] };
    b[1][c] = { color:'b', type:'P' };
    b[6][c] = { color:'w', type:'P' };
    b[7][c] = { color:'w', type: backRank[c] };
  }
  return b;
}

// ─── Deep copy board ────────────────────────────────────────────────────────
function copyBoard(board) {
  return board.map(row => row.map(sq => sq ? {...sq} : null));
}

// ─── Get raw moves (ignoring check) ─────────────────────────────────────────
function getRawMoves(board, r, c, enPassant, castling) {
  const piece = board[r][c];
  if (!piece) return [];
  const { color, type } = piece;
  const moves = [];
  const opp = color === 'w' ? 'b' : 'w';

  const add = (tr, tc, flags={}) => {
    if (tr >= 0 && tr < 8 && tc >= 0 && tc < 8) {
      moves.push({ from:[r,c], to:[tr,tc], ...flags });
    }
  };
  const slide = (dr, dc) => {
    let nr = r+dr, nc = c+dc;
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      if (board[nr][nc]) {
        if (board[nr][nc].color === opp) add(nr, nc);
        break;
      }
      add(nr, nc);
      nr += dr; nc += dc;
    }
  };

  if (type === 'P') {
    const dir = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;
    // Forward
    if (!board[r+dir]?.[c]) {
      add(r+dir, c, { promo: (r+dir===0||r+dir===7) });
      if (r === startRow && !board[r+2*dir]?.[c])
        add(r+2*dir, c, { doublePush: true });
    }
    // Captures
    for (const dc of [-1,1]) {
      const nc = c+dc, nr = r+dir;
      if (nc>=0 && nc<8 && board[nr]?.[nc]?.color === opp)
        add(nr, nc, { promo: (nr===0||nr===7) });
      // En passant
      if (enPassant && nr===enPassant[0] && nc===enPassant[1])
        add(nr, nc, { enPassant: true });
    }
  }

  if (type === 'N') {
    for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      const nr=r+dr, nc=c+dc;
      if (nr>=0&&nr<8&&nc>=0&&nc<8&&board[nr][nc]?.color!==color) add(nr,nc);
    }
  }
  if (type === 'B') { for(const d of [[-1,-1],[-1,1],[1,-1],[1,1]]) slide(...d); }
  if (type === 'R') { for(const d of [[-1,0],[1,0],[0,-1],[0,1]]) slide(...d); }
  if (type === 'Q') { for(const d of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) slide(...d); }

  if (type === 'K') {
    for (const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      const nr=r+dr, nc=c+dc;
      if (nr>=0&&nr<8&&nc>=0&&nc<8&&board[nr][nc]?.color!==color) add(nr,nc);
    }
    // Castling
    if (castling) {
      const ks = color==='w' ? 'wK' : 'bK';
      const qs = color==='w' ? 'wQ' : 'bQ';
      if (castling[ks] && !board[r][c+1] && !board[r][c+2] && board[r][c+3]?.type==='R')
        add(r, c+2, { castle:'K' });
      if (castling[qs] && !board[r][c-1] && !board[r][c-2] && !board[r][c-3] && board[r][c-4]?.type==='R')
        add(r, c-2, { castle:'Q' });
    }
  }
  return moves;
}

// ─── Find king position ──────────────────────────────────────────────────────
function findKing(board, color) {
  for (let r=0;r<8;r++) for (let c=0;c<8;c++)
    if (board[r][c]?.type==='K' && board[r][c]?.color===color) return [r,c];
  return null;
}

// ─── Is square attacked by color ────────────────────────────────────────────
function isAttacked(board, r, c, byColor) {
  for (let rr=0;rr<8;rr++) for (let cc=0;cc<8;cc++) {
    if (board[rr][cc]?.color !== byColor) continue;
    const moves = getRawMoves(board, rr, cc, null, null);
    if (moves.some(m => m.to[0]===r && m.to[1]===c)) return true;
  }
  return false;
}

// ─── Apply a move to a board copy ────────────────────────────────────────────
function applyMove(board, move, castling) {
  const nb = copyBoard(board);
  const piece = nb[move.from[0]][move.from[1]];
  nb[move.to[0]][move.to[1]] = piece;
  nb[move.from[0]][move.from[1]] = null;

  if (move.enPassant) {
    const dir = piece.color==='w' ? 1 : -1;
    nb[move.to[0]+dir][move.to[1]] = null;
  }
  if (move.castle) {
    const r = move.from[0];
    if (move.castle==='K') {
      nb[r][5] = nb[r][7]; nb[r][7] = null;
    } else {
      nb[r][3] = nb[r][0]; nb[r][0] = null;
    }
  }
  return nb;
}

// ─── Legal moves (no self-check) ────────────────────────────────────────────
function getLegalMoves(board, r, c, enPassant, castling) {
  const piece = board[r][c];
  if (!piece) return [];
  const raw = getRawMoves(board, r, c, enPassant, castling);
  return raw.filter(move => {
    // Validate castling squares not under attack
    if (move.castle) {
      const opp = piece.color==='w' ? 'b' : 'w';
      const row = move.from[0];
      const passCol = move.castle==='K' ? [5,6] : [2,3];
      if (isAttacked(board, row, move.from[1], opp)) return false;
      for (const col of passCol)
        if (isAttacked(board, row, col, opp)) return false;
    }
    const nb = applyMove(board, move, castling);
    const king = findKing(nb, piece.color);
    if (!king) return false;
    const opp = piece.color==='w' ? 'b' : 'w';
    return !isAttacked(nb, king[0], king[1], opp);
  });
}

// ─── All legal moves for a color ────────────────────────────────────────────
function getAllLegalMoves(board, color, enPassant, castling) {
  const moves = [];
  for (let r=0;r<8;r++) for (let c=0;c<8;c++)
    if (board[r][c]?.color===color)
      moves.push(...getLegalMoves(board, r, c, enPassant, castling));
  return moves;
}

// ─── Is in check ────────────────────────────────────────────────────────────
function isInCheck(board, color) {
  const king = findKing(board, color);
  if (!king) return false;
  const opp = color==='w' ? 'b' : 'w';
  return isAttacked(board, king[0], king[1], opp);
}

// ─── Move to algebraic notation ─────────────────────────────────────────────
function moveToNotation(board, move, piece, captured, isCheckmate, isCheck) {
  const files = 'abcdefgh';
  const ranks = '87654321';
  const [tr, tc] = move.to;
  const [fr, fc] = move.from;

  if (move.castle === 'K') return isCheckmate ? 'O-O#' : isCheck ? 'O-O+' : 'O-O';
  if (move.castle === 'Q') return isCheckmate ? 'O-O-O#' : isCheck ? 'O-O-O+' : 'O-O-O';

  let notation = '';
  if (piece.type !== 'P') {
    notation += piece.type;
    // Disambiguation
    let ambiguous = false, sameFile = false, sameRank = false;
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
      if (r===fr && c===fc) continue;
      const p = board[r][c];
      if (!p || p.type!==piece.type || p.color!==piece.color) continue;
      const others = getRawMoves(board, r, c, null, null);
      if (others.some(m => m.to[0]===tr && m.to[1]===tc)) {
        ambiguous = true;
        if (c===fc) sameFile = true;
        if (r===fr) sameRank = true;
      }
    }
    if (ambiguous) {
      if (!sameFile) notation += files[fc];
      else if (!sameRank) notation += ranks[fr];
      else notation += files[fc] + ranks[fr];
    }
  }
  if (captured || move.enPassant) {
    if (piece.type==='P') notation += files[fc];
    notation += 'x';
  }
  notation += files[tc] + ranks[tr];
  if (move.promo) notation += '=Q'; // default shown; will be updated
  if (isCheckmate) notation += '#';
  else if (isCheck) notation += '+';
  return notation;
}

// ─── Simple AI (minimax depth 2) ────────────────────────────────────────────
const PIECE_VALUES = { P:1, N:3, B:3, R:5, Q:9, K:0 };

function evaluateBoard(board) {
  let score = 0;
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    const p = board[r][c];
    if (!p) continue;
    const val = PIECE_VALUES[p.type] || 0;
    score += p.color==='w' ? val : -val;
  }
  return score;
}

function minimax(board, depth, isMax, alpha, beta, enPassant, castling) {
  if (depth === 0) return evaluateBoard(board);
  const color = isMax ? 'w' : 'b';
  const moves = getAllLegalMoves(board, color, enPassant, castling);
  if (moves.length === 0) {
    if (isInCheck(board, color)) return isMax ? -1000 : 1000;
    return 0;
  }
  let best = isMax ? -Infinity : Infinity;
  for (const move of moves) {
    const nb = applyMove(board, move, castling);
    const val = minimax(nb, depth-1, !isMax, alpha, beta, null, castling);
    if (isMax) { best = Math.max(best, val); alpha = Math.max(alpha, best); }
    else        { best = Math.min(best, val); beta  = Math.min(beta,  best); }
    if (beta <= alpha) break;
  }
  return best;
}

function getBestMove(board, enPassant, castling) {
  const moves = getAllLegalMoves(board, 'b', enPassant, castling);
  let best = null, bestVal = Infinity;
  for (const move of moves) {
    const nb = applyMove(board, move, castling);
    const val = minimax(nb, 2, true, -Infinity, Infinity, null, castling);
    if (val < bestVal) { bestVal = val; best = move; }
  }
  return best;
}
