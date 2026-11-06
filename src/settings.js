// settings.js - Muse Desktop Mascot 設定画面コントローラー

const invoke = window.__TAURI__ ? window.__TAURI__.core.invoke : async (cmd, args) => {
  console.log(`[Mock Settings Invoke] ${cmd}`, args);
  if (cmd === 'get_plugin_configs') {
    return {
      setting: {
        idle_threshold_sec: 180,
        action_interval_sec: 180,
        default_duration_sec: 30,
        bubble_display_duration_sec: 30,
        touch_reaction_duration_sec: 8,
        avatar_name: "ラッキー"
      },
      quotes: {
        touch_reactions: [
          "はーい！呼んだ？",
          "なになに〜？",
          "ここにいるよ！",
          "がんばろうね！"
        ],
        default_idle_quotes: [
          "いつでも呼んでね！",
          "今日もいい天気だね〜",
          "お茶でも飲んで一息つこう！"
        ],
        videos: {
          "eating.mp4": {
            enabled: true,
            duration_sec: 20,
            weight: 2,
            quotes: [
              "もぐもぐ…たい焼き、甘くておいしい〜！",
              "ちょっとおやつタイムにするね♪"
            ]
          },
          "makeup.mp4": {
            enabled: true,
            duration_sec: 20,
            weight: 1,
            quotes: [
              "ちょっと身だしなみチェック中…♪",
              "よし、今日もバッチリかな！"
            ]
          },
          "sleeping.mp4": {
            enabled: true,
            duration_sec: 40,
            weight: 1,
            quotes: [
              "すやぁ…ちょっとだけうたた寝…",
              "ふぁ〜…少し眠くなってきちゃった…zzZ"
            ]
          },
          "smartphone.mp4": {
            enabled: true,
            duration_sec: 20,
            weight: 3,
            quotes: [
              "スマホでちょっとトレンドチェック中〜",
              "ふむふむ、面白いニュース見つけたよ！"
            ]
          }
        }
      }
    };
  }
  return true;
};

// 状態保持
let currentSetting = {};
let currentQuotes = {
  touch_reactions: [],
  default_idle_quotes: [],
  videos: {}
};

// DOM要素
const tabs = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

const inputAvatarName = document.getElementById('input-avatar-name');
const inputIdleThreshold = document.getElementById('input-idle-threshold');
const inputActionInterval = document.getElementById('input-action-interval');
const inputDefaultDuration = document.getElementById('input-default-duration');
const inputBubbleDuration = document.getElementById('input-bubble-duration');
const inputTouchDuration = document.getElementById('input-touch-duration');

const toggleSoundEnabled = document.getElementById('toggle-sound-enabled');
const inputSoundVolume = document.getElementById('input-sound-volume');
const soundVolumeDisplay = document.getElementById('sound-volume-display');
const btnTestSound = document.getElementById('btn-test-sound');

const scaleRadios = document.querySelectorAll('input[name="mascot-scale"]');

const touchQuotesListEl = document.getElementById('touch-quotes-list');
const btnAddTouchQuote = document.getElementById('btn-add-touch-quote');
const idleQuotesListEl = document.getElementById('idle-quotes-list');
const btnAddIdleQuote = document.getElementById('btn-add-idle-quote');

const morningQuotesListEl = document.getElementById('morning-quotes-list');
const btnAddMorningQuote = document.getElementById('btn-add-morning-quote');
const afternoonQuotesListEl = document.getElementById('afternoon-quotes-list');
const btnAddAfternoonQuote = document.getElementById('btn-add-afternoon-quote');
const eveningQuotesListEl = document.getElementById('evening-quotes-list');
const btnAddEveningQuote = document.getElementById('btn-add-evening-quote');
const nightQuotesListEl = document.getElementById('night-quotes-list');
const btnAddNightQuote = document.getElementById('btn-add-night-quote');

// ライブつぶやき生成（ウェイク方式）要素 (Issue #37)
const liveQuotesEnabled = document.getElementById('live-quotes-enabled');
const liveQuotesTargetRadios = document.querySelectorAll('input[name="live-quotes-target-mode"]');
const liveQuotesCustomUrlGroup = document.getElementById('live-quotes-custom-url-group');
const liveQuotesCustomUrl = document.getElementById('live-quotes-custom-url');
const btnFillCurrentChatUrl = document.getElementById('btn-fill-current-chat-url');
const liveQuotesBatchCount = document.getElementById('live-quotes-batch-count');
const liveQuotesMinInterval = document.getElementById('live-quotes-min-interval');
const liveQuotesDailyLimit = document.getElementById('live-quotes-daily-limit');
const liveQuotesQuietStart = document.getElementById('live-quotes-quiet-start');
const liveQuotesQuietEnd = document.getElementById('live-quotes-quiet-end');

