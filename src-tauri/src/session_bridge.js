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
   * §17.3 起動時・定期ヘルスチェック (R1 / R2 / R3 / R5 のセレクタ生存確認 + アバター名取得)
   */
  async checkHealth() {
    const vFound = queryFirst(SELECTORS.avatarVideo);
    const mFound = queryAllFirst(SELECTORS.messageItems);
    const iFound = queryFirst(SELECTORS.chatInput);
    const sFound = queryFirst(SELECTORS.settingsButton);
    const avatarName = this.extractAvatarName();

    return {
      avatar_name: avatarName,
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

      const text = rawText
        .replace(/^(自分:|アシスタントメッセージ:)\s*/i, '')
        .trim();

      if (text.length > 0) {
        messages.push({ role, text });
      }
    }

    const parsedLimit = Number(limit) || 5;
    return messages.slice(-parsedLimit);
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

    const { el: sendBtn } = queryFirst(SELECTORS.sendButton);
    if (sendBtn) {
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

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const txt = (node.textContent || '').trim();
        if (!txt) continue;

        if (usedPercent === null) {
          const matchUsed = txt.match(/(\d+)\s*%\s*使用済み/i);
          if (matchUsed) {
            usedPercent = parseInt(matchUsed[1], 10);
            remainingPercent = Math.max(0, 100 - usedPercent);
          }
        }

        if (!resetText) {
          const matchReset = txt.match(/(\d+週間の上限は[^\n。]*リセットされます|\d+月\d+日にリセットされます)/);
          if (matchReset) {
            resetText = matchReset[1].trim();
          }
        }
      }

      if (usedPercent !== null || planName || resetText) {
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
    if (immediate && immediate.used_percent !== null) {
      window.__MUSE_CACHED_LIMIT__ = immediate;
      return immediate;
    }

    // ガードレール①: session WebView が可視中 (passiveOnly === true) の場合は自動遷移しない
    if (passiveOnly) {
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

      if (afterClick && afterClick.used_percent !== null) {
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
        case 'get_messages':
          result = await this.getMessages(args?.limit);
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
