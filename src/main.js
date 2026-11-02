// main.js - Muse Desktop Gadget 本番フロントエンドコントローラー

const invoke = window.__TAURI__ ? window.__TAURI__.core.invoke : async (cmd, args) => {
  console.log(`[Mock Invoke] ${cmd}`, args);
  if (cmd === 'get_gadget_config') return { size_mode: 'small', message_limit: 5, hotkey: 'Ctrl+Shift+M' };
  if (cmd === 'get_chat_messages') return [
    { role: 'assistant', text: 'こんにちは！Muse です。何かお手伝いできることはありますか？' },
    { role: 'user', text: '今日のタスクを教えて。' },
    { role: 'assistant', text: '承知しました！本日のスケジュールを確認しますね。' }
  ];
  if (cmd === 'get_usage_limit') return { plan_name: '無料プラン', used_percent: 17, remaining_percent: 83, reset_text: '1週間の上限は11月6日にリセットされます', updated_at: '2026-11-02 21:00' };
  return {};
};

// UI 要素の取得
const statusDot = document.getElementById('status-dot');
const planBadge = document.getElementById('plan-badge');

const btnOpenBrowser = document.getElementById('btn-open-browser');
const btnToggleSession = document.getElementById('btn-toggle-session');
const btnRefreshAll = document.getElementById('btn-refresh-all');
const btnToggleSize = document.getElementById('btn-toggle-size');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');
const dragHeader = document.getElementById('drag-header');

const avatarContainer = document.getElementById('avatar-container');
const avatarVideo = document.getElementById('avatar-video');
const avatarFallback = document.getElementById('avatar-fallback');
const btnFetchAvatar = document.getElementById('btn-fetch-avatar');

const limitPercentText = document.getElementById('limit-percent-text');
const limitProgressBar = document.getElementById('limit-progress-bar');
const limitResetText = document.getElementById('limit-reset-text');
const btnRefreshLimit = document.getElementById('btn-refresh-limit');

const chatSyncIndicator = document.getElementById('chat-sync-indicator');
const msgLimitSelect = document.getElementById('msg-limit-select');
const chatMessagesContainer = document.getElementById('chat-messages');

const chatInput = document.getElementById('chat-input');
const btnSendMessage = document.getElementById('btn-send-message');
const footerSyncTime = document.getElementById('footer-sync-time');

let isSessionVisible = false;
let currentLimit = 5;

// ==========================================
// 1. アバター動画 (R1)
// ==========================================
async function loadAvatar(forceRefresh = false) {
  try {
    const dataUrl = await invoke('get_avatar_data_url', { forceRefresh });
    if (dataUrl && dataUrl.startsWith('data:video/')) {
      avatarVideo.src = dataUrl;
      avatarVideo.classList.remove('hidden');
      avatarFallback.style.display = 'none';
      avatarVideo.play().catch(e => console.warn('Video auto-play warning:', e));
      return true;
    }
  } catch (err) {
    console.warn('loadAvatar error:', err);
  }
  // 取得できなかった場合はフォールバック表示
  avatarVideo.classList.add('hidden');
  avatarFallback.style.display = 'flex';
  return false;
}

// ==========================================
// 2. チャットスレッド (R2)
// ==========================================
async function loadChatMessages() {
  chatSyncIndicator.classList.add('syncing');
  try {
    const messages = await invoke('get_chat_messages', { limit: currentLimit });
    renderMessages(messages);
    const now = new Date();
    footerSyncTime.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} 同期`;
    statusDot.className = 'status-dot active';
  } catch (err) {
    console.warn('loadChatMessages error:', err);
    // メッセージがまだないか未ログイン
    if (chatMessagesContainer.children.length === 0 || chatMessagesContainer.querySelector('.chat-placeholder')) {
      showEmptyPlaceholder('Muse のメッセージが見つかりません。セッション画面でログインしてください。');
      statusDot.className = 'status-dot warning';
    }
  } finally {
    chatSyncIndicator.classList.remove('syncing');
  }
}

function renderMessages(messages) {
  if (!messages || messages.length === 0) {
    showEmptyPlaceholder('メッセージはまだありません。');
    return;
  }

  chatMessagesContainer.innerHTML = '';
  messages.forEach(msg => {
    const row = document.createElement('div');
    row.className = `chat-bubble-row ${msg.role === 'user' ? 'user' : 'assistant'}`;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`;
    bubble.textContent = msg.text;

    row.appendChild(bubble);
    chatMessagesContainer.appendChild(row);
  });

  // 最下部へスクロール
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

function showEmptyPlaceholder(msg) {
  chatMessagesContainer.innerHTML = `
    <div class="chat-placeholder">
      <p class="placeholder-main">${msg}</p>
      <p class="placeholder-sub">※ ログイン後に [↻] を押すと同期されます</p>
      <button class="btn-login-open" id="btn-open-session-placeholder">🖥️ セッション画面を開く</button>
    </div>
  `;
  const pBtn = document.getElementById('btn-open-session-placeholder');
  if (pBtn) {
    pBtn.addEventListener('click', toggleSessionWindow);
  }
}

// ==========================================
// 3. メッセージ送信 (R3)
// ==========================================
async function handleSendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.disabled = true;
  btnSendMessage.disabled = true;

  try {
    // 直前の自分メッセージを即時反映（楽観的UI）
    const row = document.createElement('div');
    row.className = 'chat-bubble-row user';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble user';
    bubble.textContent = text;
    row.appendChild(bubble);
    chatMessagesContainer.appendChild(row);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;

    chatInput.value = '';
    adjustTextareaHeight();

    await invoke('send_chat_message', { text });

    // Muse の返信反映のため、1.5 秒後と 4 秒後に再取得
    setTimeout(loadChatMessages, 1500);
    setTimeout(loadChatMessages, 4000);
  } catch (err) {
    console.error('handleSendMessage error:', err);
    alert('メッセージの送信に失敗しました: ' + err);
  } finally {
    chatInput.disabled = false;
    btnSendMessage.disabled = false;
    chatInput.focus();
  }
}