function updateLiveQuotesCustomUrlVisibility() {
  const checked = document.querySelector('input[name="live-quotes-target-mode"]:checked');
  const isCustom = checked && checked.value === 'custom';
  if (liveQuotesCustomUrlGroup) {
    liveQuotesCustomUrlGroup.style.display = isCustom ? 'flex' : 'none';
  }
}

liveQuotesTargetRadios.forEach(radio => {
  radio.addEventListener('change', updateLiveQuotesCustomUrlVisibility);
});

if (btnFillCurrentChatUrl) {
  btnFillCurrentChatUrl.addEventListener('click', async () => {
    try {
      btnFillCurrentChatUrl.disabled = true;
      btnFillCurrentChatUrl.textContent = '取得中...';
      const status = await invoke('get_session_status');
      if (status && status.url && (status.url.startsWith('http://') || status.url.startsWith('https://'))) {
        if (liveQuotesCustomUrl) {
          liveQuotesCustomUrl.value = status.url;
        }
        showStatus('現在開いているチャットURLを反映しました', 'success');
      } else {
        showStatus('有効なチャットURLを取得できませんでした（セッションでチャットを開いてから再試行してください）', 'error');
      }
    } catch (err) {
      console.error('Failed to get session status:', err);
      showStatus('URLの取得に失敗しました: ' + (err?.message || err), 'error');
    } finally {
      btnFillCurrentChatUrl.disabled = false;
      btnFillCurrentChatUrl.textContent = '📍 今開いているチャットを登録';
    }
  });
}

const videoSettingsList = document.getElementById('video-settings-list');
const btnAddVideo = document.getElementById('btn-add-video');
const btnOpenAvatarsDir = document.getElementById('btn-open-avatars-dir');
const btnOpenPluginDir = document.getElementById('btn-open-plugin-dir');
const btnResetDefaults = document.getElementById('btn-reset-defaults');

const btnCancel = document.getElementById('btn-cancel');
const btnSave = document.getElementById('btn-save');
const statusMessage = document.getElementById('status-message');

// タブ切り替え制御
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tabPanes.forEach(p => p.classList.remove('active'));

    tab.classList.add('active');
    const targetId = tab.getAttribute('data-tab');
    const pane = document.getElementById(targetId);
    if (pane) pane.classList.add('active');
  });
});

// ステータスメッセージ表示
function showStatus(text, type = 'success', durationMs = 3000) {
  statusMessage.textContent = text;
  statusMessage.className = `status-message ${type}`;
  setTimeout(() => {
    if (statusMessage.textContent === text) {
      statusMessage.textContent = '';
      statusMessage.className = 'status-message';
    }
  }, durationMs);
}

// 汎用文字列セリフリストのレンダリング
function renderSimpleQuotesList(containerEl, quoteArray, emptyPlaceholder) {
  if (!containerEl) return;
  containerEl.innerHTML = '';

  if (!quoteArray || quoteArray.length === 0) {
    containerEl.innerHTML = `<p class="form-hint" style="padding: 6px 0;">${emptyPlaceholder}</p>`;
    return;
  }

  quoteArray.forEach((text, idx) => {
    const row = document.createElement('div');
    row.className = 'quote-row';
    row.innerHTML = `
      <input type="text" value="${(text || '').replace(/"/g, '&quot;')}" placeholder="セリフを入力...">
      <button class="btn-icon-del btn-del" title="削除">×</button>
    `;

    row.querySelector('input').addEventListener('input', (e) => {
      quoteArray[idx] = e.target.value;
    });

    row.querySelector('.btn-del').addEventListener('click', () => {
      quoteArray.splice(idx, 1);
      renderSimpleQuotesList(containerEl, quoteArray, emptyPlaceholder);
    });

    containerEl.appendChild(row);
  });
}

