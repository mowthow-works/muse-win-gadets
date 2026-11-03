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
const avatarVideoA = document.getElementById('avatar-video-a');
const avatarVideoB = document.getElementById('avatar-video-b');
const avatarFallback = document.getElementById('avatar-fallback');
const btnFetchAvatar = document.getElementById('btn-fetch-avatar');
const avatarNameEl = document.getElementById('avatar-name');
const avatarNameTextEl = document.getElementById('avatar-name-text');
const avatarLimitBadgeEl = document.getElementById('avatar-limit-badge');
const unreadBadgeEl = document.getElementById('unread-badge');
const avatarColumn = document.getElementById('avatar-column');
const mascotRestoreBtn = document.getElementById('mascot-restore-btn');

let unreadCount = 0;

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
let pendingAssistantText = null;
let assistantCommitTimer = null;
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

// ==========================================
// Web Audio API サウンドエンジン (Issue #24)
// ==========================================
let audioCtx = null;
let typingAudioBuffers = [];

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
      initTypingBuffers();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// メカニカルキースイッチの打鍵音バッファを事前生成（4バリエーション）
function initTypingBuffers() {
  if (!audioCtx || typingAudioBuffers.length > 0) return;
  const sampleRate = audioCtx.sampleRate;
  const duration = 0.035; // 35ms の打鍵音
  const length = Math.floor(sampleRate * duration);

  // 4種類の打鍵バリエーション（ピッチや共鳴を少しずつ変えてリアルな人間味を出す）
  const configs = [
    { startFreq: 1400, endFreq: 480, lowFreq: 320, noiseMix: 0.08 },
    { startFreq: 1250, endFreq: 420, lowFreq: 280, noiseMix: 0.06 },
    { startFreq: 1550, endFreq: 520, lowFreq: 350, noiseMix: 0.07 },
    { startFreq: 1350, endFreq: 450, lowFreq: 300, noiseMix: 0.09 },
  ];

  for (let i = 0; i < 4; i++) {
    const buffer = audioCtx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    const cfg = configs[i];

    for (let j = 0; j < length; j++) {
      const t = j / sampleRate;
      // ピッチ急降下（硬質なキースイッチ接触音「カチッ」）
      const freq1 = cfg.startFreq * Math.exp(-t * 180) + cfg.endFreq;
      const attack = Math.sin(2 * Math.PI * freq1 * t) * Math.exp(-t * 150);

      // 底打ちの低音共鳴音「コッ」
      const bottom = Math.sin(2 * Math.PI * cfg.lowFreq * t) * Math.exp(-t * 100);

      // わずかなクリックノイズ（指先とキートップの接触）
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 260) * cfg.noiseMix;

      data[j] = (attack * 0.7 + bottom * 0.3 + noise) * (1 - t / duration);
    }
    typingAudioBuffers.push(buffer);
  }
}

// カタカタタイピング音の再生（心地よい打鍵リズムにスロットリング）
let lastTypingSoundTime = 0;
function playTypingSound() {
  if (pluginSettings.sound_enabled === false) return;
  const ctx = getAudioContext();
  if (!ctx || typingAudioBuffers.length === 0) return;

  const now = ctx.currentTime;
  // 65ms 以内の連続再生はスロットル（秒間約15打鍵の心地よい「カタカタカタ…」リズムを維持）
  if (now - lastTypingSoundTime < 0.065) return;
  lastTypingSoundTime = now;

  const volumeRatio = Math.max(0, Math.min(100, Number(pluginSettings.sound_volume) ?? 30)) / 100;
  if (volumeRatio <= 0) return;

  try {
    const buf = typingAudioBuffers[Math.floor(Math.random() * typingAudioBuffers.length)];
    const source = ctx.createBufferSource();
    source.buffer = buf;

    const gain = ctx.createGain();
    gain.gain.value = volumeRatio * 0.45;

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
  } catch (_) {}
}

