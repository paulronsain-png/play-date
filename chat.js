// ── Chat ──────────────────────────────────────────────────────────────────────
function chatPath() {
  const gid = (typeof window !== 'undefined' && window.GAME_ID) ? window.GAME_ID : '';
  return `games/${gid}/chat`;
}
const CHAT_NAMES = { w: 'Paul', b: 'Caro' };

let chatOpen    = false;
let unreadCount = 0;
let lastSeenKey = null;
const bubbleTimers = { w: null, b: null };
let chatStarted = false;

function showAvatarBubble(color, text) {
  const el = document.getElementById('chat-bubble-' + (color === 'w' ? 'white' : 'black'));
  if (!el) return;
  clearTimeout(bubbleTimers[color]);
  el.textContent = text;
  el.classList.remove('hidden', 'fading');
  bubbleTimers[color] = setTimeout(() => {
    el.classList.add('fading');
    setTimeout(() => { el.classList.add('hidden'); el.classList.remove('fading'); }, 500);
  }, 3000);
}

function initChat() {
  if (chatStarted) return;
  chatStarted = true;
  if (!window.db) { setTimeout(initChat, 600); return; }

  const btn      = document.getElementById('chat-btn');
  const panel    = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const input    = document.getElementById('chat-input');
  const sendBtn  = document.getElementById('chat-send');
  const messages = document.getElementById('chat-messages');
  const badge    = document.getElementById('chat-badge');
  const initialKeys = new Set();

  // Ensure avatar bubbles always start hidden on app open.
  ['white', 'black'].forEach(side => {
    const b = document.getElementById('chat-bubble-' + side);
    if (b) b.classList.add('hidden');
  });

  // ── open / close ─────────────────────────────────────────────────────────
  function openChat() {
    chatOpen = true;
    panel.classList.remove('hidden');
    btn.classList.add('chat-open');
    unreadCount = 0;
    badge.classList.add('hidden');
    badge.textContent = '0';
    setTimeout(() => { messages.scrollTop = messages.scrollHeight; input.focus(); }, 50);
  }

  function closeChat() {
    chatOpen = false;
    panel.classList.add('hidden');
    panel.style.bottom = '';
    btn.classList.remove('chat-open');
    input.blur();
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    chatOpen ? closeChat() : openChat();
  });
  closeBtn.addEventListener('click', e => { e.stopPropagation(); closeChat(); });
  panel.addEventListener('click', e => e.stopPropagation());

  // Close on outside click (desktop only — on mobile the keyboard/scroll causes false fires)
  document.addEventListener('click', e => {
    if (chatOpen && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      closeChat();
    }
  });

  // ── send message ──────────────────────────────────────────────────────────
  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    const color = getMyColor();
    if (!color) return;
    input.value = '';
    window.db.ref(chatPath()).push({
      color,
      text,
      at: Date.now(),
    });
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

  // ── receive messages ──────────────────────────────────────────────────────
  // Load history silently first, then only treat subsequent arrivals as "new".
  const chatRef = window.db.ref(chatPath()).limitToLast(50);

  function appendMessage(d) {
    const isMe = d.color === getMyColor();
    const liveNames = (typeof window.getPlayerNames === 'function') ? window.getPlayerNames() : CHAT_NAMES;
    const bubble = document.createElement('div');
    bubble.className = 'chat-msg ' + (isMe ? 'chat-msg-me' : 'chat-msg-them');

    const name = document.createElement('span');
    name.className = 'chat-msg-name';
    name.textContent = liveNames[d.color] || CHAT_NAMES[d.color] || d.color;

    const text = document.createElement('span');
    text.className = 'chat-msg-text';
    text.textContent = d.text;

    bubble.appendChild(name);
    bubble.appendChild(text);
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return isMe;
  }

  chatRef.once('value', snapshot => {
    snapshot.forEach(child => {
      const d = child.val();
      if (!d) return;
      initialKeys.add(child.key);
      lastSeenKey = child.key;
      appendMessage(d);
    });

    chatRef.on('child_added', snap => {
      const d = snap.val();
      if (!d) return;

      // Skip backlog items that were already loaded during bootstrap.
      if (initialKeys.has(snap.key)) {
        initialKeys.delete(snap.key);
        return;
      }

      const isMe = appendMessage(d);
      lastSeenKey = snap.key;

      showAvatarBubble(d.color, d.text);

      if (!chatOpen && !isMe) {
        unreadCount++;
        badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        badge.classList.remove('hidden');
      }
    });
  });
}

// On iOS, reposition the chat panel above the keyboard when it opens
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const panel = document.getElementById('chat-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    const keyboardHeight = window.innerHeight - window.visualViewport.height;
    if (keyboardHeight > 100) {
      // Keyboard is open — pin panel just above it
      panel.style.bottom = (keyboardHeight + 8) + 'px';
    } else {
      panel.style.bottom = '';
    }
  });
}

window.addEventListener('load', async () => {
  if (window.appReadyPromise) await window.appReadyPromise;
  setTimeout(initChat, 200);
});
