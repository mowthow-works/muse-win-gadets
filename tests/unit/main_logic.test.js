import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.resolve(__dirname, '../../src/index.html'), 'utf-8');
const mainJs = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf-8');

describe('main.js UI Logic & Regression Suite', () => {
  let invokeMock;
  let eventListeners;

  beforeEach(async () => {
    vi.useFakeTimers();
    eventListeners = {};
    invokeMock = vi.fn(async (cmd, args) => {
      if (cmd === 'get_gadget_config') {
        return {
          size_mode: 'mascot',
          mascot_scale: 'standard',
          mascot_bubble_on_left: true,
          message_limit: 5,
          avatar_name: 'ラッキー',
        };
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/?__pwa=1' };
      if (cmd === 'get_avatar_video_pack') {
        return {
          idle: 'data:video/mp4;base64,AAAA',
          waking: 'data:video/mp4;base64,BBBB',
          working: 'data:video/mp4;base64,CCCC',
          making_something: 'data:video/mp4;base64,DDDD',
          milestone_level_up: 'data:video/mp4;base64,EEEE',
          plugins: [],
          setting: { sound_enabled: false, bubble_display_duration_sec: 30 },
          quotes: {},
        };
      }
      if (cmd === 'get_usage_limit') {
        return { plan_name: '無料プラン', used_percent: 25, remaining_percent: 75, reset_text: '11月14日リセット' };
      }
      if (cmd === 'get_chat_messages') {
        return [{ role: 'assistant', text: '初期メッセージ' }];
      }
      if (cmd === 'get_live_quotes') {
        return { items: [], recent_shown: [] };
      }
      if (cmd === 'check_bridge_health') {
        return {
          avatar_name: 'ラッキー',
          avatar_state: 'idle',
          r1_avatar: { ok: true, selector: 'video' },
          r2_messages: { ok: true, selector: '.group/msg' },
          r3_input: { ok: true, selector: 'textarea' },
          r5_limit: { ok: true, selector: 'button' },
        };
      }
      if (cmd === 'get_avatar_state') {
        return { state: 'idle', statusText: 'リンク済み' };
      }
      if (cmd === 'sync_mascot_bubble_direction') return true;
      return {};
    });

    window.__TAURI__ = {
      core: { invoke: invokeMock },
      event: {
        listen: vi.fn((eventName, handler) => {
          eventListeners[eventName] = handler;
          return Promise.resolve(() => {});
        }),
      },
    };

    // Stub HTMLMediaElement.prototype.play & window.focus for jsdom
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-video-url');
    window.focus = vi.fn();

    // Load HTML body
    const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    document.body.className = 'mode-mascot';
    document.body.innerHTML = bodyMatch ? bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '') : '';

    // Execute main.js in current window context
    const runMain = new Function(mainJs);
    runMain();

    window.dispatchEvent(new Event('DOMContentLoaded'));
    await vi.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('IME変換中 (isComposing: true) の Enter キーでは送信せず、確定後の Enter で送信する (Issue #34)', async () => {
    const mascotInputField = document.getElementById('mascot-input-field');
    mascotInputField.value = 'テスト質問';

    // 1. IME変換中の Enter
    const composingEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    Object.defineProperty(composingEvent, 'isComposing', { value: true });
    mascotInputField.dispatchEvent(composingEvent);

    expect(invokeMock).not.toHaveBeenCalledWith('send_chat_message', expect.anything());

    // 2. IME確定後の通常 Enter
    const normalEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: false,
    });
    mascotInputField.dispatchEvent(normalEnter);
    await vi.advanceTimersByTimeAsync(50);

    expect(invokeMock).toHaveBeenCalledWith('send_chat_message', { text: 'テスト質問' });
  });

  it('セッション画面表示中 (session-visibility-changed = true) は新着メッセージの吹き出し表示を抑止する (Issue #29)', async () => {
    // セッション画面が前面に表示されたイベントを発火
    expect(eventListeners['session-visibility-changed']).toBeDefined();
    eventListeners['session-visibility-changed']({ payload: true });

    // 新着メッセージが到着するようにモックを更新
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_chat_messages') {
        return [{ role: 'assistant', text: 'セッション表示中の新着メッセージです' }];
      }
      return {};
    });

    // 定期ポーリングを進める
    await vi.advanceTimersByTimeAsync(5000);

    const mascotBubble = document.getElementById('mascot-bubble');
    expect(mascotBubble.classList.contains('hidden')).toBe(true);
  });

  it('利用枠のパーセント取得時にバッジとプログレスバーが更新され、未取得(null)が返っても既存の有効表示を消さない (Issue #43)', async () => {
    const badge = document.getElementById('avatar-limit-badge');
    expect(badge.textContent).toBe('75%');

    // 次回の get_usage_limit が一時的に null を返した場合でも '--%' に戻らないことを検証
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_usage_limit') {
        return { plan_name: '無料プラン', used_percent: null, remaining_percent: null, reset_text: '' };
      }
      return {};
    });

    const btnRefreshLimit = document.getElementById('btn-refresh-limit');
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(100);

    expect(badge.textContent).toBe('75%');
  });

  it('mascot-quotes コードブロックを含む返答は吹き出しに直接表示せずライブセリフプールへ保存する (Issue #37, #46)', async () => {
    // まず初回同期（ベースライン設定）を完了させる
    await vi.advanceTimersByTimeAsync(2000);

    // mascot-quotes を含む返答を返すように設定
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'get_chat_messages') {
        return [
          {
            role: 'assistant',
            text: '```mascot-quotes\n今日もいい調子だね！\nコーヒーでも飲む？\n```',
          },
        ];
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'リンク済み' };
      return {};
    });

    // ポーリング＋2秒の確定タイマーを進める
    await vi.advanceTimersByTimeAsync(6000);

    // 吹き出しにはコードブロック自体が表示されないこと
    const mascotBubble = document.getElementById('mascot-bubble');
    expect(mascotBubble.classList.contains('hidden')).toBe(true);

    // save_live_quotes が呼ばれ、2件のセリフがプールに保存されていること
    const saveCall = invokeMock.mock.calls.find((c) => c[0] === 'save_live_quotes');
    expect(saveCall).toBeTruthy();
    expect(saveCall[1].payload.items).toHaveLength(2);
    expect(saveCall[1].payload.items[0].text).toBe('今日もいい調子だね！');
    expect(saveCall[1].payload.items[1].text).toBe('コーヒーでも飲む？');
  });

  it('長文タイピング表示時に親コンテナ (.mascot-bubble-body) の scrollTop が scrollHeight に自動追従する (Issue #50)', async () => {
    // 初回同期（ベースライン記録）を完了させる
    await vi.advanceTimersByTimeAsync(2000);

    const mascotBubbleText = document.getElementById('mascot-bubble-text');
    const bubbleBody = mascotBubbleText.parentElement;
    expect(bubbleBody.classList.contains('mascot-bubble-body')).toBe(true);

    // 文字数に応じて scrollHeight が増加するレイアウト挙動をシミュレート
    Object.defineProperty(bubbleBody, 'scrollHeight', {
      get: () => (mascotBubbleText.textContent || '').length * 8,
      configurable: true,
    });

    const longText = '1行目のテキストです。\n2行目のテキストです。\n3行目のテキストです。\n4行目のテキストです。\n5行目のテキストです。';
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_chat_messages') {
        return [{ role: 'assistant', text: longText }];
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'リンク済み' };
      return {};
    });

    // 3秒の定期ポーリングを発火させてタイピング開始
    await vi.advanceTimersByTimeAsync(3100);
    expect(mascotBubbleText.textContent.length).toBeGreaterThan(0);
    expect(bubbleBody.scrollTop).toBe(bubbleBody.scrollHeight);

    // タイピング完了まで時間を進める
    await vi.advanceTimersByTimeAsync(2000);
    expect(mascotBubbleText.textContent).toBe(longText);
    expect(bubbleBody.scrollTop).toBe(longText.length * 8);
    expect(bubbleBody.scrollTop).toBeGreaterThan(200);
  });
});
