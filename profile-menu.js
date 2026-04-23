(function () {
  function byId(id) {
    return document.getElementById(id);
  }

  const wrap = byId('profile-menu-wrap');
  const btn = byId('profile-btn');
  const menu = byId('profile-menu');
  const btnAvatar = byId('profile-btn-avatar');
  const menuAvatar = byId('profile-menu-avatar');
  const menuName = byId('profile-menu-name');
  const menuEmail = byId('profile-menu-email');
  const nameInput = byId('profile-menu-name-input');
  const avatarInput = byId('profile-menu-avatar-input');
  const partnerEmailInput = byId('profile-menu-partner-email');
  const reunionAtInput = byId('profile-menu-reunion-at');
  const avatarPreview = byId('profile-menu-avatar-preview');
  const saveProfileBtn = byId('profile-save-btn-menu');
  const historyList = byId('profile-history-list');
  const statusEl = byId('profile-menu-status');
  const logoutBtn = byId('profile-logout-btn');
  const changePwdBtn = byId('profile-change-password-btn');
  const invitePartnerBtn = byId('profile-invite-partner-btn');

  if (!wrap || !btn || !menu) return;

  function defaultAvatar(name) {
    if (typeof window.makeDefaultAvatarDataUri === 'function') {
      return window.makeDefaultAvatarDataUri(name || 'Player');
    }
    return 'icon.png';
  }

  function setStatus(text, ok) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.classList.toggle('ok', !!ok);
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function parseReunionAt(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d{10,14}$/.test(raw)) {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  function toDateTimeLocalValue(ms) {
    if (!ms || !Number.isFinite(ms)) return '';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function buildReunionConfig(partnerEmail, reunionAt) {
    const p = normalizeEmail(partnerEmail);
    const r = parseReunionAt(reunionAt);
    const hasOne = !!p || !!r;
    if (!hasOne) return { ok: true, partnerEmail: '', reunionAt: null };
    if (!p || !r) {
      return { ok: false, error: 'Fill both partner email and reunion date/time, or leave both empty.' };
    }
    return { ok: true, partnerEmail: p, reunionAt: r };
  }

  async function fileToAvatarDataUrl(file) {
    if (!file) return null;
    const raw = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = raw;
    });
    const maxSide = 320;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.84);
  }

  function closeMenu() {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    setStatus('');
  }

  function openMenu() {
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    hydrateProfileUI();
    initAvatarCreator();
    loadHistory();
  }

  function toggleMenu() {
    if (menu.classList.contains('hidden')) openMenu();
    else closeMenu();
  }

  function formatTime(ts) {
    if (!Number.isFinite(ts)) return '';
    try {
      return new Date(ts).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch (_) {
      return '';
    }
  }

  function renderHistoryItem(item) {
    const row = document.createElement('div');
    row.className = 'profile-history-item';
    const outcome = String(item.outcome || 'draw').toLowerCase();
    const reason = String(item.reason || 'game').replace(/_/g, ' ');
    const opponent = item.opponentName || 'Opponent';
    const mode = item.mode === 'vs_robot' ? 'vs Robot' : 'PvP';
    const when = formatTime(Number(item.at));

    const line1 = document.createElement('div');
    line1.className = 'profile-history-line1';
    line1.innerHTML = `<span>${opponent}</span><span class="profile-history-result ${outcome}">${outcome}</span>`;

    const line2 = document.createElement('div');
    line2.className = 'profile-history-line2';
    line2.textContent = `${mode} • ${reason}${when ? ` • ${when}` : ''}`;

    row.appendChild(line1);
    row.appendChild(line2);
    return row;
  }

  async function loadHistory() {
    const db = window.db;
    const user = window.currentUser;
    if (!historyList) return;
    historyList.innerHTML = '';
    if (!db || !user?.uid) {
      const empty = document.createElement('div');
      empty.className = 'profile-history-line2';
      empty.textContent = 'No match history yet.';
      historyList.appendChild(empty);
      return;
    }

    try {
      const snap = await db.ref(`users/${user.uid}/matchHistory`).once('value');
      const raw = snap.val() || {};
      const items = Object.values(raw)
        .filter(v => v && typeof v === 'object')
        .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
        .slice(0, 20);

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'profile-history-line2';
        empty.textContent = 'No matches yet. Play one and it will appear here.';
        historyList.appendChild(empty);
        return;
      }

      items.forEach(item => historyList.appendChild(renderHistoryItem(item)));
    } catch (err) {
      const errorLine = document.createElement('div');
      errorLine.className = 'profile-history-line2';
      errorLine.textContent = 'Could not load match history right now.';
      historyList.appendChild(errorLine);
      console.warn('History load failed:', err);
    }
  }

  // ── Avatar creator ────────────────────────────────────────────────────────────
  let avatarCfg = { skin:'#f5c99a', hair:'#3a1a08', top:'#2a5caa', bot:'#1a2a50', hat:'none', hatColor:'#cc2020' };
  let avatarRaf = null;
  let avatarListenersAdded = false;

  function drawAvatarToCanvas(canvas, cfg, swing) {
    const ctx = canvas.getContext('2d');
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    // Dark background
    ctx.fillStyle = '#1a2a1a';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, cw, ch, 8);
    else ctx.rect(0, 0, cw, ch);
    ctx.fill();

    const r = 18, px = cw / 2, py = ch * 0.62;
    const {skin, hair, top: topC, bot, hat, hatColor} = cfg;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(px + 1, py + r*0.6, r*0.75, r*0.22, 0, 0, Math.PI*2); ctx.fill();
    // Legs
    for (const [side, sign] of [[-1,-1],[1,1]]) {
      ctx.save(); ctx.translate(px + side*r*0.22, py + r*0.28); ctx.rotate(sign*swing);
      ctx.fillStyle = bot; ctx.fillRect(-r*0.18, 0, r*0.36, r*0.75);
      ctx.fillStyle = '#222'; ctx.fillRect(-r*0.2, r*0.68, r*0.4, r*0.16);
      ctx.restore();
    }
    // Torso
    ctx.fillStyle = topC; ctx.fillRect(px - r*0.48, py - r*0.28, r*0.96, r*0.6);
    // Arms
    for (const [side, sign] of [[-1,1],[1,-1]]) {
      ctx.save(); ctx.translate(px + side*r*0.55, py - r*0.18); ctx.rotate(sign*swing*0.85);
      ctx.fillStyle = topC; ctx.fillRect(-r*0.15, 0, r*0.3, r*0.58);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, r*0.62, r*0.14, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
    // Neck + Head
    ctx.fillStyle = skin;
    ctx.fillRect(px - r*0.14, py - r*0.58, r*0.28, r*0.32);
    ctx.beginPath(); ctx.arc(px, py - r*0.82, r*0.52, 0, Math.PI*2); ctx.fill();
    // Hair
    ctx.fillStyle = hair;
    ctx.beginPath(); ctx.arc(px, py - r*0.92, r*0.52, Math.PI*0.9, 0.1); ctx.fill();
    ctx.fillRect(px - r*0.52, py - r*0.92, r*0.14, r*0.28);
    ctx.fillRect(px + r*0.38, py - r*0.92, r*0.14, r*0.28);
    // Eyes + smile
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(px - r*0.19, py - r*0.82, r*0.08, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + r*0.19, py - r*0.82, r*0.08, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#663a1a'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(px, py - r*0.72, r*0.18, 0.2, Math.PI - 0.2); ctx.stroke();
    // Hat
    if (hat === 'cap') {
      ctx.fillStyle = hatColor || '#cc2020';
      ctx.beginPath(); ctx.arc(px, py - r*1.18, r*0.5, Math.PI, 0); ctx.fill();
      ctx.fillRect(px - r*0.72, py - r*1.18, r*1.44, r*0.14);
    } else if (hat === 'beanie') {
      ctx.fillStyle = hatColor || '#2244aa';
      ctx.beginPath(); ctx.arc(px, py - r*1.08, r*0.52, Math.PI*1.18, -Math.PI*0.18); ctx.fill();
      ctx.fillRect(px - r*0.52, py - r*1.08, r*1.04, r*0.16);
    }
  }

  function startAvatarPreviewLoop() {
    if (avatarRaf) return;
    const canvas = document.getElementById('avatar-preview-canvas');
    if (!canvas) return;
    function loop() {
      if (menu.classList.contains('hidden')) { avatarRaf = null; return; }
      drawAvatarToCanvas(canvas, avatarCfg, Math.sin(Date.now() / 400) * 0.3);
      avatarRaf = requestAnimationFrame(loop);
    }
    avatarRaf = requestAnimationFrame(loop);
  }

  function initAvatarCreator() {
    const profile = window.currentProfile || {};
    if (profile.avatar) avatarCfg = { ...avatarCfg, ...profile.avatar };

    // Sync selected state on all swatches
    document.querySelectorAll('.av-swatch').forEach(btn => {
      btn.classList.toggle('selected', avatarCfg[btn.dataset.key] === btn.dataset.val);
    });
    document.querySelectorAll('.av-hat-btn').forEach(btn => {
      btn.classList.toggle('selected', avatarCfg.hat === btn.dataset.hat);
    });

    // Add listeners only once
    if (!avatarListenersAdded) {
      avatarListenersAdded = true;
      document.querySelectorAll('.av-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          avatarCfg[btn.dataset.key] = btn.dataset.val;
          document.querySelectorAll(`.av-swatch[data-key="${btn.dataset.key}"]`).forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });
      document.querySelectorAll('.av-hat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          avatarCfg.hat = btn.dataset.hat;
          if (btn.dataset.hatcolor) avatarCfg.hatColor = btn.dataset.hatcolor;
          document.querySelectorAll('.av-hat-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });
    }

    startAvatarPreviewLoop();
  }

  function hydrateProfileUI() {
    const user = window.currentUser || null;
    const profile = window.currentProfile || {};
    const name = String(profile.displayName || user?.email?.split('@')[0] || 'Player').trim() || 'Player';
    const avatar = profile.avatarDataUrl || defaultAvatar(name);
    if (btnAvatar) {
      btnAvatar.src = avatar;
      btnAvatar.alt = name;
    }
    if (menuAvatar) {
      menuAvatar.src = avatar;
      menuAvatar.alt = name;
    }
    if (menuName) menuName.textContent = name;
    if (menuEmail) menuEmail.textContent = user?.email || '';
    if (nameInput) nameInput.value = name;
    if (partnerEmailInput) partnerEmailInput.value = normalizeEmail(profile.reunionPartnerEmail || '');
    if (reunionAtInput) reunionAtInput.value = toDateTimeLocalValue(profile.reunionAt || null);
    if (avatarPreview) {
      avatarPreview.src = avatar;
      avatarPreview.alt = name;
    }
    if (invitePartnerBtn) {
      const hasPartnerEmail = !!normalizeEmail(partnerEmailInput?.value || profile.reunionPartnerEmail || '');
      invitePartnerBtn.disabled = !hasPartnerEmail;
    }
    wrap.classList.toggle('hidden', !user);
  }

  function getPartnerEmailForInvite() {
    return normalizeEmail(partnerEmailInput?.value || window.currentProfile?.reunionPartnerEmail || '');
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleMenu();
  });

  document.addEventListener('click', (e) => {
    if (menu.classList.contains('hidden')) return;
    if (wrap.contains(e.target)) return;
    closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  changePwdBtn?.addEventListener('click', async () => {
    const auth = window.auth;
    const email = window.currentUser?.email || '';
    if (!auth || !email) {
      setStatus('No email found for this account.');
      return;
    }
    try {
      setStatus('Sending reset email...');
      await auth.sendPasswordResetEmail(email);
      setStatus('Password reset email sent.', true);
    } catch (err) {
      setStatus(err?.message || 'Could not send reset email.');
    }
  });

  avatarInput?.addEventListener('change', async () => {
    const file = avatarInput.files && avatarInput.files[0];
    if (!file) {
      const profile = window.currentProfile || {};
      const name = String(nameInput?.value || profile.displayName || 'Player').trim() || 'Player';
      if (avatarPreview) avatarPreview.src = profile.avatarDataUrl || defaultAvatar(name);
      return;
    }
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      if (avatarPreview && dataUrl) avatarPreview.src = dataUrl;
    } catch (_) {
      setStatus('Could not load this image file.');
    }
  });

  partnerEmailInput?.addEventListener('input', () => {
    if (invitePartnerBtn) invitePartnerBtn.disabled = !getPartnerEmailForInvite();
  });

  saveProfileBtn?.addEventListener('click', async () => {
    const user = window.currentUser;
    const db = window.db;
    if (!user?.uid || !db) {
      setStatus('You need to be signed in.');
      return;
    }
    const displayName = String(nameInput?.value || '').trim();
    if (!displayName) {
      setStatus('Please enter a player name.');
      return;
    }
    const reunion = buildReunionConfig(partnerEmailInput?.value, reunionAtInput?.value);
    if (!reunion.ok) {
      setStatus(reunion.error);
      return;
    }

    try {
      saveProfileBtn.disabled = true;
      setStatus('Saving profile...');
      const current = window.currentProfile || {};
      const file = avatarInput?.files && avatarInput.files[0];
      const uploadedAvatar = file ? await fileToAvatarDataUrl(file) : null;
      const avatarDataUrl = uploadedAvatar || avatarPreview?.src || current.avatarDataUrl || defaultAvatar(displayName);
      const nextProfile = {
        displayName,
        avatarDataUrl,
        avatar: { ...avatarCfg },
        reunionPartnerEmail: reunion.partnerEmail,
        reunionAt: reunion.reunionAt,
        updatedAt: Date.now()
      };

      await db.ref(`users/${user.uid}/profile`).set(nextProfile);
      window.currentProfile = nextProfile;
      window.dispatchEvent(new Event('profile:updated'));

      const myColor = typeof getMyColor === 'function' ? getMyColor() : null;
      if (myColor && window.GAME_ID) {
        await db.ref(`games/${window.GAME_ID}/seats/${myColor}`).update({
          name: displayName,
          avatarDataUrl,
          email: user.email || '',
          uid: user.uid,
          reunionPartnerEmail: nextProfile.reunionPartnerEmail || '',
          reunionAt: nextProfile.reunionAt || null,
          connectedAt: Date.now()
        });
      }

      if (avatarInput) avatarInput.value = '';
      setStatus('Profile updated.', true);
      if (invitePartnerBtn) invitePartnerBtn.disabled = !normalizeEmail(nextProfile.reunionPartnerEmail);
      hydrateProfileUI();
    } catch (err) {
      setStatus(err?.message || 'Could not update profile.');
    } finally {
      saveProfileBtn.disabled = false;
    }
  });

  invitePartnerBtn?.addEventListener('click', async () => {
    const user = window.currentUser;
    const db = window.db;
    const gameId = String(window.GAME_ID || '').trim();
    const partnerEmail = getPartnerEmailForInvite();
    const senderName = String(window.currentProfile?.displayName || user?.email?.split('@')[0] || 'Your partner').trim() || 'Your partner';

    if (!user?.uid || !db) {
      setStatus('You need to be signed in.');
      return;
    }
    if (!partnerEmail) {
      setStatus('Set your partner email first.');
      return;
    }
    if (!gameId) {
      setStatus('Open or create a game first, then invite.');
      return;
    }
    if (partnerEmail === normalizeEmail(user.email)) {
      setStatus('Partner email cannot be your own email.');
      return;
    }

    try {
      invitePartnerBtn.disabled = true;
      setStatus('Sending invite...');
      await db.ref(`games/${gameId}`).update({
        partnerInvite: {
          targetEmail: partnerEmail,
          senderUid: user.uid,
          senderEmail: normalizeEmail(user.email),
          senderName,
          createdAt: Date.now(),
          status: 'pending',
          gameId
        },
        updatedAt: Date.now()
      });
      setStatus('Partner invited successfully.', true);
    } catch (err) {
      setStatus(err?.message || 'Could not send partner invite.');
    } finally {
      invitePartnerBtn.disabled = !getPartnerEmailForInvite();
    }
  });

  logoutBtn?.addEventListener('click', async () => {
    const auth = window.auth;
    const db = window.db;
    const color = typeof getMyColor === 'function' ? getMyColor() : null;
    try {
      logoutBtn.disabled = true;
      setStatus('Signing out...');
      if (db && color && window.GAME_ID) {
        await db.ref(`games/${window.GAME_ID}/seats/${color}`).remove();
      }
      sessionStorage.removeItem('myColor');
      await auth?.signOut();
      closeMenu();
    } catch (err) {
      setStatus(err?.message || 'Could not log out.');
    } finally {
      logoutBtn.disabled = false;
    }
  });

  if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
    window.auth.onAuthStateChanged(() => {
      hydrateProfileUI();
      closeMenu();
    });
  }

  window.addEventListener('profile:updated', hydrateProfileUI);
  window.addEventListener('load', hydrateProfileUI);
})();