// プラグイン動画カードのレンダリング
function renderVideoList() {
  if (!videoSettingsList) return;
  videoSettingsList.innerHTML = '';

  const videosObj = currentQuotes.videos || {};
  const entries = Object.entries(videosObj);
  if (entries.length === 0) {
    videoSettingsList.innerHTML = '<p class="form-hint" style="padding: 16px; text-align: center;">登録されている放置動画プラグインはありません。</p>';
    return;
  }

  entries.forEach(([videoName, config]) => {
    const card = document.createElement('div');
    card.className = 'video-card';

    const isEnabled = config.enabled !== false;
    const duration = config.duration_sec ?? 30;
    const weight = config.weight ?? 10;
    if (!Array.isArray(config.quotes)) {
      config.quotes = [];
    }

    card.innerHTML = `
      <div class="video-card-header">
        <div class="video-title-area">
          <label class="toggle-switch">
            <input type="checkbox" class="video-enabled-toggle" ${isEnabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
          <span class="video-name">${videoName}</span>
        </div>
        <button class="btn-icon-del btn-del-video" title="この動画設定を削除">🗑️</button>
      </div>

      <div class="video-card-meta">
        <div class="meta-field">
          <label>再生時間 (秒):</label>
          <input type="number" class="video-duration-input" min="5" max="300" value="${duration}">
        </div>
        <div class="meta-field">
          <label>出現ウェイト (比率):</label>
          <input type="number" class="video-weight-input" min="1" max="100" value="${weight}">
        </div>
      </div>

      <div class="quotes-section">
        <div class="quotes-header">
          <span>専用セリフ一覧 (${config.quotes.length}件):</span>
        </div>
        <div class="quotes-list"></div>
        <button class="btn-add-quote">＋ 専用セリフを追加</button>
      </div>
    `;

    // セリフ一覧のレンダリング
    const quotesListEl = card.querySelector('.quotes-list');
    renderSimpleQuotesList(quotesListEl, config.quotes, '専用セリフはありません（無言または標準セリフ再生）');

    // セリフ追加ボタン
    card.querySelector('.btn-add-quote').addEventListener('click', () => {
      config.quotes.push('新しいセリフ');
      renderVideoList();
    });

    // 有効/無効トグル
    card.querySelector('.video-enabled-toggle').addEventListener('change', (e) => {
      config.enabled = e.target.checked;
    });

    // 再生時間
    card.querySelector('.video-duration-input').addEventListener('change', (e) => {
      config.duration_sec = parseInt(e.target.value, 10) || 30;
    });

    // ウェイト
    card.querySelector('.video-weight-input').addEventListener('change', (e) => {
      config.weight = parseInt(e.target.value, 10) || 10;
    });

    // 動画設定削除
    card.querySelector('.btn-del-video').addEventListener('click', () => {
      if (confirm(`動画設定「${videoName}」を削除してもよろしいですか？`)) {
        delete videosObj[videoName];
        renderVideoList();
      }
    });

    videoSettingsList.appendChild(card);
  });
}

// 全セクションの再描画
function renderAllQuotes() {
  renderSimpleQuotesList(touchQuotesListEl, currentQuotes.touch_reactions, 'リアクションセリフが登録されていません。');
  renderSimpleQuotesList(idleQuotesListEl, currentQuotes.default_idle_quotes, '通常つぶやきセリフが登録されていません。');
  if (currentQuotes.time_specific_quotes) {
    renderSimpleQuotesList(morningQuotesListEl, currentQuotes.time_specific_quotes.morning, '朝のセリフが登録されていません。');
    renderSimpleQuotesList(afternoonQuotesListEl, currentQuotes.time_specific_quotes.afternoon, '昼のセリフが登録されていません。');
    renderSimpleQuotesList(eveningQuotesListEl, currentQuotes.time_specific_quotes.evening, '夕方のセリフが登録されていません。');
    renderSimpleQuotesList(nightQuotesListEl, currentQuotes.time_specific_quotes.night, '深夜のセリフが登録されていません。');
  }
  renderVideoList();
}

