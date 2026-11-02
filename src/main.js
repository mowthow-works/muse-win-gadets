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
const avatarNameEl = document.getElementById('avatar-name');
const avatarColumn = document.getElementById('avatar-column');
const mascotRestoreBtn = document.getElementById('mascot-restore-btn');

// マスコット吹き出し要素
const mascotBubble = document.getElementById('mascot-bubble');
const mascotBubbleText = document.getElementById('mascot-bubble-text');
const mascotBubbleCursor = document.getElementById('mascot-bubble-cursor');
const btnBubbleClose = document.getElementById('btn-bubble-close');

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

const healthR1 = document.getElementById('health-r1');
const healthR2 = document.getElementById('health-r2');
const healthR3 = document.getElementById('health-r3');
const healthR5 = document.getElementById('health-r5');

let isSessionVisible = false;
let currentLimit = 5;
let lastSeenAssistantText = null;
let lastKnownAvatarBlobUrl = null;
let typingTimer = null;
let autoHideTimer = null;

// ==========================================
// ルパン風パタパタタイピング吹き出し制御
// ==========================================
function cleanMascotMessageText(text) {
  if (!text) return '';
  return text
    .replace(/^[\s\uFEFF\xA0\u3000]+/g, '')  // 先頭の空白・改行・全角スペース・NBSP等を完全に除去
    .replace(/[\s\uFEFF\xA0\u3000]+$/g, '')  // 末尾の空白を除去
    .replace(/^[ \t\u3000]+/gm, '');          // 各行頭の不自然なインデントを除去
}

function updateMascotBubbleDirection() {
  if (!document.body.classList.contains('mode-mascot')) return;
  const heroCard = document.getElementById('hero-card');
  if (!heroCard) return;

  // 画面の右半分（中心より右）にあるかどうか
  const screenCenter = (window.screen.availLeft || 0) + ((window.screen.availWidth || 1920) / 2);
  const winCenter = window.screenX + (window.outerWidth / 2);

  if (winCenter > screenCenter) {
    // 画面の右側にある -> 吹き出しは左側に出す！
    heroCard.classList.add('bubble-on-left');
    heroCard.classList.remove('bubble-on-right');
  } else {
    // 画面の左側にある -> 吹き出しは右側に出す！
    heroCard.classList.add('bubble-on-right');
    heroCard.classList.remove('bubble-on-left');
  }
}

function playLupinTyping(text) {
  if (!mascotBubble || !mascotBubbleText) return;
  const cleanedText = cleanMascotMessageText(text);
  if (!cleanedText) return;

  updateMascotBubbleDirection();

  // 進行中のタイマーをクリア
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
  }
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  mascotBubbleText.textContent = '';
  mascotBubbleCursor.classList.remove('hidden');
  mascotBubble.classList.remove('hidden');

  // 目で追うスピードより気持ち早いテンポ
  // 1文字あたり12ms〜24ms（文字数に応じて適応調整）
  const delay = Math.min(24, Math.max(10, Math.floor(1600 / Math.max(1, cleanedText.length))));

  let idx = 0;
  typingTimer = setInterval(() => {
    if (idx < cleanedText.length) {
      mascotBubbleText.textContent += cleanedText[idx];
      idx++;
      mascotBubbleText.scrollTop = mascotBubbleText.scrollHeight;
    } else {
      clearInterval(typingTimer);
      typingTimer = null;
      // タイピング完了後、カーソルを少し待って非表示に
      setTimeout(() => {
        mascotBubbleCursor.classList.add('hidden');
      }, 700);
      // 30秒後に自動的にフェードアウト
      autoHideTimer = setTimeout(() => {
        mascotBubble.classList.add('hidden');
      }, 30000);
    }
  }, delay);
}

function hideMascotBubble() {
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
  }
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
  if (mascotBubble) {
    mascotBubble.classList.add('hidden');
  }
}

// ==========================================
// 0. §17 起動時・定期ヘルスチェック & 縮退運転制御
// ==========================================
function setHealthPill(el, label, ok, detail) {
  if (!el) return;
  el.textContent = ok ? `${label}✓` : `${label}⚠`;
  el.className = `health-pill ${ok ? 'ok' : 'degraded'}`;
  el.title = `${label}: ${ok ? '正常' : '未検出/縮退中'} (${detail || ''})`;
}

