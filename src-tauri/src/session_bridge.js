/**
 * session_bridge.js
 *
 * Muse (https://muse.ai/?__pwa=1) のセッション WebView 内で実行される DOM 調査・操作スクリプト。
 * 設計書 §4・§16・§17 に従い、DOM セレクタとリモート処理はすべて本ファイルに集約されます。
 *
 * 通信方式: Document Title Bridge (即時通信 + チャンク分割ハンドシェイク Pull)
 */

window.__MUSE_STORE__ = window.__MUSE_STORE__ || {};
window.__MUSE_CACHED_LIMIT__ = window.__MUSE_CACHED_LIMIT__ || null;

/**
 * §17.2 セレクタの多重化定義
 * アクセシビリティ向け属性 (aria-label, placeholder, .sr-only) を最優先し、
 * 変更されやすいクラス名 (hatch-*, group/msg) は予備候補として定義。
 */
const SELECTORS = {
  avatarVideo: [
    'video[src^="blob:"]',
    'video'
  ],
  messageItems: [
    '[class*="group/msg"]',
    'main [ data-message-id ]'
  ],
  messageBubble: [
    '.prose',
    '[class*="hatch-chat-groupable-bubble"]'
  ],
  chatInput: [
    'textarea[placeholder*="メッセージ"]',
    'textarea[aria-label*="メッセージ"]',
    '[role="textbox"][aria-label*="メッセージ"]',
    'main textarea',
    'textarea:not([readonly])'
  ],
  sendButton: [
    'button[aria-label="送信"]:not([disabled])',
    'button[aria-label*="送信"]:not([disabled])',
    'button[aria-label*="send" i]:not([disabled])',
    'button[type="submit"]:not([disabled])'
  ],
  settingsButton: [
    'button[aria-label="設定"]',
    'a[aria-label="設定"]',
    'button.hatch-dock-reveal-item[aria-label="設定"]'
  ],
  chatNavButton: [
    'button[aria-label="チャット"]',
    'a[aria-label="チャット"]'
  ],
  modalCloseButton: [
    '[role="dialog"] button[aria-label="閉じる"]',
    '[role="dialog"] button[aria-label*="close" i]',
    'button[aria-label="閉じる"]'
  ]
};

function queryFirst(candidates, root = document) {
  for (const sel of candidates) {
    try {
      const el = root.querySelector(sel);
      if (el) return { el, selector: sel };
    } catch (_) {}
  }
  return { el: null, selector: null };
}

function queryAllFirst(candidates, root = document) {
  for (const sel of candidates) {
    try {
      const list = Array.from(root.querySelectorAll(sel));
      if (list.length > 0) return { list, selector: sel };
    } catch (_) {}
  }
  // フォールバック: sr-only で「自分:」「アシスタントメッセージ:」を持つ要素の親
  try {
    const srSpans = Array.from(root.querySelectorAll('span.sr-only')).filter(s => {
      const t = (s.textContent || '').trim();
      return t.startsWith('自分:') || t.startsWith('アシスタントメッセージ:');
    });
    if (srSpans.length > 0) {
      return {
        list: srSpans.map(s => s.parentElement).filter(Boolean),
        selector: 'span.sr-only->parentElement'
      };
    }
  } catch (_) {}
  return { list: [], selector: null };
}

function triggerReactClick(el) {
  if (!el) return;
  try { el.click(); } catch (_) {}
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  const reactKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  if (reactKey && typeof el[reactKey]?.onClick === 'function') {
    try {
      el[reactKey].onClick({
        preventDefault() {},
        stopPropagation() {},
        currentTarget: el,
        target: el,
        nativeEvent: new MouseEvent('click')
      });
    } catch (_) {}
  }
}

// パッシブ監視: ユーザーまたはスクリプトが「設定 ＞ 一般」を開いた際に自動的に利用枠をキャッシュ
if (!window.__MUSE_PASSIVE_WATCHER__) {
  window.__MUSE_PASSIVE_WATCHER__ = setInterval(() => {
    try {
      const bodyText = document.body ? document.body.innerText : '';
      const matchUsed = bodyText.match(/(\d+)\s*%\s*使用済み/i);
      if (matchUsed) {
        const usedPercent = parseInt(matchUsed[1], 10);
        const remainingPercent = Math.max(0, 100 - usedPercent);
        const matchReset = bodyText.match(/(\d+週間の上限は[^\n。]*リセットされます|\d+月\d+日にリセットされます)/);
        const planEl = document.querySelector('span.text-body.text-text-primary');
        const planName = planEl && (planEl.textContent || '').includes('プラン')
          ? planEl.textContent.trim()
          : '無料プラン';
        window.__MUSE_CACHED_LIMIT__ = {
          plan_name: planName,
          used_percent: usedPercent,
          remaining_percent: remainingPercent,
          reset_text: matchReset ? matchReset[1].trim() : ''
        };
      }
    } catch (_) {}
  }, 1500);
}

