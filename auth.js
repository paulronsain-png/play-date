(function () {
  let readyResolved = false;
  let resolveReady = () => {};
  window.appReadyPromise = new Promise((resolve) => {
    resolveReady = () => {
      if (readyResolved) return;
      readyResolved = true;
      resolve();
    };
  });

  function sanitizeGameId(value) {
    const v = (value || '').trim();
    if (!v) return '';
    return /^[A-Za-z0-9_-]{6,64}$/.test(v) ? v : '';
  }

  function gameIdFromInput(raw) {
    const text = (raw || '').trim();
    if (!text) return '';
    const direct = sanitizeGameId(text);
    if (direct) return direct;
    try {
      const url = new URL(text);
      const fromQuery = sanitizeGameId(url.searchParams.get('game'));
      if (fromQuery) return fromQuery;
    } catch (_) {}
    const fromPattern = /[?&]game=([A-Za-z0-9_-]{6,64})/.exec(text);
    if (fromPattern && fromPattern[1]) return sanitizeGameId(fromPattern[1]);
    return '';
  }

  function sessionIdFromInput(raw) {
    const text = (raw || '').trim();
    if (!text) return '';
    try {
      const url = new URL(text);
      const s = sanitizeGameId(url.searchParams.get('session'));
      if (s) return s;
    } catch (_) {}
    const m = /[?&]session=([A-Za-z0-9_-]{6,64})/.exec(text);
    if (m && m[1]) return sanitizeGameId(m[1]);
    return '';
  }

  function gameIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return sanitizeGameId(params.get('game'));
  }

  function sessionIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return sanitizeGameId(params.get('session'));
  }

  function buildGameUrl(gameId) {
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}?game=${encodeURIComponent(gameId)}`;
  }

  function buildSessionUrl(sessionId) {
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}?session=${encodeURIComponent(sessionId)}`;
  }

  function randomGameId() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function defaultAvatarDataUri(name = 'Player') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
      <!-- default-avatar-v3 -->
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#8fd0ff"/>
          <stop offset="1" stop-color="#3d6ea8"/>
        </linearGradient>
        <linearGradient id="avatar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f4fbff" stop-opacity="0.96"/>
          <stop offset="1" stop-color="#d8ecfb" stop-opacity="0.9"/>
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="60" fill="#0d2037"/>
      <circle cx="60" cy="60" r="54" fill="url(#g)" opacity="0.9"/>
      <g fill="url(#avatar)">
        <circle cx="60" cy="42" r="13"/>
        <path d="M60 57c-12.6 0-23 10-23 22.2V86h46v-6.8C83 67 72.6 57 60 57z"/>
      </g>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
  window.makeDefaultAvatarDataUri = defaultAvatarDataUri;

  function isGeneratedDefaultAvatar(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/svg+xml')) return false;
    const markerHits = ['default-avatar-v', '8fd0ff', '3d6ea8', 'linearGradient%20id%3D%22g%22'];
    return markerHits.some(m => dataUrl.includes(m));
  }

  function profilePath(uid) {
    return `users/${uid}/profile`;
  }

  function notifyProfileUpdated() {
    window.dispatchEvent(new Event('profile:updated'));
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

  function buildReunionConfig(partnerEmailInput, reunionAtInput) {
    const partnerEmail = normalizeEmail(partnerEmailInput);
    const reunionAt = parseReunionAt(reunionAtInput);
    const hasOne = !!partnerEmail || !!reunionAt;
    if (!hasOne) return { ok: true, partnerEmail: '', reunionAt: null };
    if (!partnerEmail || !reunionAt) {
      return { ok: false, error: 'Please fill both partner email and reunion date/time, or leave both empty.' };
    }
    return { ok: true, partnerEmail, reunionAt };
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

  window.addEventListener('load', () => {
    const auth = window.auth;
    const db = window.db;

    const gate = byId('auth-gate');
    const authPanel = byId('auth-panel');
    const authCard = gate?.querySelector('.auth-card') || document.querySelector('.auth-card');
    const lobbyPanel = byId('lobby-panel');
    const tabLogin = byId('auth-tab-login');
    const tabSignup = byId('auth-tab-signup');
    const loginForm = byId('login-form');
    const signupForm = byId('signup-form');
    const loginEmail = byId('login-email');
    const loginPassword = byId('login-password');
    const signupEmail = byId('signup-email');
    const signupPassword = byId('signup-password');
    const signupConfirm = byId('signup-confirm');
    const signupName = byId('signup-name');
    const signupAvatar = byId('signup-avatar');
    const signupAvatarPreview = byId('signup-avatar-preview');
    const signupPartnerEmail = byId('signup-partner-email');
    const signupReunionAt = byId('signup-reunion-at');
    const profilePanel = byId('profile-panel');
    const profileForm = byId('profile-form');
    const profileName = byId('profile-name');
    const profileAvatar = byId('profile-avatar');
    const profileAvatarPreview = byId('profile-avatar-preview');
    const profilePartnerEmail = byId('profile-partner-email');
    const profileReunionAt = byId('profile-reunion-at');
    const profileSkipBtn = byId('profile-skip-btn');
    const authMessage = byId('auth-message');
    const lobbyUser = byId('lobby-user');
    const createBtn = byId('create-game-btn');
    const joinInput = byId('join-link-input');
    const joinBtn = byId('join-game-btn');
    const logoutBtn = byId('auth-logout-btn');
    let partnerInviteQueryRef = null;
    let partnerInviteListener = null;

    function showMessage(text, ok = false) {
      if (!authMessage) return;
      authMessage.textContent = text || '';
      authMessage.classList.toggle('ok', !!ok);
    }



    function stopPartnerInviteListener() {
      if (partnerInviteQueryRef && partnerInviteListener) {
        partnerInviteQueryRef.off('value', partnerInviteListener);
      }
      partnerInviteQueryRef = null;
      partnerInviteListener = null;
    }


    function friendlyAuthError(err) {
      const code = err && err.code ? String(err.code) : '';
      if (code === 'auth/configuration-not-found') {
        return 'Email/password sign-in is not enabled yet in Firebase Console.';
      }
      if (code === 'auth/api-key-not-valid') {
        return 'Firebase config issue: invalid API key.';
      }
      if (code === 'auth/invalid-email') return 'Invalid email format.';
      if (code === 'auth/email-already-in-use') return 'This email is already in use.';
      if (code === 'auth/weak-password') return 'Password is too weak (min 6 characters).';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        return 'Incorrect email or password.';
      }
      return err && err.message ? err.message : 'Authentication failed.';
    }

    function setButtonBusy(btn, busy, label) {
      if (!btn) return;
      if (!btn.dataset.baseLabel) btn.dataset.baseLabel = btn.textContent || '';
      btn.disabled = !!busy;
      btn.textContent = busy ? (label || 'Please wait...') : btn.dataset.baseLabel;
    }

    function showLoginTab() {
      tabLogin?.classList.add('active');
      tabSignup?.classList.remove('active');
      loginForm?.classList.remove('hidden');
      signupForm?.classList.add('hidden');
      showMessage('');
      queueMicrotask(syncAuthCardHeight);
    }

    function setPreviewImage(imgEl, name, dataUrl) {
      if (!imgEl) return;
      imgEl.src = dataUrl || defaultAvatarDataUri(name || 'Player');
    }

    setPreviewImage(signupAvatarPreview, 'Player', '');
    setPreviewImage(profileAvatarPreview, 'Player', '');

    function showSignupTab() {
      tabSignup?.classList.add('active');
      tabLogin?.classList.remove('active');
      signupForm?.classList.remove('hidden');
      loginForm?.classList.add('hidden');
      showMessage('');
      queueMicrotask(syncAuthCardHeight);
    }

    function syncAuthCardHeight() {
      if (!authCard || !authPanel || authPanel.classList.contains('hidden') || !loginForm || !signupForm) return;

      const loginWasHidden = loginForm.classList.contains('hidden');
      const signupWasHidden = signupForm.classList.contains('hidden');
      const loginWasActive = !!tabLogin?.classList.contains('active');
      const signupWasActive = !!tabSignup?.classList.contains('active');

      // Measure natural card height in login state, then reuse it for signup.
      loginForm.classList.remove('hidden');
      signupForm.classList.add('hidden');
      tabLogin?.classList.add('active');
      tabSignup?.classList.remove('active');

      authCard.style.setProperty('--auth-card-fixed-height', 'auto');
      const natural = Math.ceil(authCard.getBoundingClientRect().height);
      const viewportMax = Math.max(360, Math.floor(window.innerHeight - 24));
      const targetHeight = Math.min(natural, viewportMax);
      authCard.style.setProperty('--auth-card-fixed-height', `${targetHeight}px`);

      if (loginWasHidden) loginForm.classList.add('hidden');
      if (!loginWasHidden) loginForm.classList.remove('hidden');
      if (signupWasHidden) signupForm.classList.add('hidden');
      if (!signupWasHidden) signupForm.classList.remove('hidden');
      if (loginWasActive) tabLogin?.classList.add('active');
      if (!loginWasActive) tabLogin?.classList.remove('active');
      if (signupWasActive) tabSignup?.classList.add('active');
      if (!signupWasActive) tabSignup?.classList.remove('active');
    }

    function lockApp() {
      document.body.classList.add('auth-locked');
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.style.height = '100dvh';
      gate?.classList.remove('hidden');
    }

    function unlockApp() {
      document.body.classList.remove('auth-locked');
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
      gate?.classList.add('fading-out');
      setTimeout(() => {
        gate?.classList.add('hidden');
        gate?.classList.remove('fading-out');
        window.stopMapPreview?.();
      }, 420);
      resolveReady();
    }

    function showAuth() {
      lockApp();
      authPanel?.classList.remove('hidden');
      profilePanel?.classList.add('hidden');
      lobbyPanel?.classList.add('hidden');
      showLoginTab();
      queueMicrotask(syncAuthCardHeight);
    }

    function showProfileSetup(prefill = {}) {
      lockApp();
      authPanel?.classList.add('hidden');
      lobbyPanel?.classList.add('hidden');
      profilePanel?.classList.remove('hidden');
      if (profileName) profileName.value = (prefill.displayName || '').trim();
      if (profilePartnerEmail) profilePartnerEmail.value = normalizeEmail(prefill.reunionPartnerEmail || '');
      if (profileReunionAt) profileReunionAt.value = toDateTimeLocalValue(prefill.reunionAt || null);
      setPreviewImage(profileAvatarPreview, prefill.displayName || 'Player', prefill.avatarDataUrl || '');
      showMessage('Please complete your profile before entering the game.');
    }

    function showLobby(user) {
      lockApp();
      authPanel?.classList.add('hidden');
      profilePanel?.classList.add('hidden');
      lobbyPanel?.classList.remove('hidden');
      if (lobbyUser) {
        const label = user?.email ? `Signed in as ${user.email}` : 'Signed in';
        lobbyUser.textContent = label;
      }
      showMessage('Choose Create Game or Join Game to continue.', true);
    }

    lockApp();
    showMessage('Checking session...');

    tabLogin?.addEventListener('click', showLoginTab);
    tabSignup?.addEventListener('click', showSignupTab);
    window.addEventListener('resize', () => {
      if (!gate?.classList.contains('hidden')) syncAuthCardHeight();
    });
    signupAvatar?.addEventListener('change', async () => {
      try {
        const file = signupAvatar.files && signupAvatar.files[0];
        if (!file) {
          setPreviewImage(signupAvatarPreview, signupName?.value || 'Player', '');
          return;
        }
        const dataUrl = await fileToAvatarDataUrl(file);
        setPreviewImage(signupAvatarPreview, signupName?.value || 'Player', dataUrl || '');
      } catch {
        setPreviewImage(signupAvatarPreview, signupName?.value || 'Player', '');
      }
    });
    profileAvatar?.addEventListener('change', async () => {
      try {
        const file = profileAvatar.files && profileAvatar.files[0];
        if (!file) {
          setPreviewImage(profileAvatarPreview, profileName?.value || 'Player', '');
          return;
        }
        const dataUrl = await fileToAvatarDataUrl(file);
        setPreviewImage(profileAvatarPreview, profileName?.value || 'Player', dataUrl || '');
      } catch {
        setPreviewImage(profileAvatarPreview, profileName?.value || 'Player', '');
      }
    });

    byId('forgot-password-btn')?.addEventListener('click', async () => {
      const email = loginEmail?.value.trim();
      if (!email) {
        showMessage('Enter your email address first, then click Forgot password.');
        return;
      }
      const btn = byId('forgot-password-btn');
      try {
        if (btn) btn.textContent = 'Sending...';
        await auth.sendPasswordResetEmail(email);
        showMessage('Password reset email sent — check your inbox.', true);
      } catch (err) {
        showMessage(friendlyAuthError(err));
      } finally {
        if (btn) btn.textContent = 'Forgot password?';
      }
    });

    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!auth) return;
      const email = loginEmail?.value.trim();
      const password = loginPassword?.value || '';
      if (!email || !password) {
        showMessage('Enter your email and password.');
        return;
      }
      const btn = byId('login-submit');
      try {
        setButtonBusy(btn, true, 'Logging In...');
        await auth.signInWithEmailAndPassword(email, password);
        showMessage('');
      } catch (err) {
        showMessage(friendlyAuthError(err));
      } finally {
        setButtonBusy(btn, false);
      }
    });

    signupForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!auth) return;
      const email = signupEmail?.value.trim();
      const password = signupPassword?.value || '';
      const confirm = signupConfirm?.value || '';
      const displayName = (signupName?.value || '').trim();
      if (!displayName) {
        showMessage('Enter your display name.');
        return;
      }
      if (!email || !password) {
        showMessage('Enter your name, email and password.');
        return;
      }
      if (password.length < 6) {
        showMessage('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirm) {
        showMessage('Passwords do not match.');
        return;
      }
      const reunion = buildReunionConfig(signupPartnerEmail?.value, signupReunionAt?.value);
      if (!reunion.ok) {
        showMessage(reunion.error);
        return;
      }
      const btn = byId('signup-submit');
      try {
        setButtonBusy(btn, true, 'Creating...');
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        const uid = cred?.user?.uid;
        if (db && uid) {
          const file = signupAvatar?.files && signupAvatar.files[0];
          const avatarDataUrl = file ? await fileToAvatarDataUrl(file) : defaultAvatarDataUri(displayName);
          await db.ref(profilePath(uid)).set({
            displayName,
            avatarDataUrl: avatarDataUrl || defaultAvatarDataUri(displayName),
            reunionPartnerEmail: reunion.partnerEmail,
            reunionAt: reunion.reunionAt,
            updatedAt: Date.now()
          });
        }
        showMessage('Account created. You are now signed in.', true);
      } catch (err) {
        showMessage(friendlyAuthError(err));
      } finally {
        setButtonBusy(btn, false);
      }
    });

    profileForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = auth?.currentUser;
      if (!user || !db) return;
      const displayName = (profileName?.value || '').trim();
      if (!displayName) {
        showMessage('Please enter your display name.');
        return;
      }
      const reunion = buildReunionConfig(profilePartnerEmail?.value, profileReunionAt?.value);
      if (!reunion.ok) {
        showMessage(reunion.error);
        return;
      }
      const btn = byId('profile-save-btn');
      try {
        setButtonBusy(btn, true, 'Saving...');
        const file = profileAvatar?.files && profileAvatar.files[0];
        const avatarDataUrl = file ? await fileToAvatarDataUrl(file) : (profileAvatarPreview?.src || defaultAvatarDataUri(displayName));
        const profile = {
          displayName,
          avatarDataUrl: avatarDataUrl || defaultAvatarDataUri(displayName),
          reunionPartnerEmail: reunion.partnerEmail,
          reunionAt: reunion.reunionAt,
          updatedAt: Date.now()
        };
        await db.ref(profilePath(user.uid)).set(profile);
        window.currentProfile = profile;
        notifyProfileUpdated();
        if (!window.GAME_ID) showLobby(user);
        else {
          showMessage('');
          unlockApp();
        }
      } catch (err) {
        showMessage(err?.message || 'Could not save profile.');
      } finally {
        setButtonBusy(btn, false);
      }
    });

    profileSkipBtn?.addEventListener('click', async () => {
      const user = auth?.currentUser;
      if (!user || !db) return;
      const reunion = buildReunionConfig(profilePartnerEmail?.value, profileReunionAt?.value);
      if (!reunion.ok) {
        showMessage(reunion.error);
        return;
      }
      const fallbackName = (profileName?.value || user.email?.split('@')[0] || 'Player').trim();
      const profile = {
        displayName: fallbackName,
        avatarDataUrl: defaultAvatarDataUri(fallbackName),
        reunionPartnerEmail: reunion.partnerEmail,
        reunionAt: reunion.reunionAt,
        updatedAt: Date.now()
      };
      try {
        await db.ref(profilePath(user.uid)).set(profile);
        window.currentProfile = profile;
        notifyProfileUpdated();
        if (!window.GAME_ID) showLobby(user);
        else {
          showMessage('');
          unlockApp();
        }
      } catch (err) {
        showMessage(err?.message || 'Could not save profile.');
      }
    });

    createBtn?.addEventListener('click', async () => {
      const user = auth?.currentUser;
      if (!user) { showMessage('Please log in first.'); return; }
      const profile = window.currentProfile || {};
      const partnerEmail = normalizeEmail(profile.reunionPartnerEmail || '');
      const sessionId = randomGameId();
      showMessage('Creating session...', true);
      try {
        if (db) {
          const sessionData = {
            createdBy: user.uid,
            createdByEmail: user.email || '',
            createdAt: Date.now(),
            profiles: {
              host: {
                uid: user.uid,
                displayName: profile.displayName || '',
                avatarDataUrl: profile.avatarDataUrl || '',
              }
            }
          };
          if (partnerEmail && partnerEmail !== normalizeEmail(user.email)) {
            sessionData.invite = {
              targetEmail: partnerEmail,
              senderUid: user.uid,
              senderEmail: user.email || '',
              senderName: profile.displayName || user.email || '',
              status: 'pending',
              createdAt: Date.now(),
            };
          }
          await db.ref(`sessions/${sessionId}`).set(sessionData);
        }
      } catch (_) {}
      window.location.href = buildSessionUrl(sessionId);
    });

    joinBtn?.addEventListener('click', () => {
      const raw = joinInput?.value || '';
      // Try session link first
      const sessionId = sessionIdFromInput(raw);
      if (sessionId) {
        window.location.href = buildSessionUrl(sessionId);
        return;
      }
      // Fall back to game ID (direct chess link, backward compat)
      const gameId = gameIdFromInput(raw);
      if (gameId) {
        window.GAME_ID = gameId;
        window.location.href = buildGameUrl(gameId);
        return;
      }
      showMessage('Paste a valid session or game link.');
    });

    logoutBtn?.addEventListener('click', async () => {
      try {
        stopPartnerInviteListener();
        await auth?.signOut();
        showMessage('Signed out.', true);
      } catch (err) {
        showMessage(err?.message || 'Could not log out.');
      }
    });


    async function getOrCreateSession(user, profile) {
      // 1. Reuse last known session if still alive in Firebase
      const stored = localStorage.getItem('currentSessionId');
      if (stored && db) {
        try {
          const snap = await db.ref(`sessions/${stored}/createdAt`).once('value');
          if (snap.val()) return stored;
        } catch (_) {}
      }

      // 2. Auto-join a pending invite from partner
      const myEmail = normalizeEmail(user.email);
      if (myEmail && db) {
        try {
          const snap = await db.ref('sessions')
            .orderByChild('invite/targetEmail')
            .equalTo(myEmail)
            .limitToLast(5)
            .once('value');
          const all = snap.val() || {};
          const candidate = Object.entries(all).find(([, s]) =>
            s.invite?.status === 'pending' && s.invite.senderUid !== user.uid
          );
          if (candidate) {
            const [inviteSessionId] = candidate;
            // Auto-accept and join
            await db.ref(`sessions/${inviteSessionId}/invite`).update({ status: 'accepted', respondedAt: Date.now(), respondedBy: user.uid });
            await db.ref(`sessions/${inviteSessionId}/profiles/guest`).set({ uid: user.uid, displayName: profile.displayName || '', avatarDataUrl: profile.avatarDataUrl || '' });
            localStorage.setItem('currentSessionId', inviteSessionId);
            return inviteSessionId;
          }
        } catch (_) {}
      }

      // 3. Create a fresh session
      const sessionId = randomGameId();
      const partnerEmail = normalizeEmail(profile.reunionPartnerEmail || '');
      const sessionData = {
        createdBy: user.uid,
        createdByEmail: user.email || '',
        createdAt: Date.now(),
        profiles: { host: { uid: user.uid, displayName: profile.displayName || '', avatarDataUrl: profile.avatarDataUrl || '' } }
      };
      if (partnerEmail && partnerEmail !== myEmail) {
        sessionData.invite = { targetEmail: partnerEmail, senderUid: user.uid, senderEmail: user.email || '', senderName: profile.displayName || '', status: 'pending', createdAt: Date.now() };
      }
      if (db) await db.ref(`sessions/${sessionId}`).set(sessionData);
      localStorage.setItem('currentSessionId', sessionId);
      return sessionId;
    }

    if (!auth) {
      window.GAME_ID = window.GAME_ID || gameIdFromUrl() || '';
      unlockApp();
      return;
    }

    auth.onAuthStateChanged(async (user) => {
      window.currentUser = user || null;
      const gameId    = window.GAME_ID    || gameIdFromUrl();
      const sessionId = window.SESSION_ID || sessionIdFromUrl();
      window.GAME_ID    = gameId    || '';
      window.SESSION_ID = sessionId || '';

      if (!user) {
        window.currentProfile = null;
        notifyProfileUpdated();
        stopPartnerInviteListener();
        localStorage.removeItem('currentSessionId');
        showAuth();
        return;
      }

      let profile = null;
      try {
        if (db) {
          const snap = await db.ref(profilePath(user.uid)).once('value');
          profile = snap.val() || null;
        }
      } catch (_) {}
      const hasProfile = !!(profile && String(profile.displayName || '').trim());
      if (!hasProfile) {
        showProfileSetup({
          displayName: user.email ? user.email.split('@')[0] : '',
          avatarDataUrl: '',
          reunionPartnerEmail: '',
          reunionAt: null
        });
        return;
      }
      const fallbackAvatar = defaultAvatarDataUri(profile.displayName || 'Player');
      const shouldRefreshDefaultAvatar =
        !profile.avatarDataUrl || isGeneratedDefaultAvatar(profile.avatarDataUrl);
      if (shouldRefreshDefaultAvatar) {
        profile.avatarDataUrl = fallbackAvatar;
        try {
          if (db) {
            await db.ref(profilePath(user.uid)).update({
              avatarDataUrl: fallbackAvatar,
              updatedAt: Date.now()
            });
          }
        } catch (_) {}
      }
      profile.reunionPartnerEmail = normalizeEmail(profile.reunionPartnerEmail || '');
      profile.reunionAt = parseReunionAt(profile.reunionAt) || null;
      window.currentProfile = profile;
      notifyProfileUpdated();

      // ── Session mode (map) ────────────────────────────────────────────────
      if (window.SESSION_ID) {
        try {
          const snap = await db.ref(`sessions/${window.SESSION_ID}`).once('value');
          const session = snap.val() || {};
          const isHost = session.createdBy === user.uid;
          window.mySessionRole = isHost ? 'host' : 'guest';

          if (!isHost) {
            // Write guest profile into session
            await db.ref(`sessions/${window.SESSION_ID}/profiles/guest`).set({
              uid: user.uid,
              displayName: profile.displayName || '',
              avatarDataUrl: profile.avatarDataUrl || '',
            });
            // Accept the invite if pending
            if (session.invite?.status === 'pending') {
              await db.ref(`sessions/${window.SESSION_ID}/invite`).update({
                status: 'accepted',
                respondedAt: Date.now(),
                respondedBy: user.uid,
              });
            }
          }

              // Load opponent profile (may already be there or arrive later)
          const oppRole = window.mySessionRole === 'host' ? 'guest' : 'host';
          const oppSnap = await db.ref(`sessions/${window.SESSION_ID}/profiles/${oppRole}`).once('value');
          window.sessionOpponentProfile = oppSnap.val() || null;
          // Remember this session for next login
          localStorage.setItem('currentSessionId', window.SESSION_ID);
        } catch (_) {}

        showMessage('');
        unlockApp();
        return;
      }

      // ── Auto-session: skip lobby, go straight to map ─────────────────────
      if (!window.GAME_ID) {
        showMessage('Loading map…', true);
        const sid = await getOrCreateSession(user, profile);
        window.location.href = buildSessionUrl(sid);
        return;
      }
      showMessage('');
      unlockApp();
    });
  });
})();