async function runHealthCheck() {
  try {
    const h = await invoke('check_bridge_health');
    if (!h) return;
    if (h.avatar_name && avatarNameEl) {
      avatarNameEl.textContent = h.avatar_name;
    }

    // Muse本体の動画ソース（blob URL）変更を検知して自動追従
    if (h.avatar_src) {
      if (lastKnownAvatarBlobUrl && lastKnownAvatarBlobUrl !== h.avatar_src) {
        lastKnownAvatarBlobUrl = h.avatar_src;
        // 本体側で動画が切り替わったため再取得して反映
        loadAvatar(true).catch(() => {});
      } else if (!lastKnownAvatarBlobUrl) {
        lastKnownAvatarBlobUrl = h.avatar_src;
      }
    }

    const isAvatarPlaying = !avatarVideo.classList.contains('hidden') && !!avatarVideo.src;
    const r1Ok = !!h.r1_avatar?.ok || isAvatarPlaying;
    const r1Detail = h.r1_avatar?.ok ? h.r1_avatar.selector : (isAvatarPlaying ? 'cached-video' : 'none');
    setHealthPill(healthR1, 'R1', r1Ok, r1Detail);
    setHealthPill(healthR2, 'R2', !!h.r2_messages?.ok, h.r2_messages?.selector);
    setHealthPill(healthR3, 'R3', !!h.r3_input?.ok, h.r3_input?.selector);
    setHealthPill(healthR5, 'R5', !!h.r5_limit?.ok, h.r5_limit?.selector);

    // §17.1 R3（入力欄）の縮退運転: セレクタが見つからない場合は誤送信を防ぎ明示する
    if (h.r3_input && !h.r3_input.ok) {
      chatInput.disabled = true;
      btnSendMessage.disabled = true;
      chatInput.placeholder = '⚠ 入力欄が未検出です（[🖥️] 公式画面をご利用ください）';
    } else {
      chatInput.disabled = false;
      btnSendMessage.disabled = false;
      chatInput.placeholder = 'Muse にメッセージを入力... (Enterで送信)';
    }
  } catch (err) {
    console.warn('runHealthCheck error:', err);
  }
}

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

    // 新着アシスタントメッセージの検知
    if (messages && messages.length > 0) {
      const assistantMsgs = messages.filter(m => m.role === 'assistant');
      const latestAssistant = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1].text : null;
      if (latestAssistant) {
        if (lastSeenAssistantText === null) {
          lastSeenAssistantText = latestAssistant;
        } else if (latestAssistant !== lastSeenAssistantText) {
          lastSeenAssistantText = latestAssistant;
          // 新着メッセージ受信時はMuse本体の動画（発話・表情）も更新されている可能性があるため再同期
          setTimeout(() => loadAvatar(true).catch(() => {}), 600);
          if (document.body.classList.contains('mode-mascot')) {
            playLupinTyping(latestAssistant);
          }
        }
      }
    }

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

async function enterMascotMode() {
  try {
    const newMode = await invoke('enter_mascot_mode');
    applySizeMode(newMode);
    // マスコットモード移行時、最新のMuseメッセージがあればパタパタ表示
    if (lastSeenAssistantText) {
      setTimeout(() => playLupinTyping(lastSeenAssistantText), 300);
    }
  } catch (err) {
    console.error('enterMascotMode error:', err);
  }
}

async function restoreFromMascot() {
  try {
    const newMode = await invoke('restore_from_mascot');
    applySizeMode(newMode);
  } catch (err) {
    console.error('restoreFromMascot error:', err);
  }
}

function applySizeMode(mode) {
  document.body.classList.remove('mode-small', 'mode-large', 'mode-mascot');
  if (mode === 'mascot') {
    document.body.classList.add('mode-mascot');
    setTimeout(updateMascotBubbleDirection, 50);
  } else if (mode === 'large') {
    document.body.classList.add('mode-large');
    hideMascotBubble();
  } else {
    document.body.classList.add('mode-small');
    hideMascotBubble();
  }
}

