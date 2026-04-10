// ── WebRTC video chat ─────────────────────────────────────────────────────────
function gameRootPath() {
  const gid = (typeof window !== 'undefined' && window.GAME_ID) ? window.GAME_ID : '';
  return gid ? `games/${gid}` : 'games/__missing__';
}
function rtcPath() {
  return `${gameRootPath()}/webrtc`;
}
function camerasPath() {
  return `${gameRootPath()}/cameras`;
}
const ICE_SERVERS  = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
]};

let pc               = null;
let localStream      = null;
let pendingCandidates = [];
let offerInProgress  = false;
let cameraEnabled    = false;
let syncedExpanded   = { w: false, b: false };

function cardColor(card) {
  if (!card) return null;
  if (card.id === 'card-white') return 'w';
  if (card.id === 'card-black') return 'b';
  return null;
}

function setExpandedForColor(color, expanded) {
  if (!window.db || (color !== 'w' && color !== 'b')) return;
  window.db.ref(`${camerasPath()}/expanded/${color}`).set(!!expanded);
}

function applyExpandedForColor(color) {
  if (color !== 'w' && color !== 'b') return;
  const card = document.getElementById(color === 'w' ? 'card-white' : 'card-black');
  if (!card) return;
  const video = card.querySelector('.player-video');
  if (!video) return;

  const shouldExpand = !!syncedExpanded[color];
  if (!shouldExpand) {
    setCardVideoExpanded(card, false);
    return;
  }
  if (video.classList.contains('active')) {
    setCardVideoExpanded(card, true);
  }
}

function setCardVideoExpanded(card, expanded) {
  if (!card) return;
  if (expanded) {
    // On desktop the grid can under-report card width — use the panel width instead.
    // On mobile the panel is full-screen wide so keep the card's own offsetWidth.
    const panelEl = card.closest('.panel-left');
    const isMobile = window.innerWidth <= 600;
    const w = (!isMobile && panelEl) ? panelEl.clientWidth : card.offsetWidth;
    const h = card.offsetHeight;
    if (w > 0) {
      card.style.width = `${w}px`;
      card.style.minWidth = `${w}px`;
    }
    if (h > 0) {
      card.style.height = `${h}px`;
      card.style.minHeight = `${h}px`;
    }
  } else {
    card.style.width = '';
    card.style.minWidth = '';
    card.style.height = '';
    card.style.minHeight = '';
  }
  card.classList.toggle('video-extended', !!expanded);
  const btn = card.querySelector('.video-extend-btn');
  if (btn) {
    btn.textContent = expanded ? '⤡' : '⤢';
    btn.setAttribute('aria-label', expanded ? 'Minimize video' : 'Extend video');
    btn.title = expanded ? 'Minimize video' : 'Extend video';
  }
}

function showVideo(id, stream) {
  const el = document.getElementById(id);
  if (!el) return;
  el.srcObject = stream;
  el.muted = true;
  el.classList.add('active');
  if (id === 'video-white') applyExpandedForColor('w');
  if (id === 'video-black') applyExpandedForColor('b');
}

function hideVideo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.srcObject = null;
  el.classList.remove('active');
  const card = el.closest('.player-card');
  setCardVideoExpanded(card, false);
}

function closePc() {
  if (pc) { pc.close(); pc = null; }
  pendingCandidates = [];
}

async function initPc(myColor) {
  closePc();
  // Clear remote video on each new connection
  hideVideo(myColor === 'w' ? 'video-black' : 'video-white');
  // Show local video only if camera is on
  if (localStream) showVideo(myColor === 'w' ? 'video-white' : 'video-black', localStream);

  pc = new RTCPeerConnection(ICE_SERVERS);
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = e => {
    if (!e.streams[0]) return;
    showVideo(myColor === 'w' ? 'video-black' : 'video-white', e.streams[0]);
  };

  pc.onicecandidate = e => {
    if (e.candidate)
      window.db.ref(`${rtcPath()}/ice-${myColor}`).push(e.candidate.toJSON());
  };

  pc.onconnectionstatechange = () => {
    console.log('RTC state:', pc?.connectionState);
    if (pc?.connectionState === 'failed' || pc?.connectionState === 'disconnected') {
      if (getMyColor() === 'w' && cameraEnabled) setTimeout(() => doOffer(), 2000);
    }
  };
}