// 設定ロード
async function loadConfigs() {
  try {
    const res = await invoke('get_plugin_configs');
    currentSetting = res.setting || {};
    const rawQuotes = res.quotes || {};
    const timeQuotes = rawQuotes.time_specific_quotes || {};

    // 構造の正規化
    currentQuotes = {
      touch_reactions: Array.isArray(rawQuotes.touch_reactions) ? rawQuotes.touch_reactions : [],
      default_idle_quotes: Array.isArray(rawQuotes.default_idle_quotes) ? rawQuotes.default_idle_quotes : [],
      time_specific_quotes: {
        morning: Array.isArray(timeQuotes.morning) ? timeQuotes.morning : [],
        afternoon: Array.isArray(timeQuotes.afternoon) ? timeQuotes.afternoon : [],
        evening: Array.isArray(timeQuotes.evening) ? timeQuotes.evening : [],
        night: Array.isArray(timeQuotes.night) ? timeQuotes.night : []
      },
      videos: (rawQuotes.videos && typeof rawQuotes.videos === 'object') ? rawQuotes.videos : {}
    };

    // タイマー・基本設定のバインド
    if (inputAvatarName) inputAvatarName.value = currentSetting.avatar_name || 'ラッキー';
    if (inputIdleThreshold) inputIdleThreshold.value = currentSetting.idle_threshold_sec ?? 180;
    if (inputActionInterval) inputActionInterval.value = currentSetting.action_interval_sec ?? 180;
    if (inputDefaultDuration) inputDefaultDuration.value = currentSetting.default_duration_sec ?? 30;
    if (inputBubbleDuration) inputBubbleDuration.value = currentSetting.bubble_display_duration_sec ?? 30;
    if (inputTouchDuration) inputTouchDuration.value = currentSetting.touch_reaction_duration_sec ?? 8;

    // 効果音設定のバインド (Issue #24)
    if (toggleSoundEnabled) toggleSoundEnabled.checked = currentSetting.sound_enabled !== false;
    const vol = currentSetting.sound_volume ?? 30;
    if (inputSoundVolume) inputSoundVolume.value = vol;
    if (soundVolumeDisplay) soundVolumeDisplay.textContent = `${vol}%`;

    // ライブつぶやき生成（ウェイク方式）のバインド (Issue #37)
    const lq = currentSetting.live_quotes || {};
    if (liveQuotesEnabled) liveQuotesEnabled.checked = lq.enabled === true;
    const targetMode = lq.target_mode === 'custom' ? 'custom' : 'main';
    const targetModeRadio = document.querySelector(`input[name="live-quotes-target-mode"][value="${targetMode}"]`);
    if (targetModeRadio) targetModeRadio.checked = true;
    updateLiveQuotesCustomUrlVisibility();
    if (liveQuotesCustomUrl) liveQuotesCustomUrl.value = lq.custom_chat_url || '';
    if (liveQuotesBatchCount) liveQuotesBatchCount.value = lq.batch_count ?? 4;
    if (liveQuotesMinInterval) liveQuotesMinInterval.value = lq.min_interval_min ?? 60;
    if (liveQuotesDailyLimit) liveQuotesDailyLimit.value = lq.daily_limit ?? 6;
    if (liveQuotesQuietStart) liveQuotesQuietStart.value = lq.quiet_hours_start || '22:00';
    if (liveQuotesQuietEnd) liveQuotesQuietEnd.value = lq.quiet_hours_end || '07:00';

    // マスコット表示サイズ（スケール）のバインド (Issue #25)
    try {
      const gConfig = await invoke('get_gadget_config');
      if (gConfig && gConfig.mascot_scale) {
        const targetRadio = document.querySelector(`input[name="mascot-scale"][value="${gConfig.mascot_scale}"]`);
        if (targetRadio) targetRadio.checked = true;
      }
    } catch (_) {}

    renderAllQuotes();
  } catch (err) {
    console.error('Failed to load configs:', err);
    showStatus('設定の読み込みに失敗しました', 'error');
  }
}

// リアクションセリフ追加ボタン
if (btnAddTouchQuote) {
  btnAddTouchQuote.addEventListener('click', () => {
    currentQuotes.touch_reactions.push('呼んだ？');
    renderSimpleQuotesList(touchQuotesListEl, currentQuotes.touch_reactions, 'リアクションセリフが登録されていません。');
  });
}

// 通常つぶやき追加ボタン
if (btnAddIdleQuote) {
  btnAddIdleQuote.addEventListener('click', () => {
    currentQuotes.default_idle_quotes.push('今日もがんばろうね！');
    renderSimpleQuotesList(idleQuotesListEl, currentQuotes.default_idle_quotes, '通常つぶやきセリフが登録されていません。');
  });
}

