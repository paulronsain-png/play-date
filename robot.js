(function () {
  let worker = null;
  let busy = false;

  // ── Firebase sync layer ────────────────────────────────────────────────────
  // Only the white player (or whoever is unseated in local play) schedules
  // idle/whistle/blink events. All events are broadcast via Firebase so both
  // players see and hear exactly the same thing at the same time.
  let lastRobotEventAt = 0;

  function isRobotLeader() {
    if (!window.GAME_ID) return true;
    const myColor = typeof getMyColor === 'function' ? getMyColor() : null;
    return !myColor || myColor === 'w';
  }

  function broadcastRobotEvent(data) {
    const event = { ...data, at: Date.now() };
    lastRobotEventAt = event.at; // mark as handled so our own Firebase echo is ignored
    playRobotEvent(data);        // play locally right away
    if (window.db && window.GAME_ID) {
      window.db.ref('games/' + window.GAME_ID + '/robotEvent').set(event).catch(() => {});
    }
  }

  // Called by game.js Firebase listener when the remote side writes an event
  window.onRobotEvent = function(data) {
    if (!data || data.at <= lastRobotEventAt) return;
    lastRobotEventAt = data.at;
    playRobotEvent(data);
  };

  // Called on first load to absorb existing Firebase state without replaying it
  window.absorbRobotEvent = function(data) {
    if (data && data.at) lastRobotEventAt = data.at;
  };

  function playRobotEvent(data) {
    const btn = document.getElementById('btn-ask-robot');
    if (!btn) return;
    const lbl = btn.querySelector('.robot-btn-label');
    if      (data.type === 'idle')        _runIdleEmote(btn, data.cls, data.dur);
    else if (data.type === 'whistle')     _runWhistle(data.melodyIndex);
    else if (data.type === 'blink')       _runBlink(btn);
    else if (data.type === 'react')       _runReact(btn, data.reaction);
    else if (data.type === 'think-start') _runThinkStart(btn, lbl);
    else if (data.type === 'think-done')  _runThinkDone(btn, lbl);
  }

  function _runIdleEmote(btn, cls, dur) {
    if (busy) return;
    clearIdle();
    if (cls === 'robot-sleep') {
      btn.classList.add('robot-bored');
      beep(340, 'sine', 0.045, 1.4, 170);
      setTimeout(() => {
        btn.classList.remove('robot-bored');
        btn.classList.add('robot-sleep');
        sounds.sleep();
        setTimeout(() => {
          btn.classList.remove('robot-sleep');
          btn.classList.add('robot-sleep-wake');
          sounds.wake();
          setTimeout(() => { btn.classList.remove('robot-sleep-wake'); scheduleIdle(); }, 750);
        }, dur || 7000);
      }, 2000);
    } else {
      btn.classList.add(cls);
      if      (cls === 'robot-idle-bounce')    sounds.bounce();
      else if (cls === 'robot-idle-tilt')      sounds.tilt();
      else if (cls.startsWith('robot-wink'))   sounds.wink();
      setTimeout(() => { btn.classList.remove(cls); scheduleIdle(); }, dur || 2000);
    }
  }

  function _runBlink(btn) {
    const blocked = ['robot-thinking','robot-sleep','robot-love','robot-wink-l','robot-wink-r'];
    if (blocked.some(c => btn.classList.contains(c))) return;
    btn.classList.add('robot-blink');
    sounds.blink();
    setTimeout(() => btn.classList.remove('robot-blink'), 230);
  }

  function _runReact(btn, reaction) {
    clearIdle();
    busy = false; // clear any stuck busy state (e.g. after thinking)
    btn.classList.remove(...IDLE_CLASSES, 'robot-love', 'robot-move-happy', 'robot-excited', 'robot-thinking');
    void btn.offsetWidth;
    let cls, dur;
    if      (reaction === 'love')  { cls = 'robot-love';       dur = 2200; sounds.love(); }
    else if (reaction === 'happy') { cls = 'robot-excited';    dur = 1800; sounds.happy(); }
    else                           { cls = 'robot-move-happy'; dur = 1400; sounds.excited(); }
    btn.classList.add(cls);
    setTimeout(() => { btn.classList.remove(cls); scheduleIdle(); }, dur);
  }

  function _runThinkStart(btn, lbl) {
    clearIdle();
    busy = true;
    btn.classList.remove('robot-happy', 'robot-move-happy', 'robot-love', 'robot-excited', ...IDLE_CLASSES);
    btn.classList.add('robot-thinking');
    sounds.think();
    startThinkLabel(lbl);
  }

  function _runThinkDone(btn, lbl) {
    busy = false;
    stopThinkLabel(lbl);
    clearIdle();
    btn.classList.remove('robot-thinking', ...IDLE_CLASSES);
    void btn.offsetWidth;
    btn.classList.add('robot-happy');
    sounds.happy();
    setTimeout(() => { btn.classList.remove('robot-happy'); scheduleIdle(); }, 2000);
  }

  function _runWhistle(melodyIndex) {
    if (busy) return;
    const btn = document.getElementById('btn-ask-robot');
    const melody = MELODIES[melodyIndex];
    if (!melody) return;
    const GAP = 0.04;
    const totalSec = melody.reduce((s, [,d]) => s + d + GAP, 0.06);
    if (btn) btn.classList.add('robot-whistling');
    setTimeout(() => btn?.classList.remove('robot-whistling'), totalSec * 1000 + 200);
    if (!soundOn()) return;
    try {
      const ctx = audio();
      let t = ctx.currentTime + 0.06;
      melody.forEach(([freq, dur]) => {
        if (freq === 0) { t += dur; return; }
        const o   = ctx.createOscillator();
        const g   = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lg  = ctx.createGain();
        lfo.frequency.value = 5.5 + Math.random() * 2;
        lg.gain.value = 14;
        lfo.connect(lg); lg.connect(o.frequency);
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.08, t + 0.022);
        g.gain.setValueAtTime(0.08, t + dur - 0.03);
        g.gain.linearRampToValueAtTime(0.001, t + dur);
        lfo.start(t); lfo.stop(t + dur);
        o.start(t);   o.stop(t + dur);
        t += dur + GAP;
      });
    } catch(e) {}
  }

  // ── FEN generator ──────────────────────────────────────────────────────────
  function stateToFen(state) {
    const { board, turn, castling, enPassant, moveHistory } = state;

    const rows = [];
    for (let r = 0; r < 8; r++) {
      let row = '';
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) {
          empty++;
        } else {
          if (empty) { row += empty; empty = 0; }
          const letter = piece.type;
          row += piece.color === 'w' ? letter : letter.toLowerCase();
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }

    let castlingStr = '';
    if (castling.wK) castlingStr += 'K';
    if (castling.wQ) castlingStr += 'Q';
    if (castling.bK) castlingStr += 'k';
    if (castling.bQ) castlingStr += 'q';
    if (!castlingStr) castlingStr = '-';

    let epStr = '-';
    if (enPassant) {
      const [epR, epC] = enPassant;
      epStr = String.fromCharCode(97 + epC) + (8 - epR);
    }

    const fullmove = Math.floor((moveHistory?.length || 0) / 2) + 1;
    return `${rows.join('/')} ${turn} ${castlingStr} ${epStr} 0 ${fullmove}`;
  }

  // ── UCI coordinate → board [row, col] ─────────────────────────────────────
  function uciToSquare(sq) {
    return {
      r: 8 - parseInt(sq[1]),
      c: sq.charCodeAt(0) - 97
    };
  }

  // ── Move score label ───────────────────────────────────────────────────────
  function scoreLabel(suggestion) {
    if (suggestion.mate != null) {
      return suggestion.mate > 0 ? `Mate in ${suggestion.mate}` : `Mated in ${Math.abs(suggestion.mate)}`;
    }
    if (suggestion.score == null) return '';
    const abs = Math.abs(suggestion.score);
    const pawns = (abs / 100).toFixed(1);
    return suggestion.score >= 0 ? `+${pawns}` : `-${pawns}`;
  }

  // ── SVG arrow overlay ──────────────────────────────────────────────────────
  const NS = 'http://www.w3.org/2000/svg';

  const ARROW_COLORS = [
    { fill: 'rgba(218,185,65,0.88)'  }, // gold
    { fill: 'rgba(195,195,215,0.75)' }, // silver
    { fill: 'rgba(205,125,60,0.78)'  }  // bronze
  ];

  function getOrCreateArrowsSvg() {
    const board = document.getElementById('board');
    if (!board) return null;
    let svg = document.getElementById('robot-arrows');
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.id = 'robot-arrows';
      svg.setAttribute('viewBox', '0 0 8 8');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6';
      board.appendChild(svg);
    }
    return svg;
  }

  function clearArrows() {
    const svg = document.getElementById('robot-arrows');
    if (svg) svg.innerHTML = '';
  }

  function arrowPath(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return null;

    const ux = dx / len, uy = dy / len; // along arrow
    const px = -uy,      py =  ux;      // perpendicular (left)

    const shaftW  = 0.055; // half-width of shaft
    const headW   = 0.19;  // half-width of arrowhead base
    const headLen = 0.30;  // length of arrowhead

    // Tail starts slightly away from from-center
    const tailX = x1 + ux * 0.18;
    const tailY = y1 + uy * 0.18;

    // Shoulder = where shaft meets arrowhead base
    const shoulderX = x2 - ux * headLen;
    const shoulderY = y2 - uy * headLen;

    // 7-point arrow polygon (no overlap, single fill)
    const pts = [
      [tailX     + px * shaftW, tailY     + py * shaftW],
      [shoulderX + px * shaftW, shoulderY + py * shaftW],
      [shoulderX + px * headW,  shoulderY + py * headW ],
      [x2,                      y2                      ], // tip
      [shoulderX - px * headW,  shoulderY - py * headW ],
      [shoulderX - px * shaftW, shoulderY - py * shaftW],
      [tailX     - px * shaftW, tailY     - py * shaftW],
    ];

    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(' ') + ' Z';
  }

  function drawArrows(suggestions) {
    const svg = getOrCreateArrowsSvg();
    if (!svg) return;
    svg.innerHTML = '';

    const isFlipped = typeof window.isBoardFlipped === 'function' && window.isBoardFlipped();

    suggestions.forEach((s, i) => {
      const col = ARROW_COLORS[i] || ARROW_COLORS[2];

      let fromR = s.from.r, fromC = s.from.c;
      let toR   = s.to.r,   toC   = s.to.c;
      if (isFlipped) {
        fromR = 7 - fromR; fromC = 7 - fromC;
        toR   = 7 - toR;   toC   = 7 - toC;
      }

      const x1 = fromC + 0.5, y1 = fromR + 0.5;
      const x2 = toC   + 0.5, y2 = toR   + 0.5;

      const d = arrowPath(x1, y1, x2, y2);
      if (!d) return;

      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', col.fill);
      svg.appendChild(path);
    });
  }

  // ── Panel renderer ─────────────────────────────────────────────────────────
  function showRobotPanel(suggestions) {
    const panel = document.getElementById('robot-panel');
    if (!panel) return;

    // Remove previous move rows but keep the header
    panel.querySelectorAll('.robot-move-row').forEach(el => el.remove());

    const labels = ['1st', '2nd', '3rd'];
    suggestions.forEach((s, i) => {
      const label = scoreLabel(s);
      const row = document.createElement('div');
      row.className = 'robot-move-row';
      row.innerHTML = `<span class="robot-move-rank robot-rank-${i + 1}">${labels[i]}</span>
        <span class="robot-move-uci">${s.uci.slice(0,2)} → ${s.uci.slice(2,4)}</span>
        ${label ? `<span class="robot-move-score">${label}</span>` : ''}`;
      panel.appendChild(row);
    });

    panel.classList.remove('hidden');
  }

  function hideRobotPanel() {
    const panel = document.getElementById('robot-panel');
    if (panel) panel.classList.add('hidden');
    clearArrows();
  }

  window.clearRobotHints = hideRobotPanel;
  window.hideRobotPanel  = hideRobotPanel;

  // ── Sound system (Web Audio API) ───────────────────────────────────────────
  let _audioCtx = null;
  function audio() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  }
  function soundOn() {
    const t = document.getElementById('toggle-sound');
    return t ? t.checked : true;
  }

  function beep(freq, type, vol, dur, freqEnd, delay = 0) {
    if (!soundOn()) return;
    try {
      const ctx = audio();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = type || 'sine';
      const t0 = ctx.currentTime + delay;
      o.frequency.setValueAtTime(freq, t0);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur * 0.9);
      g.gain.setValueAtTime(0.001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.start(t0); o.stop(t0 + dur);
    } catch(e) {}
  }

  const sounds = {
    blink:   () => beep(1200, 'sine', 0.018, 0.06),
    think:   () => {
      // R2-D2 worried blips — rounder tones, musical intervals, less harsh
      const seq = [
        [520,'square',780,0.10],[0,0,0,0.05],
        [880,'sine',660,0.09],[440,'square',620,0.08],[0,0,0,0.06],
        [740,'square',520,0.10],[980,'sine',740,0.08],[0,0,0,0.07],
        [600,'square',900,0.09],[820,'sine',580,0.08],[520,'square',760,0.10],
        [0,0,0,0.08],
        [880,'square',640,0.09],[0,0,0,0.05],
        [560,'sine',840,0.11],[740,'square',500,0.09],[0,0,0,0.06],
        [660,'square',980,0.09],[500,'sine',720,0.10],[820,'square',560,0.08],
        [0,0,0,0.07],
        [940,'sine',680,0.10],[580,'square',860,0.09],[0,0,0,0.05],
        [720,'square',520,0.11],[860,'sine',620,0.10],
      ];
      let t = 0;
      seq.forEach(([freq, type, freqEnd, dur]) => {
        if (freq === 0) { t += dur; return; }
        beep(freq, type, 0.065, dur, freqEnd, t);
        t += dur + 0.032;
      });
      // Soft anxious undertone
      beep(160, 'sine', 0.025, 2.8, 120);
    },
    happy:   () => { [700,900,1100,1500].forEach((f,i) => beep(f,'sine',0.10,0.18,f*1.1,i*0.11)); },
    excited: () => { beep(500,'sine',0.09,0.15,900); beep(900,'sine',0.07,0.12,1200,0.16); },
    love: () => {
      if (!soundOn()) return;
      try {
        const ctx = audio();
        const t0 = ctx.currentTime + 0.04;
        // Robotic "Awwww" — descending sine sweep with LFO vibrato
        const o  = ctx.createOscillator();
        const g  = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lg  = ctx.createGain();
        lfo.frequency.value = 7;   // vibrato rate
        lg.gain.value = 22;        // vibrato depth (Hz)
        lfo.connect(lg); lg.connect(o.frequency);
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(460, t0);
        o.frequency.exponentialRampToValueAtTime(215, t0 + 1.5);
        g.gain.setValueAtTime(0.001, t0);
        g.gain.linearRampToValueAtTime(0.14, t0 + 0.10);
        g.gain.setValueAtTime(0.14, t0 + 1.2);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
        lfo.start(t0); lfo.stop(t0 + 1.6);
        o.start(t0);   o.stop(t0 + 1.6);
        // Warm harmonic layer (octave up, quieter)
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = 'triangle';
        o2.frequency.setValueAtTime(920, t0);
        o2.frequency.exponentialRampToValueAtTime(430, t0 + 1.5);
        g2.gain.setValueAtTime(0.001, t0);
        g2.gain.linearRampToValueAtTime(0.045, t0 + 0.10);
        g2.gain.setValueAtTime(0.045, t0 + 1.2);
        g2.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
        o2.connect(g2); g2.connect(ctx.destination);
        o2.start(t0); o2.stop(t0 + 1.6);
      } catch(e) {}
    },
    sleep:   () => { beep(320,'sine',0.06,1.6,130); },
    wake:    () => { beep(200,'sine',0.07,0.35,650); },
    bounce:  () => beep(380, 'sine', 0.04, 0.18, 420),
    tilt:    () => beep(260, 'sine', 0.03, 0.22, 240),
    wink:    () => beep(900, 'sine', 0.03, 0.10, 1100),
  };

  // ── Robotic whistling ──────────────────────────────────────────────────────
  // Notes: [freq, dur]. freq=0 = rest (silence, but time advances).
  // Gap of 0.04s is added between every note automatically.
  const MELODIES = [
    // 1 – R2-D2 adventure
    [[880,0.09],[1100,0.08],[1320,0.09],[1100,0.07],[880,0.08],[660,0.11],
     [0,0.14],
     [660,0.08],[880,0.08],[1100,0.12],[880,0.08],[1100,0.08],[1320,0.15],
     [0,0.12],
     [1100,0.07],[880,0.07],[660,0.07],[880,0.10],[1100,0.07],[1320,0.07],[1100,0.09],[880,0.20]],

    // 2 – Lonesome cowboy whistle
    [[520,0.22],[650,0.17],[780,0.28],[650,0.17],[520,0.32],
     [0,0.20],
     [650,0.20],[780,0.24],[980,0.32],[780,0.22],[650,0.22],[520,0.38],
     [0,0.22],
     [780,0.20],[980,0.22],[1170,0.30],[980,0.20],[780,0.20],[650,0.42]],

    // 3 – Bouncy cartoon staccato
    [[900,0.07],[700,0.07],[900,0.07],[700,0.07],[900,0.11],
     [0,0.10],
     [1100,0.07],[900,0.07],[700,0.07],[900,0.07],[1100,0.11],
     [0,0.10],
     [1300,0.07],[1100,0.07],[900,0.07],[700,0.07],[900,0.07],[1100,0.11],[1300,0.20],
     [0,0.12],
     [700,0.07],[900,0.07],[1100,0.07],[900,0.07],[700,0.22]],

    // 4 – Sad robot finds a friend
    [[680,0.24],[600,0.20],[520,0.28],[440,0.34],
     [0,0.22],
     [440,0.16],[520,0.16],[600,0.20],[520,0.16],[440,0.24],
     [0,0.24],
     [600,0.16],[700,0.16],[840,0.22],[700,0.16],[600,0.16],[520,0.32],
     [0,0.16],
     [700,0.13],[840,0.13],[1000,0.20],[840,0.13],[700,0.13],[600,0.38]],

    // 5 – Imperial fanfare parody
    [[440,0.19],[440,0.19],[440,0.19],[349,0.14],[523,0.07],[440,0.26],
     [0,0.12],
     [349,0.14],[523,0.07],[440,0.32],
     [0,0.14],
     [659,0.19],[659,0.19],[659,0.19],[698,0.14],[523,0.07],[415,0.20],
     [349,0.14],[523,0.07],[440,0.32]],

    // 6 – Scale runner up and down
    [[440,0.08],[494,0.08],[523,0.08],[587,0.08],[659,0.08],[698,0.08],[784,0.08],[880,0.14],
     [0,0.10],
     [880,0.08],[784,0.08],[698,0.08],[659,0.08],[587,0.08],[523,0.08],[494,0.08],[440,0.14],
     [0,0.12],
     [523,0.08],[659,0.08],[784,0.08],[1047,0.18],[784,0.10],[659,0.10],
     [523,0.08],[659,0.08],[784,0.08],[880,0.24]],

    // 7 – Gentle lullaby
    [[523,0.28],[659,0.22],[784,0.34],[659,0.22],[523,0.38],
     [0,0.24],
     [392,0.22],[440,0.22],[523,0.30],[440,0.22],[392,0.34],
     [0,0.22],
     [523,0.20],[587,0.20],[659,0.24],[587,0.20],[523,0.20],[494,0.22],[440,0.38]],

    // 8 – Excited R2 chatter
    [[1200,0.07],[800,0.07],[1000,0.07],[600,0.07],[1400,0.09],
     [0,0.09],
     [700,0.07],[1100,0.07],[900,0.07],[1300,0.07],[800,0.09],
     [0,0.09],
     [1000,0.07],[1200,0.07],[800,0.07],[1400,0.07],[600,0.07],[1000,0.11],
     [0,0.11],
     [800,0.09],[1000,0.09],[1200,0.11],[1000,0.09],[800,0.09],[600,0.20],
     [0,0.10],
     [900,0.07],[1100,0.07],[1300,0.09],[1100,0.07],[900,0.07],[700,0.28]],

    // 9 – Star Wars main theme
    // G  G  G  Eb  Bb | G  Eb  Bb  G(long)
    // D5 D5 D5 Eb5 Bb | F# Eb  Bb  G(long)
    [[392,0.20],[392,0.20],[392,0.20],[311,0.13],[466,0.07],
     [392,0.22],[311,0.13],[466,0.07],[392,0.36],
     [0,0.16],
     [587,0.20],[587,0.20],[587,0.20],[622,0.13],[466,0.07],
     [370,0.22],[311,0.13],[466,0.07],[392,0.36],
     [0,0.18],
     [523,0.20],[392,0.13],[392,0.07],[523,0.22],[494,0.36],
     [0,0.14],
     [466,0.13],[415,0.07],[392,0.22],[311,0.13],[466,0.07],[392,0.42]],

    // 10 – Harry Potter (Hedwig's Theme)
    // B4  E5  G5  F#5 E5  B5  A5  | F#5 E5  G5  D#5(long)
    // C#5 C5  B4  Bb4 E5  G#4 A4(long)
    [[494,0.22],
     [0,0.08],
     [659,0.11],[784,0.11],[740,0.13],[659,0.18],
     [988,0.13],[0,0.06],[880,0.34],
     [0,0.16],
     [740,0.11],[659,0.11],[784,0.11],[622,0.36],
     [0,0.18],
     [554,0.11],[523,0.11],[494,0.11],[466,0.13],
     [659,0.16],[415,0.11],[440,0.36],
     [0,0.16],
     [494,0.22],
     [0,0.08],
     [659,0.11],[784,0.11],[740,0.13],[659,0.18],
     [988,0.22],[1047,0.11],[988,0.11],[880,0.11],[784,0.38]],

    // 11 – Spider-Man theme
    // "Spider-Man, Spider-Man, does whatever a spider can"
    [[392,0.16],[330,0.11],[392,0.24],   // Spi-der-Man
     [0,0.07],
     [392,0.16],[330,0.11],[392,0.24],   // Spi-der-Man
     [0,0.08],
     [440,0.13],[392,0.11],[330,0.11],[294,0.11],[330,0.11],[392,0.13],[330,0.24], // does-what-ev-er-a-spi-der-can
     [0,0.20],
     // "Spins a web any size, catches thieves just like flies"
     [392,0.13],[330,0.11],[392,0.16],[440,0.13],[466,0.18],[440,0.30],
     [0,0.10],
     [392,0.13],[330,0.11],[392,0.16],[440,0.13],[392,0.13],[330,0.30],
     [0,0.20],
     // "Look out! Here comes the Spider-Man"
     [392,0.16],[440,0.16],[466,0.20],[440,0.13],[392,0.11],[330,0.11],[392,0.13],[440,0.40]],
  ];

  // ── Idle animation system ─────────────────────────────────────────────────
  const IDLE_POOL = [
    { cls: 'robot-idle-bounce', dur: 1900,  weight: 30 },
    { cls: 'robot-idle-tilt',   dur: 2500,  weight: 25 },
    { cls: 'robot-wink-l',      dur: 1400,  weight: 18 },
    { cls: 'robot-wink-r',      dur: 1400,  weight: 18 },
    { cls: 'robot-sleep',       dur: 7000,  weight: 9  },
  ];
  const IDLE_CLASSES = IDLE_POOL.map(e => e.cls).concat(['robot-sleep-wake', 'robot-bored']);

  let idleTimeout = null;
  function clearIdle() { clearTimeout(idleTimeout); idleTimeout = null; }

  function scheduleIdle() {
    clearIdle();
    if (busy) return;
    if (!isRobotLeader()) return; // only leader schedules idle events
    idleTimeout = setTimeout(() => {
      if (busy) { scheduleIdle(); return; }
      const total = IDLE_POOL.reduce((s, e) => s + e.weight, 0);
      let r = Math.random() * total;
      const emote = IDLE_POOL.find(e => (r -= e.weight) <= 0) || IDLE_POOL[0];
      broadcastRobotEvent({ type: 'idle', cls: emote.cls, dur: emote.dur });
    }, 5000 + Math.random() * 9000);
  }

  // ── Whistle scheduler ─────────────────────────────────────────────────────
  let whistleTimer = null;
  function scheduleWhistle() {
    clearTimeout(whistleTimer);
    whistleTimer = setTimeout(() => {
      if (!busy && isRobotLeader()) {
        broadcastRobotEvent({ type: 'whistle', melodyIndex: Math.floor(Math.random() * MELODIES.length) });
      }
      scheduleWhistle();
    }, 25000 + Math.random() * 35000);
  }
  setTimeout(scheduleWhistle, 20000);

  // ── Blink scheduler ───────────────────────────────────────────────────────
  let blinkTimer = null;
  function scheduleBlink() {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      if (isRobotLeader()) broadcastRobotEvent({ type: 'blink' });
      scheduleBlink();
    }, 3500 + Math.random() * 5000);
  }
  setTimeout(scheduleBlink, 2500);

  // ── Robot reactions (called by game code on move/love/ask) ─────────────────
  window.walleReact = function (type) {
    const btn = document.getElementById('btn-ask-robot');
    if (!btn || busy) return;
    broadcastRobotEvent({ type: 'react', reaction: type });
  };

  // Start idle loop after a short warm-up
  setTimeout(scheduleIdle, 4000);

  // ── Thinking label cycling ─────────────────────────────────────────────────
  const THINK_WORDS = ['Baking', 'Cooking', 'Cogitating', 'Overthinking', 'Contemplating', 'Manifesting', 'Transmuting', 'Imagining', 'Ideating', 'Procrastinating', 'Roboting', 'R2-D2ing', 'WALL•Eing'];
  let thinkTimer = null;

  function startThinkLabel(lbl) {
    if (!lbl) return;
    let queue = [];
    const pick = () => {
      if (queue.length === 0) queue = [...THINK_WORDS].sort(() => Math.random() - 0.5);
      lbl.textContent = queue.shift() + '...';
    };
    pick();
    thinkTimer = setInterval(pick, 1600);
  }

  function stopThinkLabel(lbl) {
    clearInterval(thinkTimer);
    thinkTimer = null;
    if (lbl) lbl.textContent = 'Ask';
  }

  // ── Main API ───────────────────────────────────────────────────────────────
  window.askRobot = function (state, onDone) {
    if (busy) return;

    const btn = document.getElementById('btn-ask-robot');
    if (!btn) return;

    // Broadcast think-start so both players see the thinking animation
    btn.disabled = true;
    broadcastRobotEvent({ type: 'think-start' });
    hideRobotPanel();

    if (!worker) worker = new Worker('stockfish.js');

    const fen = stateToFen(state);
    const pvs = {};

    worker.onmessage = (e) => {
      const line = typeof e === 'string' ? e : e.data;
      if (typeof line !== 'string') return;

      const mpvM   = line.match(/multipv (\d+)/);
      const pvM    = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
      const depthM = line.match(/\bdepth (\d+)/);
      const cpM    = line.match(/score cp (-?\d+)/);
      const mateM  = line.match(/score mate (-?\d+)/);

      if (mpvM && pvM) {
        const idx   = parseInt(mpvM[1]) - 1;
        const depth = depthM ? parseInt(depthM[1]) : 0;
        if (!pvs[idx] || depth >= (pvs[idx].depth || 0)) {
          pvs[idx] = {
            uci:   pvM[1],
            depth,
            score: cpM   ? parseInt(cpM[1])   : null,
            mate:  mateM ? parseInt(mateM[1]) : null
          };
        }
      }

      if (line.startsWith('bestmove')) {
        worker.onmessage = null;

        const results = [0, 1, 2]
          .filter(i => pvs[i])
          .map(i => ({
            uci:   pvs[i].uci,
            from:  uciToSquare(pvs[i].uci.slice(0, 2)),
            to:    uciToSquare(pvs[i].uci.slice(2, 4)),
            score: pvs[i].score,
            mate:  pvs[i].mate
          }));

        // 3-second "thinking" pause before revealing
        setTimeout(() => {
          btn.disabled = false;
          broadcastRobotEvent({ type: 'think-done' });
          drawArrows(results);
          showRobotPanel(results);
          if (onDone) onDone(results);
        }, 3000);
      }
    };

    worker.onerror = () => {
      worker = null;
      busy = false;
      const lbl = btn.querySelector('.robot-btn-label');
      stopThinkLabel(lbl);
      btn.disabled = false;
      btn.classList.remove('robot-thinking', ...IDLE_CLASSES);
      scheduleIdle();
    };

    worker.postMessage('uci');
    worker.postMessage('setoption name MultiPV value 3');
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage('go depth 14');
  };
})();