async function doOffer() {
  if (offerInProgress) return;
  offerInProgress = true;

  try {
    window.db.ref(`${rtcPath()}/answer`).off();
    window.db.ref(`${rtcPath()}/ice-b`).off();

    await initPc('w');

    await window.db.ref(rtcPath()).remove();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await window.db.ref(`${rtcPath()}/offer`).set({ type: offer.type, sdp: offer.sdp });

    window.db.ref(`${rtcPath()}/ice-b`).on('child_added', async snap => {
      const c = snap.val(); if (!c) return;
      if (pc?.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      else pendingCandidates.push(c);
    });

    window.db.ref(`${rtcPath()}/answer`).on('value', async snap => {
      const d = snap.val();
      if (!d || pc?.remoteDescription) return;
      await pc.setRemoteDescription(new RTCSessionDescription(d));
      for (const c of pendingCandidates) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      pendingCandidates = [];
    });
  } finally {
    offerInProgress = false;
  }
}

async function doAnswer() {
  window.db.ref(`${rtcPath()}/offer`).off();
  window.db.ref(`${rtcPath()}/ice-w`).off();

  window.db.ref(`${rtcPath()}/ice-w`).on('child_added', async snap => {
    const c = snap.val(); if (!c) return;
    if (pc?.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    else pendingCandidates.push(c);
  });

  // Re-answer every time Paul sends a new offer
  window.db.ref(`${rtcPath()}/offer`).on('value', async snap => {
    const d = snap.val(); if (!d) return;

    pendingCandidates = [];
    await initPc('b');

    await pc.setRemoteDescription(new RTCSessionDescription(d));

    const toFlush = [...pendingCandidates];
    pendingCandidates = [];
    for (const c of toFlush) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await window.db.ref(`${rtcPath()}/answer`).set({ type: answer.type, sdp: answer.sdp });
  });
}

// ── Camera toggle ─────────────────────────────────────────────────────────────

async function handleCameraToggle(btn) {
  cameraEnabled = !cameraEnabled;
  btn.classList.toggle('cam-active', cameraEnabled);

  const myColor = getMyColor();
  if (!myColor || !window.db) return;

  if (cameraEnabled) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (e) {
      console.warn('Camera unavailable:', e);
      cameraEnabled = false;
      btn.classList.remove('cam-active');
      return;
    }
  } else {
    // Stop local tracks and hide my video
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    hideVideo(myColor === 'w' ? 'video-white' : 'video-black');
    setExpandedForColor(myColor, false);
  }

  if (myColor === 'w') {
    // Paul re-offers with updated track state
    doOffer();
  } else {
    // Caro signals Paul to re-offer (so both sides renegotiate)
    window.db.ref(`${camerasPath()}/trigger`).set(Date.now());
  }
}

// ── Initialise ────────────────────────────────────────────────────────────────

function initWebRTC() {
  if (!window.db) { setTimeout(initWebRTC, 600); return; }
  const myColor = getMyColor();
  if (!myColor) { setTimeout(initWebRTC, 600); return; }

  if (myColor === 'b') {
    // Caro always listens for offers so she can receive Paul's video
    doAnswer();
  }

  if (myColor === 'w') {
    // Paul watches for Caro's camera toggle trigger
    let lastTrigger = null;
    window.db.ref(`${camerasPath()}/trigger`).on('value', snap => {
      const v = snap.val();
      if (lastTrigger === null) { lastTrigger = v; return; } // absorb stale value on load
      if (v && v !== lastTrigger) { lastTrigger = v; doOffer(); }
    });
  }

  // Keep each player's expanded-camera state in sync across both clients.
  window.db.ref(`${camerasPath()}/expanded`).on('value', snap => {
    const v = snap.val() || {};
    syncedExpanded.w = !!v.w;
    syncedExpanded.b = !!v.b;
    applyExpandedForColor('w');
    applyExpandedForColor('b');
  });

  // Start each fresh join with your own camera card unexpanded.
  setExpandedForColor(myColor, false);
}

function initVideoExtendControls() {
  const buttons = document.querySelectorAll('.video-extend-btn');
  buttons.forEach(btn => {
    btn.textContent = '⤢';
    btn.setAttribute('aria-label', 'Extend video');
    btn.title = 'Extend video';
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const card = btn.closest('.player-card');
      if (!card) return;
      const video = card.querySelector('.player-video');
      if (!video || !video.classList.contains('active')) return;

      const thisCardColor = cardColor(card);
      const myColor = getMyColor();
      const isLocalCard =
        !!localStream &&
        !!video.srcObject &&
        video.srcObject === localStream;
      // You can only control expansion for your own camera card.
      if (!(isLocalCard || (myColor && thisCardColor === myColor))) return;

      const shouldExpand = !card.classList.contains('video-extended');
      setCardVideoExpanded(card, shouldExpand);
      setExpandedForColor(thisCardColor, shouldExpand);
    });
  });
}

window.addEventListener('load', () => {
  const btn = document.getElementById('camera-btn');
  if (btn) btn.addEventListener('click', () => handleCameraToggle(btn));
  initVideoExtendControls();
  (async () => {
    if (window.appReadyPromise) await window.appReadyPromise;
    setTimeout(initWebRTC, 600);
  })();
});