window.__MUSE_BRIDGE__ = {
  /**
   * アバター名称の抽出 (例: "ラッキー")
   */
  extractAvatarName() {
    try {
      // 1. <video> の祖先コンテナから「リンク済み」の直前行を探す
      const { el: video } = queryFirst(SELECTORS.avatarVideo);
      let curr = video ? video.parentElement : null;
      for (let depth = 0; depth < 6 && curr; depth++) {
        const lines = (curr.innerText || '')
          .split(/\n+/)
          .map(s => s.trim())
          .filter(s => s.length > 0 && s.length <= 24);
        const linkIdx = lines.findIndex(l => l.includes('リンク済み'));
        if (linkIdx > 0) {
          const candidate = lines[linkIdx - 1];
          if (candidate && !candidate.includes('招待') && !candidate.includes('チャット')) {
            window.__MUSE_CACHED_AVATAR_NAME__ = candidate;
            return candidate;
          }
        }
        curr = curr.parentElement;
      }

      // 2. ページ内の「リンク済み」要素の親から探す
      const allEls = Array.from(document.querySelectorAll('span, div, p'));
      const linkEl = allEls.find(e => e.children.length === 0 && (e.textContent || '').trim() === 'リンク済み');
      if (linkEl) {
        let p = linkEl.parentElement;
        for (let d = 0; d < 4 && p; d++) {
          const lines = (p.innerText || '')
            .split(/\n+/)
            .map(s => s.trim())
            .filter(s => s.length > 0 && s.length <= 24);
          const idx = lines.findIndex(l => l.includes('リンク済み'));
          if (idx > 0) {
            window.__MUSE_CACHED_AVATAR_NAME__ = lines[idx - 1];
            return lines[idx - 1];
          }
          p = p.parentElement;
        }
      }
    } catch (_) {}
    return window.__MUSE_CACHED_AVATAR_NAME__ || null;
  },

  /**
   * アバター状態（State）のリアルタイム判定 (Issue #10)
   * Muse本体のアバターコンポーネントのステータスおよび再生中の動画Blobサイズから直接一致させる
   */
  async getAvatarState() {
    try {
      window.__MUSE_BLOB_STATE_MAP__ = window.__MUSE_BLOB_STATE_MAP__ || {};

      const v =
        document.querySelector('video[data-hatch-media-owner="avatar-layer"][data-hatch-avatar-slot="current"]') ||
        document.querySelector('video[data-hatch-media-owner="avatar-layer"]') ||
        queryFirst(SELECTORS.avatarVideo).el;

      // 1. React Fiber / Props に明示的なステータス値がある場合は最優先で取得
      const validStates = new Set([
        'idle',
        'connecting',
        'waking',
        'working',
        'waiting_for_subagent',
        'making_something',
        'milestone_level_up'
      ]);

      const normalizeState = (raw) => {
        if (!raw || typeof raw !== 'string') return null;
        const s = raw.trim().toLowerCase();
        if (!validStates.has(s)) return null;
        if (s === 'connecting') return 'idle';
        if (s === 'waiting_for_subagent') return 'working';
        return s;
      };

      let fiberState = null;
      let curr = v;
      for (let depth = 0; depth < 8 && curr && !fiberState; depth++) {
        const keys = Object.keys(curr);
        for (const k of keys) {
          if (k.startsWith('__reactProps$') || k.startsWith('__reactFiber$')) {
            const obj = curr[k];
            const props = obj?.memoizedProps || obj?.pendingProps || obj;
            if (props && typeof props === 'object') {
              for (const pk of ['state', 'status', 'avatarState', 'avatarStatus', 'mode', 'phase', 'animation']) {
                const mapped = normalizeState(props[pk]);
                if (mapped) {
                  fiberState = mapped;
                  break;
                }
              }
            }
          }
        }
        curr = curr.parentElement;
      }

      // 2. アバター下のステータステキスト（「🛠️ は動作中です」「リンク済み」など）の取得 (Issue #35)
      let statusText = '';
      let statusEl = null;

      // 優先探索A: アバター動画/アイコン周辺、またはアバター名周辺にある「動作中」「リンク済み」等の要素
      try {
        const candidates = Array.from(document.querySelectorAll('span, div, p')).filter(e => {
          if (e.children.length > 0) return false;
          const t = (e.textContent || '').trim();
          return t.includes('動作中') || t.includes('リンク済み') || t.includes('考え中') || t.includes('作業中') || t.includes('実行中');
        });
        if (candidates.length > 0) {
          statusEl = candidates[0];
          statusText = (statusEl.textContent || '').trim();
        }
      } catch (_) {}

      // 優先探索B: 従来の固定XPath
      if (!statusText) {
        const STATUS_XPATH = '/html/body/div[2]/div/div/div/div/div[1]/div/div[2]/div[1]/div/div[2]/div/div[2]/div[2]/div[1]/div/div/div/div[3]/div/div/div/div/div';
        try {
          statusEl = document.evaluate(
            STATUS_XPATH,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          ).singleNodeValue;
          if (statusEl) {
            statusText = (statusEl.innerText || statusEl.textContent || '').trim();
          }
        } catch (_) {}
      }

      // statusEl 自身の React Fiber / Props も探索
      if (statusEl && !fiberState) {
        let sc = statusEl;
        for (let depth = 0; depth < 6 && sc && !fiberState; depth++) {
          const keys = Object.keys(sc);
          for (const k of keys) {
            if (k.startsWith('__reactProps$') || k.startsWith('__reactFiber$')) {
              const obj = sc[k];
              const props = obj?.memoizedProps || obj?.pendingProps || obj;
              if (props && typeof props === 'object') {
                for (const pk of ['state', 'status', 'avatarState', 'avatarStatus', 'mode', 'phase', 'animation']) {
                  const mapped = normalizeState(props[pk]);
                  if (mapped) {
                    fiberState = mapped;
                    break;
                  }
                }
              }
            }
          }
          sc = sc.parentElement;
        }
      }

      // XPath で空だった場合のフォールバック（アバター親要素から取得）
      if (!statusText && v) {
        let p = v.parentElement;
        for (let d = 0; d < 6 && p; d++) {
          const lines = (p.innerText || '')
            .split(/\n+/)
            .map(s => s.trim())
            .filter(s => s.length > 0 && s.length <= 24);
          if (lines.length >= 2) {
            statusText = lines[lines.length - 1];
            break;
          }
          p = p.parentElement;
        }
      }

      if (fiberState) {
        return { state: fiberState, statusText, source: 'fiber' };
      }

      // 3. ステータステキストが明確に「リンク済み」等の待機状態であれば idle、稼働中テキストであれば対応状態を判定
      const mapStatusTextToState = (txt) => {
        if (!txt) return null;
        const t = txt.trim();
        const lower = t.toLowerCase();
        if (validStates.has(lower)) {
          return normalizeState(lower);
        }
        if (t === 'リンク済み' || t === 'オンライン' || t === '待機中' || /接続|linked|online|idle|ready|connected/i.test(t)) {
          return 'idle';
        }
        if (/起動|目覚め|waking/i.test(t)) {
          return 'waking';
        }
        if (/歓喜|レベルアップ|達成|milestone|level.?up/i.test(t)) {
          return 'milestone_level_up';
        }
        if (/作成|生成|構築|描画|コード|ファイル|making|creating|building|generating/i.test(t)) {
          return 'making_something';
        }
        if (/作業|考え|思考|返信|検索|調査|確認|サブエージェント|待機|実行|working|thinking|searching|waiting|running/i.test(t)) {
          return 'working';
        }
        // 「リンク済み」以外のステータステキストが表示されている場合は作業中とみなす
        return 'working';
      };

      const textMappedState = mapStatusTextToState(statusText);

      // 4. 再生中の <video src="blob:..."> のバイトサイズから 5 種類の MP4 を 100% 特定
      //    - waking.mp4:             262,753 bytes
      //    - working.mp4:            369,723 bytes
      //    - making_something.mp4:   406,030 bytes
      //    - idle.mp4:               564,061 bytes
      //    - milestone_level_up.mp4: 595,491 bytes
      const currentBlob = v ? (v.currentSrc || v.src || '') : '';
      if (currentBlob && currentBlob.startsWith('blob:')) {
        if (!window.__MUSE_BLOB_STATE_MAP__[currentBlob]) {
          try {
            const resp = await fetch(currentBlob);
            if (resp.ok) {
              const blob = await resp.blob();
              const size = blob.size;
              let detected = 'idle';
              if (size > 0 && size < 310000) {
                detected = 'waking';
              } else if (size >= 310000 && size < 390000) {
                detected = 'working';
              } else if (size >= 390000 && size < 480000) {
                detected = 'making_something';
              } else if (size >= 480000 && size < 580000) {
                detected = 'idle';
              } else if (size >= 580000) {
                detected = 'milestone_level_up';
              }
              window.__MUSE_BLOB_STATE_MAP__[currentBlob] = { state: detected, size };
            }
          } catch (_) {}
        }

        const cached = window.__MUSE_BLOB_STATE_MAP__[currentBlob];
        if (cached && cached.state) {
          // もし動画Blobが idle であっても、ステータステキストが明確に稼働中（「リンク済み」以外）を示していればステータス表示を優先
          if (cached.state === 'idle' && textMappedState && textMappedState !== 'idle') {
            return {
              state: textMappedState,
              blobSize: cached.size,
              statusText,
              source: 'xpath_status_override'
            };
          }
          return {
            state: cached.state,
            blobSize: cached.size,
            statusText,
            source: 'blob_size'
          };
        }
      }

      if (textMappedState) {
        return { state: textMappedState, statusText, source: 'xpath_status' };
      }

      return { state: 'idle', statusText, source: 'default' };
    } catch (_) {
      return { state: 'idle', source: 'error' };
    }
  },

  /**
   * §17.3 起動時・定期ヘルスチェック (R1 / R2 / R3 / R5 のセレクタ生存確認 + アバター名取得 + アバター状態)
   */
  async checkHealth() {
    const vFound = queryFirst(SELECTORS.avatarVideo);
    const mFound = queryAllFirst(SELECTORS.messageItems);
    const iFound = queryFirst(SELECTORS.chatInput);
    const sFound = queryFirst(SELECTORS.settingsButton);
    const avatarName = this.extractAvatarName();
    const avatarStateInfo = await this.getAvatarState();

    return {
      avatar_name: avatarName,
      avatar_state: avatarStateInfo.state,
      avatar_src: vFound.el ? (vFound.el.currentSrc || vFound.el.src || '') : '',
      r1_avatar: {
        ok: !!(vFound.el && (vFound.el.currentSrc || vFound.el.src)),
        selector: vFound.selector || 'none'
      },
      r2_messages: {
        ok: mFound.list.length > 0 || !!iFound.el,
        count: mFound.list.length,
        selector: mFound.selector || 'none'
      },
      r3_input: {
        ok: !!iFound.el,
        selector: iFound.selector || 'none'
      },
      r5_limit: {
        ok: !!sFound.el || !!window.__MUSE_CACHED_LIMIT__,
        cached: !!window.__MUSE_CACHED_LIMIT__,
        selector: sFound.selector || 'none'
      }
    };
  },

  /**
   * 1. アバター動画 (R1) の Base64 Data URL 取得
   */
  async getAvatarVideoBase64() {
    const { el: video } = queryFirst(SELECTORS.avatarVideo);
    if (!video) {
      throw new Error("UNSUPPORTED_DOM: アバター動画要素が見つかりません");
    }
    const src = video.currentSrc || video.src;
    if (!src) {
      throw new Error("UNSUPPORTED_DOM: アバター動画の src が空です");
    }

    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch video blob: ${response.status}`);
    }
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error("Failed to convert video blob to Data URL"));
        }
      };
      reader.onerror = () => reject(reader.error || new Error("FileReader error"));
      reader.readAsDataURL(blob);
    });
  },

  /**
   * 2. メインチャットのメッセージ一覧読み取り (R2)
   */
  async getMessages(limit = 5) {
    const { list: messageEls } = queryAllFirst(SELECTORS.messageItems);
    const { el: inputEl } = queryFirst(SELECTORS.chatInput);

    // メッセージも入力欄も見つからない場合は未ログインまたは未対応画面構造
    if (messageEls.length === 0 && !inputEl) {
      throw new Error("UNSUPPORTED_OR_UNAUTH: メインチャットの画面構造が見つかりません");
    }

    // 選択肢（クイックリプライ / サジェスチョンボタン）抽出用 (Issue #32)
    const systemKeywords = [
      'コピー', 'オプション', '再生成', '評価', '編集', '共有', '削除', 'フィードバック',
      '詳細', '閉じる', 'メニュー', 'いいね', '低評価', 'good', 'bad', 'copy', 'option',
      'edit', 'share', 'delete', 'retry', 'regenerate', 'feedback', 'menu', 'close'
    ];

    const extractOptions = (el) => {
      if (!el) return [];
      const btnEls = Array.from(el.querySelectorAll('button, [role="button"], [class*="suggestion" i], [class*="chip" i], [class*="choice" i]'));
      const opts = [];

      for (const b of btnEls) {
        if (b.parentElement && b.parentElement.closest('button, [role="button"]')) continue;

        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const title = (b.getAttribute('title') || '').toLowerCase();
        const srEl = b.querySelector('.sr-only');
        const sr = srEl ? (srEl.textContent || '').toLowerCase() : '';

        const isSystem = systemKeywords.some(kw => aria.includes(kw) || title.includes(kw) || sr.includes(kw));
        if (isSystem) continue;

        const clone = b.cloneNode(true);
        clone.querySelectorAll('svg, i, .sr-only, [class*="icon" i]').forEach(node => node.remove());
        const label = (clone.textContent || '').replace(/^[\s\uFEFF\xA0\u3000]+|[\s\uFEFF\xA0\u3000]+$/g, '').trim();

        if (label.length >= 1 && label.length <= 120) {
          if (systemKeywords.some(kw => label.toLowerCase() === kw)) continue;
          if (!opts.includes(label)) {
            opts.push(label);
          }
        }
      }
      return opts;
    };

    const messages = [];

    for (const el of messageEls) {
      const srEl = el.querySelector('.sr-only');
      const srText = srEl ? (srEl.textContent || '').trim() : '';
      const hasProse = !!el.querySelector('.prose');
      const rawElText = (el.innerText || '').trim();
      const isUser = srText.startsWith('自分:') || (!hasProse && rawElText.startsWith('自分:'));
      const role = isUser ? 'user' : 'assistant';

      const { el: bubbleEl } = queryFirst(SELECTORS.messageBubble, el);
      let rawText = bubbleEl ? (bubbleEl.innerText || '') : rawElText;
      if (!isUser) {
        const mascotCodeEl = (bubbleEl || el).querySelector('code[class*="mascot-quotes" i], pre[class*="mascot-quotes" i], [data-language="mascot-quotes" i]');
        if (mascotCodeEl && !rawText.includes('mascot-quotes')) {
          const fence = '\x60\x60\x60';
          rawText = fence + 'mascot-quotes\n' + (mascotCodeEl.innerText || mascotCodeEl.textContent || '') + '\n' + fence;
        }
      }

      let text = rawText
        .replace(/^(自分:|アシスタントメッセージ:)\s*/i, '')
        .replace(/^[\s\uFEFF\xA0\u3000]+/g, '')
        .replace(/[\s\uFEFF\xA0\u3000]+$/g, '')
        .replace(/^[ \t\u3000]+/gm, '')
        .trim();

      // アシスタント返答内の選択肢の抽出 (Issue #32)
      let options = [];
      if (!isUser) {
        options = extractOptions(el);
        // 本文末尾にボタンのテキストが混入している場合はクリーンアップ
        for (const opt of options) {
          if (text.endsWith(opt)) {
            text = text.slice(0, -opt.length).trim();
          }
        }
      }

      if (text.length > 0) {
        const msgObj = { role, text };
        if (options.length > 0) {
          msgObj.options = options;
        }
        messages.push(msgObj);
      }
    }

    const parsedLimit = Number(limit) || 5;
    return messages.slice(-parsedLimit);
  },

  /**
   * 2.1 最新メッセージおよび動画・リンク詳細の調査 (Issue #10)
   */
  async inspectLatestMessage() {
    const { list: messageEls } = queryAllFirst(SELECTORS.messageItems);
    if (messageEls.length === 0) {
      return { error: "No messages found" };
    }

    // 全メッセージから動画や素材関連の要素も横断探索
    const targetMsg = messageEls[messageEls.length - 1];
    
    // 素材関連のキーワードを含むメッセージがあればそれも特定
    const materialMsg = messageEls.slice().reverse().find(m => {
      const t = m.innerText || '';
      return t.includes('素材') || t.includes('7パターン') || t.includes('MP4') || t.includes('idle');
    }) || targetMsg;

    function extractMedia(el) {
      if (!el) return {};
      const links = Array.from(el.querySelectorAll('a')).map(a => ({
        href: a.href,
        text: (a.textContent || '').trim(),
        download: a.getAttribute('download') || '',
        title: a.title || ''
      }));

      const videos = Array.from(el.querySelectorAll('video')).map(v => ({
        src: v.src || '',
        currentSrc: v.currentSrc || '',
        poster: v.poster || ''
      }));

      const images = Array.from(el.querySelectorAll('img')).map(img => ({
        src: img.src || '',
        alt: img.alt || ''
      }));

      const buttons = Array.from(el.querySelectorAll('button')).map(b => ({
        ariaLabel: b.getAttribute('aria-label') || '',
        text: (b.textContent || '').trim(),
        title: b.title || '',
        className: b.className || ''
      }));

      // カード・コンテナ要素
      const cards = Array.from(el.querySelectorAll('[class*="card"], [class*="media"], [class*="asset"], [data-testid]')).map(c => ({
        tag: c.tagName,
        className: c.className || '',
        dataTestId: c.getAttribute('data-testid') || '',
        text: (c.textContent || '').slice(0, 50)
      }));

      return { links, videos, images, buttons, cards };
    }

    const latestMedia = extractMedia(targetMsg);
    const materialMedia = extractMedia(materialMsg);

    // アバター要素およびその親コンテナの属性詳細
    const v = document.querySelector('video[data-hatch-media-owner="avatar-layer"]') || document.querySelector('video');
    const avatarDomInfo = v ? {
      src: v.src,
      currentSrc: v.currentSrc,
      attrs: Array.from(v.attributes).map(a => `${a.name}="${a.value}"`),
      parentAttrs: v.parentElement ? Array.from(v.parentElement.attributes).map(a => `${a.name}="${a.value}"`) : [],
      gpAttrs: v.parentElement?.parentElement ? Array.from(v.parentElement.parentElement.attributes).map(a => `${a.name}="${a.value}"`) : []
    } : null;

    // 画面内のボタン一覧（送信ボタンや停止ボタンの特定用）
    const allButtons = Array.from(document.querySelectorAll('button')).map(b => ({
      ariaLabel: b.getAttribute('aria-label') || '',
      type: b.type || '',
      text: (b.textContent || '').trim().slice(0, 30),
      disabled: b.disabled,
      cls: (b.className || '').slice(0, 40)
    })).filter(b => b.ariaLabel || b.text || b.cls.includes('send') || b.cls.includes('submit'));

    const recent = messageEls.slice(-5).map(m => {
      const sr = m.querySelector('.sr-only');
      const role = sr && (sr.textContent || '').includes('自分') ? 'user' : 'assistant';
      return {
        role,
        text: (m.innerText || '').trim()
      };
    });

    return {
      avatarDomInfo,
      allButtons,
      latest: {
        text: (targetMsg.innerText || '').trim(),
        media: latestMedia
      },
      materialMessage: {
        text: (materialMsg.innerText || '').trim(),
        media: materialMedia
      },
      recent
    };
  },

  /**
   * 3. メインチャットへのメッセージ入力・送信 (R3) + 失敗検知 (§4)
   */
  async sendMessage(text) {
    if (!text || typeof text !== 'string') {
      throw new Error("Message text is empty");
    }

    const { el: ta } = queryFirst(SELECTORS.chatInput);
    if (!ta) {
      throw new Error("UNSUPPORTED_DOM: 未対応の画面構造です（入力欄が見つかりません）");
    }

    const beforeCount = queryAllFirst(SELECTORS.messageItems).list.length;

    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (valueSetter) {
      valueSetter.call(ta, text);
    } else {
      ta.value = text;
    }

    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 180));

    const isStopButton = (btn) => {
      if (!btn) return false;
      const label = (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.textContent || '').toLowerCase();
      const cls = (btn.className || '').toLowerCase();
      return label.includes('stop') || label.includes('停止') || label.includes('キャンセル') || label.includes('interrupt') || cls.includes('stop');
    };

    const { el: sendBtn } = queryFirst(SELECTORS.sendButton);
    if (sendBtn && !isStopButton(sendBtn)) {
      sendBtn.click();
    } else {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    // §4 失敗検知: 送信後に入力欄がクリアされたか、メッセージ数が増えたかを確認
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 150));
      const afterCount = queryAllFirst(SELECTORS.messageItems).list.length;
      const currentVal = (ta.value || '').trim();
      if (afterCount > beforeCount || currentVal === '') {
        return { success: true, verified: true, textSent: text };
      }
    }

    throw new Error("SEND_VERIFY_FAILED: 送信後にメッセージの反映を確認できませんでした");
  },

  /**
   * 4. ウィンドウリミット（利用枠）の取得 (R5, §16 ガードレール対応)
   * @param {boolean} passiveOnly true の場合は画面遷移（設定クリック）を一切行わない（ガードレール①）
   */
  async fetchUsageLimit(passiveOnly = false) {
    const scanDomForLimit = () => {
      let planName = '';
      let usedPercent = null;
      let remainingPercent = null;
      let resetText = '';

      const planEl = document.querySelector('span.text-body.text-text-primary, [class*="plan" i]');
      if (planEl) {
        const t = (planEl.textContent || '').trim();
        if (t.includes('プラン') || t.includes('Plan') || t.includes('Free') || t.includes('無料')) {
          planName = t;
        }
      }

      // プログレスバー要素の属性（aria-valuenow や style="width: 50%" 等）からパーセントを検出
      const progressBars = Array.from(document.querySelectorAll('[role="progressbar"], [class*="progress" i]'));
      for (const bar of progressBars) {
        let p = null;
        const valNow = bar.getAttribute('aria-valuenow');
        if (valNow !== null && !isNaN(parseInt(valNow, 10))) {
          p = Math.max(0, Math.min(100, parseInt(valNow, 10)));
        } else {
          const wMatch = (bar.getAttribute('style') || '').match(/width\s*:\s*(\d+(?:\.\d+)?)\s*%/i);
          if (wMatch) {
            p = Math.round(parseFloat(wMatch[1]));
          }
        }

        if (p !== null) {
          // 周辺コンテキストで「残り」か「使用済み（標準）」かを判定
          const parentTxt = (bar.closest('[role="dialog"], [class*="modal" i], div')?.innerText || '').toLowerCase();
          if (parentTxt.includes('残り') || parentTxt.includes('left') || parentTxt.includes('remaining')) {
            remainingPercent = p;
            usedPercent = 100 - p;
          } else {
            // 一般的な進捗バーは消費量（使用済み）
            usedPercent = p;
            remainingPercent = Math.max(0, 100 - p);
          }
          break;
        }
      }

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const txt = (node.textContent || '').trim();
        if (!txt) continue;

        // パターン①: "○% 使用済み" / "○% consumed"
        if (usedPercent === null) {
          const matchUsed = txt.match(/(\d+)\s*%\s*(?:使用済み|used|consumed)/i);
          if (matchUsed) {
            usedPercent = parseInt(matchUsed[1], 10);
            if (remainingPercent === null) {
              remainingPercent = Math.max(0, 100 - usedPercent);
            }
          }
        }

        // パターン②: "残り ○%" / "残 ○%" / "○% 残り" / "○% remaining" / "○% left"
        if (remainingPercent === null) {
          const matchRem1 = txt.match(/(?:残り|残|remaining|left)\s*[:：]?\s*(\d+)\s*%/i);
          const matchRem2 = txt.match(/(\d+)\s*%\s*(?:残り|残|remaining|left)/i);
          if (matchRem1) {
            remainingPercent = parseInt(matchRem1[1], 10);
            if (usedPercent === null) usedPercent = Math.max(0, 100 - remainingPercent);
          } else if (matchRem2) {
            remainingPercent = parseInt(matchRem2[1], 10);
            if (usedPercent === null) usedPercent = Math.max(0, 100 - remainingPercent);
          }
        }

        // パターン③: "Limit" / "5-Hour" / "Weekly" の周辺テキストに含まれるパーセント
        if (remainingPercent === null && usedPercent === null) {
          const matchLimit = txt.match(/(?:\bLimit\b|5-Hour|Weekly)[^%\d]*(\d+)\s*%/i);
          if (matchLimit) {
            remainingPercent = parseInt(matchLimit[1], 10);
            usedPercent = Math.max(0, 100 - remainingPercent);
          }
        }

        if (!resetText) {
          const matchReset = txt.match(/(\d+週間の上限は[^\n。]*リセットされます|\d+月\d+日にリセットされます|リセット\s*[:：]?\s*\d+時間\s*\d+分)/);
          if (matchReset) {
            resetText = matchReset[1].trim();
          }
        }
      }

      if (remainingPercent !== null || usedPercent !== null || planName || resetText) {
        return {
          plan_name: planName || '無料プラン',
          used_percent: usedPercent,
          remaining_percent: remainingPercent,
          reset_text: resetText || ''
        };
      }
      return null;
    };

    // 1. まず現在の画面でスキャン
    const immediate = scanDomForLimit();
    if (immediate && (immediate.remaining_percent !== null || immediate.used_percent !== null)) {
      window.__MUSE_CACHED_LIMIT__ = immediate;
      return immediate;
    }

    // ガードレール①: session WebView が可視中、またはAIが回答生成中の場合は自動遷移・Escape送信を抑止 (Issue #34)
    const isGenerating = !!document.querySelector('button[aria-label*="停止" i], button[aria-label*="stop" i], button[title*="停止" i], button[title*="stop" i]');
    if (passiveOnly || isGenerating) {
      return window.__MUSE_CACHED_LIMIT__ || immediate || {
        plan_name: '無料プラン',
        used_percent: null,
        remaining_percent: null,
        reset_text: 'セッション画面の[設定>一般]で自動取得'
      };
    }

    // 2. 非表示時は「設定 ＞ 一般」を開いて確認し、ガードレール③に従いメインチャットへ明示的に戻す
    const { el: settingsBtn } = queryFirst(SELECTORS.settingsButton);
    if (settingsBtn) {
      triggerReactClick(settingsBtn);
      await new Promise(r => setTimeout(r, 500));

      const tabs = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], div, span'));
      const generalTab = tabs.find(t => t.children.length === 0 && (t.textContent || '').trim() === '一般');
      if (generalTab) {
        triggerReactClick(generalTab);
        await new Promise(r => setTimeout(r, 550));
      }

      const afterClick = scanDomForLimit();

      // §16 ガードレール③: Escape 任せにせず、閉じるボタン＋Escape＋チャットナビゲーションで明示的にメインチャットへ戻す
      const { el: closeBtn } = queryFirst(SELECTORS.modalCloseButton);
      if (closeBtn) {
        triggerReactClick(closeBtn);
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      await new Promise(r => setTimeout(r, 250));

      // もしメインチャットの入力欄が見えていなければ、左ドックの「チャット」ボタンを明示的にクリック
      const { el: inputAfter } = queryFirst(SELECTORS.chatInput);
      if (!inputAfter) {
        const { el: chatNav } = queryFirst(SELECTORS.chatNavButton);
        if (chatNav) {
          triggerReactClick(chatNav);
          await new Promise(r => setTimeout(r, 300));
        }
      }

      if (afterClick && (afterClick.used_percent !== null || afterClick.remaining_percent !== null)) {
        window.__MUSE_CACHED_LIMIT__ = afterClick;
        return afterClick;
      }
    }

    if (window.__MUSE_CACHED_LIMIT__) {
      return window.__MUSE_CACHED_LIMIT__;
    }

    return immediate || {
      plan_name: '無料プラン',
      used_percent: null,
      remaining_percent: null,
      reset_text: 'セッション画面の[設定>一般]で自動取得'
    };
  },

  /**
   * Title Bridge アクション実行ディスパッチャー
   */
  async executeAction(action, args, nonce) {
    let payload;
    try {
      let result;
      switch (action) {
        case 'check_health':
          result = await this.checkHealth();
          break;
        case 'get_avatar':
          result = await this.getAvatarVideoBase64();
          break;
        case 'get_avatar_state':
          result = await this.getAvatarState();
          break;
        case 'get_messages':
          result = await this.getMessages(args?.limit);
          break;
        case 'inspect_latest':
          result = await this.inspectLatestMessage();
          break;
        case 'send_message':
          result = await this.sendMessage(args?.text);
          break;
        case 'fetch_limit':
          result = await this.fetchUsageLimit(!!args?.passiveOnly);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }
      payload = { ok: true, data: result };
    } catch (err) {
      payload = {
        ok: false,
        error: (err && err.message) ? err.message : String(err),
        stack: (err && err.stack) ? err.stack : null
      };
    }

    const encoded = encodeURIComponent(JSON.stringify(payload));
    const CHUNK_SIZE = 2800;

    if (encoded.length <= CHUNK_SIZE) {
      document.title = `__MUSE_RES__:${nonce}:${encoded}`;
    } else {
      window.__MUSE_STORE__[nonce] = encoded;
      const total = Math.ceil(encoded.length / CHUNK_SIZE);
      document.title = `__MUSE_CHUNK_READY__:${nonce}:${total}`;
    }
  },

  serveChunk(nonce, idx) {
    const data = window.__MUSE_STORE__[nonce];
    if (!data) {
      document.title = `__MUSE_CHUNK__:${nonce}:${idx}:ERROR_NO_DATA`;
      return;
    }
    const CHUNK_SIZE = 2800;
    const start = idx * CHUNK_SIZE;
    const chunk = data.slice(start, start + CHUNK_SIZE);
    document.title = `__MUSE_CHUNK__:${nonce}:${idx}:${chunk}`;
  },

  cleanup(nonce) {
    delete window.__MUSE_STORE__[nonce];
    if (document.title.startsWith('__MUSE_')) {
      document.title = 'Muse AI - Session';
    }
  }
};