function adjustTextareaHeight() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
}

// ==========================================
// 4. 利用枠（ウィンドウリミット）(R5)
// ==========================================
async function loadUsageLimit(forceRefresh = false) {
  try {
    const limit = await invoke('get_usage_limit', { forceRefresh });
    if (limit) {
      planBadge.textContent = limit.plan_name || '無料プラン';

      if (limit.remaining_percent !== null && limit.remaining_percent !== undefined) {
        limitPercentText.textContent = `残 ${limit.remaining_percent}%`;
        limitProgressBar.style.width = `${limit.remaining_percent}%`;

        limitProgressBar.className = 'progress-bar';
        if (limit.remaining_percent >= 80) {
          limitPercentText.style.color = 'var(--color-safe)';
        } else if (limit.remaining_percent >= 30) {
          limitProgressBar.classList.add('warn');
          limitPercentText.style.color = 'var(--color-warn)';
        } else {
          limitProgressBar.classList.add('danger');
          limitPercentText.style.color = 'var(--color-danger)';
        }
      } else {
        limitPercentText.textContent = '--%';
        limitProgressBar.style.width = '0%';
      }

      limitResetText.textContent = limit.reset_text || '利用枠情報未取得';
    }
  } catch (err) {
    console.warn('loadUsageLimit error:', err);
  }
}

// ==========================================
// 5. ウィンドウ・セッション・サイズ制御 (R4, R6, R7)
// ==========================================
async function toggleSessionWindow() {
  try {
    if (isSessionVisible) {
      await invoke('hide_session');
      isSessionVisible = false;
    } else {
      await invoke('open_or_show_session');
      isSessionVisible = true;
    }
    updateSessionStatus();
  } catch (err) {
    console.error('toggleSessionWindow error:', err);
  }
}

async function updateSessionStatus() {
  try {
    const status = await invoke('get_session_status');
    isSessionVisible = status.visible;
  } catch (err) {
    console.warn('updateSessionStatus error:', err);
  }
}

async function toggleSizeMode() {
  try {
    const newMode = await invoke('toggle_size_mode');
    applySizeMode(newMode);
  } catch (err) {
    console.error('toggleSizeMode error:', err);
  }
}

function applySizeMode(mode) {
  if (mode === 'large') {
    document.body.classList.remove('mode-small');
    document.body.classList.add('mode-large');
  } else {
    document.body.classList.remove('mode-large');
    document.body.classList.add('mode-small');
  }
}

// ==========================================
// 初期化 & イベントリスナー
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  // ウィンドウドラッグ
  dragHeader.addEventListener('mousedown', (e) => {
    if (e.target.closest('.header-controls') || e.target.closest('.avatar-wrapper')) return;
    invoke('drag_window').catch(console.error);
  });

  // 最小化 / 閉じる
  btnMinimize.addEventListener('click', () => invoke('minimize_window'));
  btnClose.addEventListener('click', () => invoke('close_window'));

  // ブラウザで開く (R6)
  btnOpenBrowser.addEventListener('click', () => invoke('open_in_browser'));

  // セッション表示 / 非表示トグル
  btnToggleSession.addEventListener('click', toggleSessionWindow);

  // サイズ切替 (R7)
  btnToggleSize.addEventListener('click', toggleSizeMode);

  // すべて即時同期（直列実行で確実に取得）
  btnRefreshAll.addEventListener('click', async () => {
    btnRefreshAll.style.transform = 'rotate(180deg)';
    setTimeout(() => { btnRefreshAll.style.transform = ''; }, 300);
    await loadChatMessages();
    await loadAvatar(false);
    await loadUsageLimit(true);
  });

  // アバター再取得
  avatarContainer.addEventListener('click', () => loadAvatar(true));
  if (btnFetchAvatar) {
    btnFetchAvatar.addEventListener('click', (e) => {
      e.stopPropagation();
      loadAvatar(true);
    });
  }

  // 利用枠再取得
  btnRefreshLimit.addEventListener('click', () => loadUsageLimit(true));

  // 表示件数変更
  msgLimitSelect.addEventListener('change', () => {
    currentLimit = parseInt(msgLimitSelect.value, 10) || 5;
    loadChatMessages();
  });

  // メッセージ送信
  btnSendMessage.addEventListener('click', handleSendMessage);

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  chatInput.addEventListener('input', adjustTextareaHeight);

  // 初期設定ロード
  try {
    const config = await invoke('get_gadget_config');
    if (config) {
      applySizeMode(config.size_mode || 'small');
      if (config.message_limit) {
        currentLimit = config.message_limit;
        msgLimitSelect.value = String(currentLimit);
      }
    }
  } catch (e) {
    console.warn('Config load error:', e);
  }

  // 初期データ取得（直列実行＋セッションWebViewのロード待ちリトライ）
  const syncAllSequential = async (forceLimit = false) => {
    await updateSessionStatus();
    await loadChatMessages();
    await loadAvatar(false);
    await loadUsageLimit(forceLimit);
  };

  setTimeout(() => syncAllSequential(false), 1500);
  setTimeout(() => syncAllSequential(true), 4500);

  // 12 秒ごとの自動バックグラウンド同期
  setInterval(async () => {
    await updateSessionStatus();
    await loadChatMessages();
    if (avatarVideo.classList.contains('hidden')) {
      await loadAvatar(false);
    }
    if (limitPercentText.textContent === '--%') {
      await loadUsageLimit(true);
    }
  }, 12000);
});