// 時間帯別つぶやき追加ボタン
if (btnAddMorningQuote) {
  btnAddMorningQuote.addEventListener('click', () => {
    if (!currentQuotes.time_specific_quotes) currentQuotes.time_specific_quotes = { morning: [], afternoon: [], evening: [], night: [] };
    currentQuotes.time_specific_quotes.morning.push('おはよう！今日も一日がんばろうね！');
    renderSimpleQuotesList(morningQuotesListEl, currentQuotes.time_specific_quotes.morning, '朝のセリフが登録されていません。');
  });
}

if (btnAddAfternoonQuote) {
  btnAddAfternoonQuote.addEventListener('click', () => {
    if (!currentQuotes.time_specific_quotes) currentQuotes.time_specific_quotes = { morning: [], afternoon: [], evening: [], night: [] };
    currentQuotes.time_specific_quotes.afternoon.push('こんにちは！お昼からもファイトだよ！');
    renderSimpleQuotesList(afternoonQuotesListEl, currentQuotes.time_specific_quotes.afternoon, '昼のセリフが登録されていません。');
  });
}

if (btnAddEveningQuote) {
  btnAddEveningQuote.addEventListener('click', () => {
    if (!currentQuotes.time_specific_quotes) currentQuotes.time_specific_quotes = { morning: [], afternoon: [], evening: [], night: [] };
    currentQuotes.time_specific_quotes.evening.push('今日も一日お疲れさま！よくがんばったね！');
    renderSimpleQuotesList(eveningQuotesListEl, currentQuotes.time_specific_quotes.evening, '夕方のセリフが登録されていません。');
  });
}

if (btnAddNightQuote) {
  btnAddNightQuote.addEventListener('click', () => {
    if (!currentQuotes.time_specific_quotes) currentQuotes.time_specific_quotes = { morning: [], afternoon: [], evening: [], night: [] };
    currentQuotes.time_specific_quotes.night.push('夜更かししすぎないようにね！');
    renderSimpleQuotesList(nightQuotesListEl, currentQuotes.time_specific_quotes.night, '深夜のセリフが登録されていません。');
  });
}

// 新しい動画設定の追加
if (btnAddVideo) {
  btnAddVideo.addEventListener('click', () => {
    const fileName = prompt('追加する動画ファイル名を入力してください（例: dance.mp4）:');
    if (!fileName || !fileName.trim()) return;

    const cleanName = fileName.trim().toLowerCase();
    const validName = cleanName.endsWith('.mp4') ? cleanName : `${cleanName}.mp4`;

    if (!currentQuotes.videos) currentQuotes.videos = {};

    if (currentQuotes.videos[validName]) {
      alert(`「${validName}」は既に登録されています。`);
      return;
    }

    currentQuotes.videos[validName] = {
      enabled: true,
      min_idle_sec: 0,
      max_idle_sec: null,
      time_ranges: ["00:00-23:59"],
      duration_sec: 25,
      weight: 2,
      quote_probability: 1.0,
      quotes: ['新しい動画のアクションだよ！']
    };

    renderVideoList();
  });
}

// 音量スライダー変更時
if (inputSoundVolume) {
  inputSoundVolume.addEventListener('input', (e) => {
    if (soundVolumeDisplay) soundVolumeDisplay.textContent = `${e.target.value}%`;
  });
}

// テスト再生処理 (Web Audio API)
let settingsAudioCtx = null;
function playTestPreviewSound() {
  if (!settingsAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) settingsAudioCtx = new AudioContextClass();
  }
  if (settingsAudioCtx && settingsAudioCtx.state === 'suspended') {
    settingsAudioCtx.resume().catch(() => {});
  }
  if (!settingsAudioCtx) return;

  const isEnabled = toggleSoundEnabled ? toggleSoundEnabled.checked : true;
  if (!isEnabled) {
    showStatus('効果音が無効化されています（トグルをONにすると音が鳴ります）', 'error');
    return;
  }

  const volumeRatio = (inputSoundVolume ? parseInt(inputSoundVolume.value, 10) : 30) / 100;
  const ctx = settingsAudioCtx;
  const now = ctx.currentTime;

  // 1. ピコン♪ 通知音
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

  // 2. カタカタカタ… 打鍵音（通知音の直後、0.38秒後に70ms間隔で7打鍵プレビュー）
  const configs = [
    { startFreq: 1400, endFreq: 480, lowFreq: 320, noiseMix: 0.08 },
    { startFreq: 1250, endFreq: 420, lowFreq: 280, noiseMix: 0.06 },
    { startFreq: 1550, endFreq: 520, lowFreq: 350, noiseMix: 0.07 },
    { startFreq: 1350, endFreq: 450, lowFreq: 300, noiseMix: 0.09 },
  ];

  for (let k = 0; k < 7; k++) {
    const keyTime = now + 0.38 + (k * 0.07);
    const duration = 0.035;
    const length = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const cfg = configs[k % configs.length];

    for (let j = 0; j < length; j++) {
      const t = j / ctx.sampleRate;
      const freq1 = cfg.startFreq * Math.exp(-t * 180) + cfg.endFreq;
      const attack = Math.sin(2 * Math.PI * freq1 * t) * Math.exp(-t * 150);
      const bottom = Math.sin(2 * Math.PI * cfg.lowFreq * t) * Math.exp(-t * 100);
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 260) * cfg.noiseMix;
      d[j] = (attack * 0.7 + bottom * 0.3 + noise) * (1 - t / duration);
    }
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = volumeRatio * 0.45;
    s.connect(g);
    g.connect(ctx.destination);
    s.start(keyTime);
  }
}