// 新着通知音「ピコン♪」（2音アルペジオチャイム）
function playNotificationSound() {
  if (pluginSettings.sound_enabled === false) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const volumeRatio = Math.max(0, Math.min(100, Number(pluginSettings.sound_volume) ?? 30)) / 100;
  if (volumeRatio <= 0) return;

  try {
    const now = ctx.currentTime;
    // 1音目: C6 (1046.5Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1046.5, now);
    gain1.gain.setValueAtTime(volumeRatio * 0.45, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // 2音目: G6 (1567.98Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1567.98, now + 0.08);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(volumeRatio * 0.55, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.35);
  } catch (_) {}
}

// マスコットクリック時の「ポコッ♪」音
function playTouchReactionSound() {
  if (pluginSettings.sound_enabled === false) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const volumeRatio = Math.max(0, Math.min(100, Number(pluginSettings.sound_volume) ?? 30)) / 100;
  if (volumeRatio <= 0) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.05);

    gain.gain.setValueAtTime(volumeRatio * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch (_) {}
}

let currentTypingTargetText = '';
let currentTypingIdx = 0;

function startTypingLoop(text) {
  const delay = Math.min(24, Math.max(10, Math.floor(1600 / Math.max(1, text.length))));

  typingTimer = setInterval(() => {
    if (currentTypingIdx < currentTypingTargetText.length) {
      const char = currentTypingTargetText[currentTypingIdx];
      mascotBubbleText.textContent += char;
      currentTypingIdx++;
      mascotBubbleText.scrollTop = mascotBubbleText.scrollHeight;
      // 空白・改行以外でカタカタタイピング音を再生
      if (char !== ' ' && char !== '\n' && char !== '\r' && char !== '\t' && char !== '　') {
        playTypingSound();
      }
    } else {
      clearInterval(typingTimer);
      typingTimer = null;
      // タイピング完了後、カーソルを少し待って非表示に
      setTimeout(() => {
        if (!typingTimer) mascotBubbleCursor.classList.add('hidden');
      }, 700);
      // setting.json の bubble_display_duration_sec 秒後に自動的にフェードアウト
      const bubbleDurationMs = Math.max(1, Number(pluginSettings.bubble_display_duration_sec) || 30) * 1000;
      autoHideTimer = setTimeout(() => {
        mascotBubble.classList.add('hidden');
      }, bubbleDurationMs);
    }
  }, delay);
}

function playLupinTyping(text) {
  if (!mascotBubble || !mascotBubbleText) return;
  const cleanedText = cleanMascotMessageText(text);
  if (!cleanedText) return;

  updateMascotBubbleDirection();

  // シームレス追記判定 (ストリーミング途中で更新された場合のチラつき・読み直し防止):
  // もし吹き出しが現在表示中（またはタイピング中）で、
  // 新しいテキストが現在のタイピング対象または表示中テキストの「続き（前方一致）」である場合は、
  // 吹き出しを消去・リセットせず、目標テキストを更新して後ろにそのままタイピングを継続する！
  const currentShown = mascotBubbleText.textContent || '';
  const isCurrentlyActive = !mascotBubble.classList.contains('hidden');

  if (isCurrentlyActive && (
    (currentTypingTargetText && cleanedText.startsWith(currentTypingTargetText) && cleanedText.length >= currentTypingTargetText.length) ||
    (currentShown && cleanedText.startsWith(currentShown) && cleanedText.length >= currentShown.length)
  )) {
    currentTypingTargetText = cleanedText;

    // 前のタイピングが既に完了してフェードアウト待ちに入っていた場合はタイピングタイマーを再開
    if (!typingTimer && currentTypingIdx < cleanedText.length) {
      if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
      }
      mascotBubbleCursor.classList.remove('hidden');
      startTypingLoop(cleanedText);
    }
    return;
  }

  // まったく新しい別メッセージの場合は初期化して開始
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
  }
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  currentTypingTargetText = cleanedText;
  currentTypingIdx = 0;
  mascotBubbleText.textContent = '';
  mascotBubbleCursor.classList.remove('hidden');
  mascotBubble.classList.remove('hidden');

  startTypingLoop(cleanedText);
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

// 未読バッジ表示制御 (Issue #20)
function updateUnreadBadge() {
  if (!unreadBadgeEl) return;
  if (unreadCount > 0) {
    unreadBadgeEl.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    unreadBadgeEl.title = `未読メッセージが ${unreadCount} 件あります（クリックで開く）`;
    unreadBadgeEl.classList.remove('hidden');
    unreadBadgeEl.style.display = 'flex';
  } else {
    unreadBadgeEl.textContent = '';
    unreadBadgeEl.classList.add('hidden');
    unreadBadgeEl.style.display = 'none';
  }
}

function clearUnreadBadge() {
  unreadCount = 0;
  updateUnreadBadge();
}

// Muse のストリーミング返信がすべて完了した瞬間に確定表示するコミット関数
let lastCommittedAssistantText = null;

