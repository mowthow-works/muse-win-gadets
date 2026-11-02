/**
 * session_bridge.js
 * 
 * Muse (https://muse.ai/?__pwa=1) のセッション WebView 内で実行される DOM 調査・操作スクリプト。
 * DOM セレクタとリモート処理はすべて本ファイルに集約されます。
 * 
 * 通信方式: Document Title Bridge (即時通信 + チャンク分割ハンドシェイク Pull)
 */

window.__MUSE_STORE__ = window.__MUSE_STORE__ || {};
window.__MUSE_CACHED_LIMIT__ = window.__MUSE_CACHED_LIMIT__ || null;

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
   * 1. アバター動画 (R1) の Base64 Data URL 取得
   */
  async getAvatarVideoBase64() {
    const video = document.querySelector('video');
    if (!video) {
      throw new Error("No video element found in DOM");
    }
    const src = video.currentSrc || video.src;
    if (!src) {
      throw new Error("Video element has no src");
    }

    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch video blob: ${response.status} ${response.statusText}`);
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
    const messageEls = Array.from(document.querySelectorAll('[class*="group/msg"]'));
    const messages = [];

    for (const el of messageEls) {
      // 送信者判定: sr-only ラベルと .prose の有無で厳密に判定
      const srEl = el.querySelector('.sr-only');
      const srText = srEl ? (srEl.textContent || '').trim() : '';
      const hasProse = !!el.querySelector('.prose');
      const rawElText = (el.innerText || '').trim();
      const isUser = srText.startsWith('自分:') || (!hasProse && rawElText.startsWith('自分:'));
      const role = isUser ? 'user' : 'assistant';

      // 本文抽出
      const bubbleEl = el.querySelector('[class*="hatch-chat-groupable-bubble"], .prose');
      let rawText = bubbleEl ? (bubbleEl.innerText || '') : rawElText;

      // プレフィックスのクリーニング
      const text = rawText
        .replace(/^(自分:|アシスタントメッセージ:)\s*/i, '')
        .trim();

      if (text.length > 0) {
        messages.push({ role, text });
      }
    }

    // 最新 limit 件を取り出す
    const parsedLimit = Number(limit) || 5;
    return messages.slice(-parsedLimit);
  },

  /**
   * 3. メインチャットへのメッセージ入力・送信 (R3)
   */
  async sendMessage(text) {
    if (!text || typeof text !== 'string') {
      throw new Error("Message text is empty or invalid");
    }

    const ta = document.querySelector('textarea[placeholder*="メッセージ"]') ||
               document.querySelector('textarea');
    if (!ta) {
      throw new Error("Input textarea not found in DOM");
    }

    // React 16+ 向け native value setter の呼び出し
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (valueSetter) {
      valueSetter.call(ta, text);
    } else {
      ta.value = text;
    }

    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));

    // UI 反映を待機 (180ms)
    await new Promise(r => setTimeout(r, 180));

    // 送信ボタンの検索
    const sendBtn = document.querySelector('button[aria-label="送信"]:not([disabled])') ||
                    document.querySelector('button[aria-label*="send" i]:not([disabled])');

    if (sendBtn) {
      sendBtn.click();
    } else {
      // Enter キー押下シミュレーション
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    return { success: true, textSent: text };
  },

  /**
   * 4. ウィンドウリミット（利用枠）の取得 (R5)
   */
  async fetchUsageLimit() {
    const scanDomForLimit = () => {
      let planName = '';
      let usedPercent = null;
      let remainingPercent = null;
      let resetText = '';

      // プラン名
      const planEl = document.querySelector('span.text-body.text-text-primary, [class*="plan" i]');
      if (planEl) {
        const t = (planEl.textContent || '').trim();
        if (t.includes('プラン') || t.includes('Plan') || t.includes('Free') || t.includes('無料')) {
          planName = t;
        }
      }

      // ページ内のテキストをスキャン
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const txt = (node.textContent || '').trim();
        if (!txt) continue;

        // 使用率の検索 (例: "17%使用済み")
        if (usedPercent === null) {
          const matchUsed = txt.match(/(\d+)\s*%\s*使用済み/i);
          if (matchUsed) {
            usedPercent = parseInt(matchUsed[1], 10);
            remainingPercent = Math.max(0, 100 - usedPercent);
          }
        }

        // リセット日の検索 (例: "1週間の上限は11月6日にリセットされます")
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

    // 2. なければ「設定 ＞ 一般」を自動で開いて確認を試みる
    const triggerClick = (el) => {
      if (!el) return;
      try { el.click(); } catch (_) {}
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      // React Fiber onClick 直接呼び出し
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
    };

    const settingsBtn = document.querySelector('button.hatch-dock-reveal-item[aria-label="設定"], button[aria-label="設定"]');
    if (settingsBtn) {
      triggerClick(settingsBtn);
      await new Promise(r => setTimeout(r, 500));

      // 「一般」タブらしき要素をクリック
      const tabs = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], div, span'));
      const generalTab = tabs.find(t => t.children.length === 0 && (t.textContent || '').trim() === '一般');
      if (generalTab) {
        triggerClick(generalTab);
        await new Promise(r => setTimeout(r, 550));
      }

      // 再度スキャン
      const afterClick = scanDomForLimit();

      // Escape キーでモーダルを閉じる
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      await new Promise(r => setTimeout(r, 250));

      if (afterClick && afterClick.used_percent !== null) {
        window.__MUSE_CACHED_LIMIT__ = afterClick;
        return afterClick;
      }
    }

    if (window.__MUSE_CACHED_LIMIT__) {
      return window.__MUSE_CACHED_LIMIT__;
    }

    // スキャンで見つかった部分情報またはデフォルト
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
          result = await this.fetchUsageLimit();
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
    const CHUNK_SIZE = 3000;

    if (encoded.length <= CHUNK_SIZE) {
      // 1チャンクで収まる場合は即座にタイトルに設定
      document.title = `__MUSE_RES__:${nonce}:${encoded}`;
    } else {
      // チャンク分割ハンドシェイク待機
      window.__MUSE_STORE__[nonce] = encoded;
      const total = Math.ceil(encoded.length / CHUNK_SIZE);
      document.title = `__MUSE_CHUNK_READY__:${nonce}:${total}`;
    }
  },

  /**
   * チャンク要求に応答するヘルパー (Rust から呼び出される)
   */
  serveChunk(nonce, idx) {
    const data = window.__MUSE_STORE__[nonce];
    if (!data) {
      document.title = `__MUSE_CHUNK__:${nonce}:${idx}:ERROR_NO_DATA`;
      return;
    }
    const CHUNK_SIZE = 3000;
    const start = idx * CHUNK_SIZE;
    const chunk = data.slice(start, start + CHUNK_SIZE);
    document.title = `__MUSE_CHUNK__:${nonce}:${idx}:${chunk}`;
  },

  /**
   * 後片付け (Rust から呼び出される)
   */
  cleanup(nonce) {
    delete window.__MUSE_STORE__[nonce];
    if (document.title.startsWith('__MUSE_')) {
      document.title = 'Muse AI - Session';
    }
  }
};