if (btnTestSound) {
  btnTestSound.addEventListener('click', playTestPreviewSound);
}

// マスコット表示サイズ（スケール）のリアルタイム切替 (Issue #25)
scaleRadios.forEach(radio => {
  radio.addEventListener('change', async (e) => {
    if (e.target.checked) {
      try {
        await invoke('set_mascot_scale', { scale: e.target.value });
      } catch (err) {
        console.warn('Failed to set mascot scale:', err);
      }
    }
  });
});

// フォルダを開くボタン
btnOpenAvatarsDir.addEventListener('click', async () => {
  try {
    await invoke('open_avatar_dir', { target: 'avatars' });
  } catch (err) {
    console.error(err);
    showStatus('フォルダを開けませんでした', 'error');
  }
});

btnOpenPluginDir.addEventListener('click', async () => {
  try {
    await invoke('open_avatar_dir', { target: 'plugin' });
  } catch (err) {
    console.error(err);
    showStatus('フォルダを開けませんでした', 'error');
  }
});

// デフォルト設定にリセット
btnResetDefaults.addEventListener('click', () => {
  if (!confirm('タイマー設定とセリフ設定を初期状態にリセットしますか？')) return;

  if (inputIdleThreshold) inputIdleThreshold.value = 180;
  if (inputActionInterval) inputActionInterval.value = 180;
  if (inputDefaultDuration) inputDefaultDuration.value = 30;
  if (inputBubbleDuration) inputBubbleDuration.value = 30;
  if (inputTouchDuration) inputTouchDuration.value = 8;
  if (toggleSoundEnabled) toggleSoundEnabled.checked = true;
  if (inputSoundVolume) inputSoundVolume.value = 30;
  if (soundVolumeDisplay) soundVolumeDisplay.textContent = '30%';

  if (liveQuotesEnabled) liveQuotesEnabled.checked = false;
  const mainTargetRadio = document.querySelector('input[name="live-quotes-target-mode"][value="main"]');
  if (mainTargetRadio) mainTargetRadio.checked = true;
  updateLiveQuotesCustomUrlVisibility();
  if (liveQuotesCustomUrl) liveQuotesCustomUrl.value = '';
  if (liveQuotesBatchCount) liveQuotesBatchCount.value = 4;
  if (liveQuotesMinInterval) liveQuotesMinInterval.value = 60;
  if (liveQuotesDailyLimit) liveQuotesDailyLimit.value = 6;
  if (liveQuotesQuietStart) liveQuotesQuietStart.value = '22:00';
  if (liveQuotesQuietEnd) liveQuotesQuietEnd.value = '07:00';

  const stdRadio = document.querySelector('input[name="mascot-scale"][value="standard"]');
  if (stdRadio) {
    stdRadio.checked = true;
    invoke('set_mascot_scale', { scale: 'standard' }).catch(() => {});
  }

  currentQuotes = {
    touch_reactions: [
      "はーい！呼んだ？",
      "なになに〜？",
      "ここにいるよ！",
      "がんばろうね！",
      "何か聞きたいことある？",
      "えへへ、よろしくね！"
    ],
    default_idle_quotes: [
      "いつでも呼んでね！",
      "今日もいい天気だね〜",
      "お茶でも飲んで一息つこう！",
      "何か手伝えることがあったら言ってね！"
    ],
    time_specific_quotes: {
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
    },
    videos: {
      "eating.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 20,
        weight: 2,
        quote_probability: 1.0,
        quotes: [
          "もぐもぐ…たい焼き、甘くておいしい〜！",
          "ちょっとおやつタイムにするね♪",
          "頭を使ったあとは甘いものに限るね！"
        ]
      },
      "makeup.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 20,
        weight: 1,
        quote_probability: 1.0,
        quotes: [
          "ちょっと身だしなみチェック中…♪",
          "よし、今日もバッチリかな！",
          "パタパタ…どう？似合うかな？"
        ]
      },
      "sleeping.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 40,
        weight: 1,
        quote_probability: 1.0,
        quotes: [
          "すやぁ…ちょっとだけうたた寝…",
          "ふぁ〜…少し眠くなってきちゃった…zzZ",
          "むにゃむにゃ…いつでも起こしてね…"
        ]
      },
      "smartphone.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 20,
        weight: 3,
        quote_probability: 1.0,
        quotes: [
          "スマホでちょっとトレンドチェック中〜",
          "ふむふむ、面白いニュース見つけたよ！",
          "何か新しい連絡きてないかな〜"
        ]
      },
      "waking.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 30,
        weight: 3,
        quote_probability: 1.0,
        quotes: [
          "ふぁ〜、背伸び！リフレッシュ完了！",
          "ずっと座ってたから、ちょっとストレッチ♪",
          "いつでも動けるように準備万端だよ！"
        ]
      },
      "working.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 30,
        weight: 4,
        quote_probability: 1.0,
        quotes: [
          "カタカタ…次のタスクの予習をしておくね！",
          "今のうちにちょっとメモを整理中…",
          "いつでもサポートできるように準備中だよ！"
        ]
      }
    }
  };

  renderAllQuotes();
  showStatus('初期設定の値をフォームに読み込みました。「保存して適用」を押すと反映されます。');
});