// ==========================================
// 初期化 & イベントリスナー
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  // ウィンドウドラッグ（通常ヘッダー）
  dragHeader.addEventListener('mousedown', (e) => {
    if (e.target.closest('.header-controls') || e.target.closest('.avatar-wrapper')) return;
    invoke('drag_window').catch(console.error);
  });

  // マスコットモード時のアバタードラッグ
  if (avatarColumn) {
    avatarColumn.addEventListener('mousedown', (e) => {
      if (e.target.closest('#mascot-restore-btn') || e.target.closest('#btn-fetch-avatar') || e.target.closest('#mascot-bubble')) return;
      if (document.body.classList.contains('mode-mascot')) {
        invoke('drag_window').catch(console.error);
      }
    });
  }

  // ドラッグ終了時に位置保存＆吹き出し向きの更新
  window.addEventListener('mouseup', () => {
    if (document.body.classList.contains('mode-mascot')) {
      updateMascotBubbleDirection();
      invoke('save_current_window_position').catch(() => {});
    }
  });

  // 最小化ボタン（マスコットモードへ移行）
  btnMinimize.addEventListener('click', enterMascotMode);

  // マスコット復元ボタン
  if (mascotRestoreBtn) {
    mascotRestoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      restoreFromMascot();
    });
  }

  // 吹き出しクリック（通常画面へ復帰）
  if (mascotBubble) {
    mascotBubble.addEventListener('click', (e) => {
      if (e.target.closest('#btn-bubble-close')) return;
      restoreFromMascot();
    });
  }

  // 吹き出し閉じるボタン
  if (btnBubbleClose) {
    btnBubbleClose.addEventListener('click', (e) => {
      e.stopPropagation();
      hideMascotBubble();
    });
  }

  // 閉じる
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
    await runHealthCheck();
    await loadChatMessages();
    await loadAvatar(false);
    await loadUsageLimit(true);
  });

  // アバタークリック（通常時: 再取得 / マスコット時: 通常画面へ復元、右クリックで吹き出し再生）
  avatarContainer.addEventListener('click', () => {
    if (document.body.classList.contains('mode-mascot')) {
      restoreFromMascot();
    } else {
      loadAvatar(true);
    }
  });

  avatarContainer.addEventListener('contextmenu', (e) => {
    if (document.body.classList.contains('mode-mascot')) {
      e.preventDefault();
      if (lastSeenAssistantText) {
        playLupinTyping(lastSeenAssistantText);
      }
    }
  });
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
      if (config.avatar_name && avatarNameEl) {
        avatarNameEl.textContent = config.avatar_name;
      }
    }
  } catch (e) {
    console.warn('Config load error:', e);
  }

  // 初期データ取得（直列実行＋セッションWebViewのロード待ちリトライ）
  const syncAllSequential = async (forceLimit = false) => {
    await updateSessionStatus();
    await loadAvatar(false);
    await loadUsageLimit(forceLimit);
    await loadChatMessages();
    await runHealthCheck();
  };

  // キャッシュ済みのアバターと利用枠を即時表示
  loadAvatar(false);
  loadUsageLimit(false);

  // セッションWebViewのロード完了に合わせて段階的にチャットとヘルスチェックを同期
  setTimeout(() => syncAllSequential(false), 1800);
  setTimeout(() => syncAllSequential(false), 4000);
  setTimeout(() => syncAllSequential(false), 7000);

  // 12 秒ごとの自動バックグラウンド同期（チャット＆ヘルスチェック）
  setInterval(async () => {
    await updateSessionStatus();
    await runHealthCheck();
    await loadChatMessages();
    if (avatarVideo.classList.contains('hidden')) {
      await loadAvatar(false);
    }
  }, 12000);

  // §16 10 分ごとの利用枠定期自動取得（ガードレール①: セッション画面が非表示のときのみ実行）
  setInterval(async () => {
    await updateSessionStatus();
    if (!isSessionVisible) {
      await loadUsageLimit(true);
    }
  }, 600000);
});