function commitPendingAssistantMessage() {
  if (assistantCommitTimer) {
    clearTimeout(assistantCommitTimer);
    assistantCommitTimer = null;
  }
  if (!pendingAssistantText || pendingAssistantText === lastSeenAssistantText) {
    return;
  }
  const textToPlay = pendingAssistantText;
  const isExtension = !!(lastCommittedAssistantText && textToPlay.startsWith(lastCommittedAssistantText));
  lastSeenAssistantText = textToPlay;
  lastCommittedAssistantText = textToPlay;
  pendingAssistantText = null;

  recordInteraction();
  // 回答完了の歓喜ポーズ（6秒間）
  setAvatarState('milestone_level_up', { durationMs: 6000, force: true, lockDuration: true });
  if (document.body.classList.contains('mode-mascot')) {
    playLupinTyping(textToPlay);
  }

  // セッション画面が表に出ていない場合は未読バッジをカウントアップ (同一メッセージのストリーミング延長なら二重加算しない)
  if (!isSessionVisible && !isExtension) {
    unreadCount++;
    updateUnreadBadge();
    playNotificationSound();
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
    if (h.avatar_name) {
      if (avatarNameTextEl) {
        avatarNameTextEl.textContent = h.avatar_name;
      } else if (avatarNameEl) {
        avatarNameEl.textContent = h.avatar_name;
      }
    }

    if (h.avatar_state) {
      if (h.avatar_state === 'working' || h.avatar_state === 'making_something') {
        recordInteraction();
        setAvatarState(h.avatar_state);
      } else if (h.avatar_state === 'milestone_level_up') {
        recordInteraction();
        setAvatarState('milestone_level_up', { durationMs: 4000 });
      }
    }

    const isAvatarPlaying = !!avatarVideoPack && (
      (!avatarVideoA?.classList.contains('hidden') && !!avatarVideoA?.src) ||
      (!avatarVideoB?.classList.contains('hidden') && !!avatarVideoB?.src)
    );
    const r1Ok = !!h.r1_avatar?.ok || isAvatarPlaying;
    const r1Detail = isAvatarPlaying ? 'video-pack' : (h.r1_avatar?.ok ? h.r1_avatar.selector : 'none');
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
// 1. アバター動画エンジン (500ms クロスフェード & ステートマシン)
// ==========================================
let avatarVideoPack = null;
let pluginItems = [];
let lastPickedPluginKey = null;
let currentAvatarState = 'idle';
let currentActiveSlot = 'a'; // 'a' or 'b'
let stateTimer = null;
let isSpecialActionLocked = false;
let specialActionTimer = null;
let lastUserInteractionTime = Date.now();
let lastPluginActionEndTime = 0;

// setting.json の設定値（ホットリロード対応）
let pluginSettings = {
  idle_threshold_sec: 180,
  action_interval_sec: 15,
  default_action_duration_sec: 30,
  touch_reaction_duration_sec: 8,
  bubble_display_duration_sec: 30,
  avoid_repeat_video: true,
  sound_enabled: true,
  sound_volume: 30
};

// quotes.json の動画別設定マップ（ホットリロード対応）
let videoQuotesConfigMap = {};

// 放置（アイドル）時のデフォルト気まぐれつぶやき（quotes.json で上書き可能）
let defaultIdleQuotesList = [
  "いつでも呼んでね！",
  "今日もいい天気だね〜",
  "お茶でも飲んで一息つこう！",
  "何か手伝えることがあったら言ってね！"
];

// タッチ（クリック）時のリアクションつぶやき（quotes.json で上書き可能）
let touchReactionsList = [
  "はーい！呼んだ？",
  "なになに〜？",
  "ここにいるよ！",
  "がんばろうね！",
  "何か聞きたいことある？",
  "えへへ、よろしくね！"
];

// 時間帯に応じたつぶやき（朝・昼・夕方・深夜）（quotes.json で上書き可能）
let timeSpecificQuotesMap = {
  morning: [
    "おはよう！今日も一日がんばろうね！",
    "朝の空気、気持ちいいね！深呼吸してみて！",
    "朝ごはんは食べた？しっかりエネルギー補給しよう！"
  ],
  afternoon: [
    "こんにちは！お昼からもファイトだよ！",
    "少し休憩してお茶でも飲まない？",
    "集中しててすごい！でもたまには肩の力を抜いてね。"
  ],
  evening: [
    "今日も一日お疲れさま！よくがんばったね！",
    "そろそろ夕暮れ時だね〜。今日の予定はひと段落ついた？",
    "暗くなってきたね。目を休めながら進めよう！"
  ],
  night: [
    "夜更かししすぎないようにね！",
    "もう遅い時間だから、無理せず休んでね。",
    "今日もたくさん進んだね！おやすみなさい…zzz"
  ]
};

function getCurrentTimeSlot() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function pickRandomIdleQuote(candidateQuotes = null) {
  const slot = getCurrentTimeSlot();
  const timeQuotes = timeSpecificQuotesMap[slot] || [];

  // もしプラグイン動画固有のセリフが明示的にあり、かつデフォルト一覧と異なる場合
  if (candidateQuotes && candidateQuotes.length > 0 && candidateQuotes !== defaultIdleQuotesList) {
    if (timeQuotes.length > 0 && Math.random() < 0.3) {
      return timeQuotes[Math.floor(Math.random() * timeQuotes.length)];
    }
    return candidateQuotes[Math.floor(Math.random() * candidateQuotes.length)];
  }

  // デフォルトまたは候補なしの場合:
  // 現在の時間帯セリフがあれば 70% の確率で時間帯セリフ、30% の確率で通常の放置セリフ
  if (timeQuotes.length > 0 && (defaultIdleQuotesList.length === 0 || Math.random() < 0.7)) {
    return timeQuotes[Math.floor(Math.random() * timeQuotes.length)];
  }
  if (defaultIdleQuotesList.length > 0) {
    return defaultIdleQuotesList[Math.floor(Math.random() * defaultIdleQuotesList.length)];
  }
  if (timeQuotes.length > 0) {
    return timeQuotes[Math.floor(Math.random() * timeQuotes.length)];
  }
  return '';
}

function applyPluginConfigs(setting, quotes) {
  if (setting && typeof setting === 'object') {
    if (setting.idle_threshold_sec !== undefined) {
      pluginSettings.idle_threshold_sec = Math.max(1, Number(setting.idle_threshold_sec) || 180);
    }
    if (setting.action_interval_sec !== undefined) {
      pluginSettings.action_interval_sec = Math.max(1, Number(setting.action_interval_sec) || 15);
    }
    if (setting.default_action_duration_sec !== undefined) {
      pluginSettings.default_action_duration_sec = Math.max(1, Number(setting.default_action_duration_sec) || 30);
    }
    if (setting.touch_reaction_duration_sec !== undefined) {
      pluginSettings.touch_reaction_duration_sec = Math.max(1, Number(setting.touch_reaction_duration_sec) || 8);
    }
    if (setting.bubble_display_duration_sec !== undefined) {
      pluginSettings.bubble_display_duration_sec = Math.max(1, Number(setting.bubble_display_duration_sec) || 30);
    }
    if (setting.avoid_repeat_video !== undefined) {
      pluginSettings.avoid_repeat_video = Boolean(setting.avoid_repeat_video);
    }
    if (setting.sound_enabled !== undefined) {
      pluginSettings.sound_enabled = Boolean(setting.sound_enabled);
    }
    if (setting.sound_volume !== undefined) {
      pluginSettings.sound_volume = Math.max(0, Math.min(100, Number(setting.sound_volume) || 30));
    }
  }

  if (quotes && typeof quotes === 'object') {
    if (Array.isArray(quotes.touch_reactions) && quotes.touch_reactions.length > 0) {
      touchReactionsList = quotes.touch_reactions;
    }
    if (Array.isArray(quotes.default_idle_quotes) && quotes.default_idle_quotes.length > 0) {
      defaultIdleQuotesList = quotes.default_idle_quotes;
    }
    if (quotes.time_specific_quotes && typeof quotes.time_specific_quotes === 'object') {
      timeSpecificQuotesMap = {
        morning: Array.isArray(quotes.time_specific_quotes.morning) ? quotes.time_specific_quotes.morning : [],
        afternoon: Array.isArray(quotes.time_specific_quotes.afternoon) ? quotes.time_specific_quotes.afternoon : [],
        evening: Array.isArray(quotes.time_specific_quotes.evening) ? quotes.time_specific_quotes.evening : [],
        night: Array.isArray(quotes.time_specific_quotes.night) ? quotes.time_specific_quotes.night : []
      };
    }
    if (quotes.videos && typeof quotes.videos === 'object') {
      videoQuotesConfigMap = quotes.videos;
    }
  }
}

async function refreshPluginConfigs() {
  try {
    const res = await invoke('get_plugin_configs');
    if (res) {
      applyPluginConfigs(res.setting, res.quotes);
    }
  } catch (_) {}
}

function getVideoConfig(fileName) {
  const stem = fileName.replace(/\.mp4$/i, '');
  const raw = videoQuotesConfigMap[fileName] || videoQuotesConfigMap[stem];
  const defaultDuration = pluginSettings.default_action_duration_sec || 30;

  if (!raw) {
    return {
      enabled: true,
      min_idle_sec: 0,
      max_idle_sec: null,
      time_ranges: ['00:00-23:59'],
      duration_sec: defaultDuration,
      weight: 1,
      quote_probability: 1.0,
      quotes: defaultIdleQuotesList
    };
  }

  // 配列形式で直接セリフリストだけが書かれている場合の後方互換
  if (Array.isArray(raw)) {
    return {
      enabled: true,
      min_idle_sec: 0,
      max_idle_sec: null,
      time_ranges: ['00:00-23:59'],
      duration_sec: defaultDuration,
      weight: 1,
      quote_probability: 1.0,
      quotes: raw.length > 0 ? raw : defaultIdleQuotesList
    };
  }

  return {
    enabled: raw.enabled !== false,
    min_idle_sec: Number(raw.min_idle_sec) || 0,
    max_idle_sec: raw.max_idle_sec != null ? Number(raw.max_idle_sec) : null,
    time_ranges: Array.isArray(raw.time_ranges) && raw.time_ranges.length > 0 ? raw.time_ranges : ['00:00-23:59'],
    duration_sec: Number(raw.duration_sec) || defaultDuration,
    weight: Math.max(0, Number(raw.weight !== undefined ? raw.weight : 1)),
    quote_probability: raw.quote_probability !== undefined ? Number(raw.quote_probability) : 1.0,
    quotes: Array.isArray(raw.quotes) && raw.quotes.length > 0 ? raw.quotes : defaultIdleQuotesList
  };
}

function isWithinTimeRanges(timeRanges) {
  if (!Array.isArray(timeRanges) || timeRanges.length === 0) return true;
  const now = new Date();
  const curMin = now.getHours() * 60 + now.getMinutes();

  for (const rangeStr of timeRanges) {
    if (typeof rangeStr !== 'string') continue;
    const m = rangeStr.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const startMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const endMin = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
    if (startMin <= endMin) {
      if (curMin >= startMin && curMin <= endMin) return true;
    } else {
      // 日跨ぎ (例: "22:00-07:00")
      if (curMin >= startMin || curMin <= endMin) return true;
    }
  }
  return false;
}

function recordInteraction() {
  lastUserInteractionTime = Date.now();
  lastPluginActionEndTime = 0;
}

function dataUrlToBlobUrl(dataUrl) {
  try {
    if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'video/mp4';
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    const blob = new Blob([u8arr], { type: mime });
    return URL.createObjectURL(blob);
  } catch (_) {
    return dataUrl;
  }
}

async function loadAvatar(forceRefresh = false) {
  if (avatarVideoPack && !forceRefresh) {
    return true;
  }
  try {
    const pack = await invoke('get_avatar_video_pack');
    if (pack) {
      applyPluginConfigs(pack.setting, pack.quotes);
    }

    let idleDataUrl = pack && pack.idle ? pack.idle : '';
    // もし avatars/idle.mp4 が未配置（git clone 直後など）の場合は、セッションWebViewから自動取得してフォールバック
    if (!idleDataUrl) {
      try {
        idleDataUrl = await invoke('get_avatar_data_url', { forceRefresh });
      } catch (_) {}
    }

    if (idleDataUrl) {
      const idleBlobUrl = dataUrlToBlobUrl(idleDataUrl);
      const nextPack = {
        idle: idleBlobUrl,
        waking: pack && pack.waking ? dataUrlToBlobUrl(pack.waking) : idleBlobUrl,
        working: pack && pack.working ? dataUrlToBlobUrl(pack.working) : idleBlobUrl,
        making_something: pack && pack.making_something ? dataUrlToBlobUrl(pack.making_something) : idleBlobUrl,
        milestone_level_up: pack && pack.milestone_level_up ? dataUrlToBlobUrl(pack.milestone_level_up) : idleBlobUrl
      };

      const loadedPlugins = [];
      if (Array.isArray(pack.plugins)) {
        for (const item of pack.plugins) {
          if (item && item.name && item.data_url) {
            const stateKey = `plugin:${item.name}`;
            nextPack[stateKey] = dataUrlToBlobUrl(item.data_url);
            loadedPlugins.push({
              stateKey,
              name: item.name
            });
          }
        }
      }

      avatarVideoPack = nextPack;
      pluginItems = loadedPlugins;
      currentAvatarState = 'idle';
      currentActiveSlot = 'a';
      if (avatarVideoA) {
        avatarVideoA.src = avatarVideoPack.idle;
        avatarVideoA.classList.add('active');
        avatarVideoA.classList.remove('hidden');
        avatarVideoA.play().catch(() => {});
      }
      if (avatarVideoB) {
        avatarVideoB.classList.remove('active');
      }
      if (avatarFallback) avatarFallback.style.display = 'none';
      return true;
    }
  } catch (err) {
    console.warn('loadAvatar error:', err);
  }
  if (avatarFallback) avatarFallback.style.display = 'flex';
  return false;
}

function setAvatarState(targetState, options = {}) {
  const { durationMs = 0, force = false, lockDuration = false } = options;
  if (!avatarVideoPack) return;
  const newSrc = avatarVideoPack[targetState];
  if (!newSrc) return;

  // 特殊アクション（タッチや3分放置アクション）ロック中は、強制指定以外の上書きを抑制
  if (isSpecialActionLocked && !force) {
    return;
  }

  // ロック時間の更新
  if (lockDuration && durationMs > 0) {
    isSpecialActionLocked = true;
    if (specialActionTimer) clearTimeout(specialActionTimer);
    specialActionTimer = setTimeout(() => {
      isSpecialActionLocked = false;
      specialActionTimer = null;
    }, durationMs);
  } else if (force && !lockDuration) {
    isSpecialActionLocked = false;
    if (specialActionTimer) {
      clearTimeout(specialActionTimer);
      specialActionTimer = null;
    }
  }

  // 自動復帰タイマーの更新
  if (stateTimer) {
    clearTimeout(stateTimer);
    stateTimer = null;
  }
  if (durationMs > 0 && targetState !== 'idle') {
    stateTimer = setTimeout(() => {
      isSpecialActionLocked = false;
      if (specialActionTimer) {
        clearTimeout(specialActionTimer);
        specialActionTimer = null;
      }
      lastPluginActionEndTime = Date.now();
      setAvatarState('idle', { force: true });
    }, durationMs);
  }

  // すでに同じステートの動画を再生中の場合は、絶対に <video> スロット切替・再読込を行わない（ちらつき防止）
  if (currentAvatarState === targetState) {
    return;
  }

  currentAvatarState = targetState;

  // スロットの切り替え（A <-> B）で 500ms クロスフェード
  const incomingSlot = currentActiveSlot === 'a' ? avatarVideoB : avatarVideoA;
  const outgoingSlot = currentActiveSlot === 'a' ? avatarVideoA : avatarVideoB;

  if (incomingSlot) {
    if (incomingSlot.src !== newSrc) {
      incomingSlot.src = newSrc;
    }
    incomingSlot.classList.remove('hidden');
    const onPlayReady = () => {
      incomingSlot.classList.add('active');
      if (outgoingSlot) {
        outgoingSlot.classList.remove('active');
      }
      currentActiveSlot = currentActiveSlot === 'a' ? 'b' : 'a';
    };

    incomingSlot.play().then(onPlayReady).catch(() => {
      onPlayReady();
    });
  }
}

// 放置時間・時間帯に応じた「気まぐれアクション（plugin フォルダ内動画の条件付きランダムピックアップ）」
function checkIdleAction() {
  if (currentAvatarState !== 'idle' || isSpecialActionLocked) {
    return;
  }

  const now = Date.now();
  const totalInactiveSec = (now - lastUserInteractionTime) / 1000;
  const thresholdSec = Math.max(1, Number(pluginSettings.idle_threshold_sec) || 15);

  // まだ IDLE 突入時間（idle_threshold_sec）に達していない場合は何もしない
  if (totalInactiveSec < thresholdSec) {
    return;
  }

  // 前回のプラグイン動画再生終了から action_interval_sec 秒経過しているか確認
  if (lastPluginActionEndTime > 0) {
    const sinceLastEndSec = (now - lastPluginActionEndTime) / 1000;
    const intervalSec = Math.max(1, Number(pluginSettings.action_interval_sec) || thresholdSec);
    if (sinceLastEndSec < intervalSec) {
      return;
    }
  }

  // IDLE に入ってからの経過時間（秒）
  const idleElapsedSec = Math.max(0, totalInactiveSec - thresholdSec);

  if (pluginItems.length > 0) {
    // 1. quotes.json の動画別条件（enabled, min_idle_sec, max_idle_sec, time_ranges, weight）でフィルタリング
    let eligible = pluginItems
      .map(item => ({ item, cfg: getVideoConfig(item.name) }))
      .filter(({ cfg }) => {
        if (!cfg.enabled || cfg.weight <= 0) return false;
        if (idleElapsedSec < cfg.min_idle_sec) return false;
        if (cfg.max_idle_sec !== null && idleElapsedSec > cfg.max_idle_sec) return false;
        if (!isWithinTimeRanges(cfg.time_ranges)) return false;
        return true;
      });

    if (eligible.length === 0) {
      return;
    }

    // 2. 連続再生回避設定（avoid_repeat_video）が true で候補が 2 件以上ある場合は前回動画を除外
    if (pluginSettings.avoid_repeat_video && eligible.length > 1 && lastPickedPluginKey) {
      eligible = eligible.filter(e => e.item.stateKey !== lastPickedPluginKey);
    }

    // 3. weight（重み）に基づくランダム抽選
    const totalWeight = eligible.reduce((sum, e) => sum + e.cfg.weight, 0);
    let r = Math.random() * totalWeight;
    let selected = eligible[eligible.length - 1];
    for (const entry of eligible) {
      r -= entry.cfg.weight;
      if (r <= 0) {
        selected = entry;
        break;
      }
    }

    lastPickedPluginKey = selected.item.stateKey;
    const durationMs = Math.max(1, selected.cfg.duration_sec) * 1000;

    setAvatarState(selected.item.stateKey, { durationMs, lockDuration: true, force: true });

    // 4. セリフ表示（quote_probability に応じて表示）
    if (document.body.classList.contains('mode-mascot') && Math.random() <= selected.cfg.quote_probability) {
      const quote = pickRandomIdleQuote(selected.cfg.quotes);
      if (quote) {
        playLupinTyping(quote);
      }
    }
  } else {
    const durationMs = Math.max(1, pluginSettings.default_action_duration_sec || 30) * 1000;
    const randomAction = Math.random() < 0.5 ? 'waking' : 'working';
    setAvatarState(randomAction, { durationMs, lockDuration: true, force: true });
    if (document.body.classList.contains('mode-mascot')) {
      const quote = pickRandomIdleQuote();
      if (quote) {
        playLupinTyping(quote);
      }
    }
  }
}

// Muse 本体のリアルタイム動作状態同期
async function syncAvatarStateWithMuse() {
  try {
    const res = await invoke('get_avatar_state');
    if (res && res.state) {
      if (res.state === 'working' || res.state === 'making_something' || res.state === 'waking') {
        recordInteraction();
        setAvatarState(res.state, { force: true });
      } else if (res.state === 'milestone_level_up') {
        recordInteraction();
        setAvatarState('milestone_level_up', { durationMs: 6000, lockDuration: true, force: true });
      } else if (res.state === 'idle') {
        // Muse本体の作業が完了して idle に戻った場合、もし保留中の返信メッセージがあれば即座に全文表示
        if (pendingAssistantText && pendingAssistantText !== lastSeenAssistantText) {
          commitPendingAssistantMessage();
        }
        // タッチリアクション中や3分放置アクション中は idle で上書きしない
        if (!isSpecialActionLocked) {
          if (currentAvatarState === 'working' || currentAvatarState === 'making_something') {
            // Muse本体の作業が完了して idle に戻った直後は 5 秒間歓喜ポーズを表示してから idle へ
            setAvatarState('milestone_level_up', { durationMs: 5000, lockDuration: true, force: true });
          } else if (currentAvatarState !== 'idle') {
            setAvatarState('idle');
          }
        }
      }
    }
  } catch (_) {}
}

// ==========================================
// 2. チャットスレッド (R2)
// ==========================================
async function loadChatMessages() {
  chatSyncIndicator.classList.add('syncing');
  try {
    const messages = await invoke('get_chat_messages', { limit: currentLimit });
    renderMessages(messages);

    // 新着アシスタントメッセージの検知 & 会話連動のアバター状態同期
    if (messages && messages.length > 0) {
      const assistantMsgs = messages.filter(m => m.role === 'assistant');
      const latestAssistant = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1].text : null;
      if (latestAssistant) {
        if (lastSeenAssistantText === null) {
          // 初回起動時: 過去の最新メッセージを記録するのみ（初回起動でいきなり過去ログをタイピングしない）
          lastSeenAssistantText = latestAssistant;
        } else if (latestAssistant !== lastSeenAssistantText) {
          // 新着、またはストリーミング途中のメッセージを受信
          pendingAssistantText = latestAssistant;
          recordInteraction();

          if (assistantCommitTimer) {
            clearTimeout(assistantCommitTimer);
            assistantCommitTimer = null;
          }

          // Muse 本体の動作状態を判定（作業中・返信中なら吹き出しは出さず全文完了を待つ）
          const isMuseBusy = (currentAvatarState === 'working' || currentAvatarState === 'making_something');

          if (isMuseBusy) {
            // 生成中は吹き出しを出さず待機（アバターは作業中動画を継続）
          } else {
            // テキストの増加・更新が止まって 2.5 秒経過したら「生成完了（全文確定）」とみなして一度だけ綺麗に表示
            assistantCommitTimer = setTimeout(() => {
              commitPendingAssistantMessage();
            }, 2500);
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
  recordInteraction();
  setAvatarState('working');

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
        const pct = limit.remaining_percent;
        limitPercentText.textContent = `残 ${pct}%`;
        limitProgressBar.style.width = `${pct}%`;

        limitProgressBar.className = 'progress-bar';
        let limitLevel = 'safe';
        if (pct >= 80) {
          limitLevel = 'safe';
          limitPercentText.style.color = 'var(--color-safe)';
        } else if (pct >= 30) {
          limitLevel = 'warn';
          limitProgressBar.classList.add('warn');
          limitPercentText.style.color = 'var(--color-warn)';
        } else {
          limitLevel = 'danger';
          limitProgressBar.classList.add('danger');
          limitPercentText.style.color = 'var(--color-danger)';
        }

        // マスコットのアバター外枠色とグロー効果を連動 (Issue #19)
        if (avatarContainer) {
          avatarContainer.classList.remove('limit-safe', 'limit-warn', 'limit-danger');
          avatarContainer.classList.add(`limit-${limitLevel}`);
        }

        // ネームプレート内の % バッジを更新 (Issue #19)
        if (avatarLimitBadgeEl) {
          avatarLimitBadgeEl.textContent = `${pct}%`;
          avatarLimitBadgeEl.className = `avatar-limit-badge limit-${limitLevel}`;
          avatarLimitBadgeEl.title = `利用可能枠: 残り ${pct}% (${limit.reset_text || ''})`;
        }
      } else {
        limitPercentText.textContent = '--%';
        limitProgressBar.style.width = '0%';
        if (avatarContainer) {
          avatarContainer.classList.remove('limit-safe', 'limit-warn', 'limit-danger');
        }
        if (avatarLimitBadgeEl) {
          avatarLimitBadgeEl.textContent = '--%';
          avatarLimitBadgeEl.className = 'avatar-limit-badge';
        }
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
    if (isSessionVisible) {
      clearUnreadBadge();
    }
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
    recordInteraction();
    setAvatarState('waking', { durationMs: 3500 });
  } catch (err) {
    console.error('enterMascotMode error:', err);
  }
}

async function restoreFromMascot() {
  try {
    clearUnreadBadge();
    // 中・小画面の代わりにセッションウィンドウ（公式画面）を前面表示
    await invoke('open_or_show_session');
  } catch (err) {
    console.error('restoreFromMascot to session error:', err);
  }
}

// （温存）旧ガジェット中・小画面への復元処理
async function restoreToLegacyGadget() {
  try {
    const newMode = await invoke('restore_from_mascot');
    applySizeMode(newMode);
  } catch (err) {
    console.error('restoreToLegacyGadget error:', err);
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

function applyMascotScale(scale) {
  document.body.classList.remove('scale-small', 'scale-standard', 'scale-large');
  const validScale = (scale === 'large' || scale === 'small') ? scale : 'standard';
  document.body.classList.add(`scale-${validScale}`);
  setTimeout(updateMascotBubbleDirection, 50);
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

  // マスコットモード時のアバタードラッグ＆クリック分離制御
  let isPointerDownOnAvatar = false;
  let isDraggingAvatar = false;
  let avatarDownX = 0;
  let avatarDownY = 0;

  // ネームプレート（ラッキー）は即時ドラッグ
  if (avatarNameEl) {
    avatarNameEl.addEventListener('mousedown', (e) => {
      if (document.body.classList.contains('mode-mascot')) {
        invoke('drag_window').catch(console.error);
      }
    });
  }

  // アバター本体（avatarContainer）: 押下開始
  avatarContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('#mascot-restore-btn') || e.target.closest('#btn-fetch-avatar')) return;
    isPointerDownOnAvatar = true;
    isDraggingAvatar = false;
    avatarDownX = e.screenX;
    avatarDownY = e.screenY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPointerDownOnAvatar || isDraggingAvatar) return;
    const dx = e.screenX - avatarDownX;
    const dy = e.screenY - avatarDownY;
    if (Math.hypot(dx, dy) > 6) {
      isDraggingAvatar = true;
      if (document.body.classList.contains('mode-mascot')) {
        invoke('drag_window').catch(console.error);
      }
    }
  });

  // ドラッグ終了またはクリック判定
  window.addEventListener('mouseup', () => {
    if (isPointerDownOnAvatar) {
      const wasDragging = isDraggingAvatar;
      isPointerDownOnAvatar = false;
      isDraggingAvatar = false;

      // 6px 未満の移動で離した場合はクリックとして実行
      if (!wasDragging) {
        handleAvatarClickAction();
      }
    }

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

  // アバタークリック制御（シングルクリック: つついて喜ぶリアクション / ダブルクリック: 画面復元）
  let avatarClickTimer = null;
  let avatarClickCount = 0;

  function handleAvatarClickAction() {
    recordInteraction();
    avatarClickCount++;
    if (avatarClickCount === 1) {
      avatarClickTimer = setTimeout(() => {
        avatarClickCount = 0;
        // シングルクリック: つついて反応（setting.json の touch_reaction_duration_sec 秒間維持 + つぶやき）
        const touchDurationMs = Math.max(1, Number(pluginSettings.touch_reaction_duration_sec) || 8) * 1000;
        setAvatarState('milestone_level_up', { durationMs: touchDurationMs, lockDuration: true, force: true });
        playTouchReactionSound();
        if (document.body.classList.contains('mode-mascot') && touchReactionsList.length > 0) {
          const reaction = touchReactionsList[Math.floor(Math.random() * touchReactionsList.length)];
          playLupinTyping(reaction);
        }
      }, 260);
    } else if (avatarClickCount >= 2) {
      clearTimeout(avatarClickTimer);
      avatarClickCount = 0;
      // ダブルクリック: 通常画面（またはセッション）へ復元
      if (document.body.classList.contains('mode-mascot')) {
        restoreFromMascot();
      } else {
        openOrShowSession();
      }
    }
  }

  avatarContainer.addEventListener('contextmenu', (e) => {
    recordInteraction();
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

  // 未読バッジクリック時: 既読クリアしてセッション画面を開く (Issue #20)
  if (unreadBadgeEl) {
    unreadBadgeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      clearUnreadBadge();
      restoreFromMascot();
    });
  }

  // セッション画面が前面化・開かれた際の未読クリアイベントを受信 (Issue #20)
  if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
    window.__TAURI__.event.listen('clear-unread', () => {
      clearUnreadBadge();
    });
    // GUI設定画面で設定が保存された際のホットリロード即時反映 (Issue #13)
    window.__TAURI__.event.listen('settings-updated', () => {
      refreshPluginConfigs();
    });
    // マスコットのスケール変更イベントを受信 (Issue #25)
    window.__TAURI__.event.listen('mascot-scale-changed', (event) => {
      applyMascotScale(event.payload);
    });
  }

  // 初期起動時は確実に未読バッジを非表示 (Issue #20)
  clearUnreadBadge();

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
      applyMascotScale(config.mascot_scale || 'standard');
      if (config.message_limit) {
        currentLimit = config.message_limit;
        msgLimitSelect.value = String(currentLimit);
      }
      if (config.avatar_name) {
        if (avatarNameTextEl) {
          avatarNameTextEl.textContent = config.avatar_name;
        } else if (avatarNameEl) {
          avatarNameEl.textContent = config.avatar_name;
        }
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

  // 3秒ごとのリアルタイム動作状態・チャット同期 ＆ 設定ホットリロード・放置監視
  setInterval(async () => {
    await refreshPluginConfigs();
    await loadChatMessages();
    await syncAvatarStateWithMuse();
    checkIdleAction();
  }, 3000);

  // 12 秒ごとの自動バックグラウンド同期（チャット＆ヘルスチェック）
  setInterval(async () => {
    await updateSessionStatus();
    await runHealthCheck();
    await loadChatMessages();
  }, 12000);

  // §16 10 分ごとの利用枠定期自動取得（ガードレール①: セッション画面が非表示のときのみ実行）
  setInterval(async () => {
    await updateSessionStatus();
    if (!isSessionVisible) {
      await loadUsageLimit(true);
    }
  }, 600000);
});