// 保存処理
btnSave.addEventListener('click', async () => {
  try {
    currentSetting.idle_threshold_sec = parseInt(inputIdleThreshold.value, 10) || 180;
    currentSetting.action_interval_sec = parseInt(inputActionInterval.value, 10) || 180;
    currentSetting.default_duration_sec = parseInt(inputDefaultDuration.value, 10) || 30;
    currentSetting.bubble_display_duration_sec = parseInt(inputBubbleDuration.value, 10) || 30;
    currentSetting.touch_reaction_duration_sec = parseInt(inputTouchDuration.value, 10) || 8;
    currentSetting.sound_enabled = toggleSoundEnabled ? toggleSoundEnabled.checked : true;
    currentSetting.sound_volume = inputSoundVolume ? parseInt(inputSoundVolume.value, 10) : 30;

    const checkedTargetMode = document.querySelector('input[name="live-quotes-target-mode"]:checked');
    currentSetting.live_quotes = {
      enabled: liveQuotesEnabled ? liveQuotesEnabled.checked : false,
      target_mode: checkedTargetMode ? checkedTargetMode.value : 'main',
      custom_chat_url: liveQuotesCustomUrl ? liveQuotesCustomUrl.value.trim() : '',
      batch_count: Math.max(1, Math.min(10, parseInt(liveQuotesBatchCount?.value, 10) || 4)),
      min_interval_min: Math.max(10, parseInt(liveQuotesMinInterval?.value, 10) || 60),
      daily_limit: Math.max(1, parseInt(liveQuotesDailyLimit?.value, 10) || 6),
      quiet_hours_start: (liveQuotesQuietStart?.value || '22:00').trim() || '22:00',
      quiet_hours_end: (liveQuotesQuietEnd?.value || '07:00').trim() || '07:00'
    };

    await invoke('save_plugin_configs', {
      setting: currentSetting,
      quotes: currentQuotes
    });

    const checkedScale = document.querySelector('input[name="mascot-scale"]:checked');
    if (checkedScale) {
      await invoke('set_mascot_scale', { scale: checkedScale.value });
    }

    showStatus('設定を保存してマスコットへ適用しました！', 'success');
  } catch (err) {
    console.error('Failed to save configs:', err);
    showStatus(`保存エラー: ${err}`, 'error');
  }
});

// キャンセル / 閉じる
btnCancel.addEventListener('click', async () => {
  try {
    await invoke('close_settings_window');
  } catch (err) {
    console.warn(err);
    window.close();
  }
});

// 初期ロード
document.addEventListener('DOMContentLoaded', loadConfigs);
