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
  let registeredDomListeners;
  const origWindowAddEventListener = window.addEventListener.bind(window);

  beforeEach(async () => {
    registeredDomListeners = [];
    window.addEventListener = (type, fn, opts) => {
      if (type === 'DOMContentLoaded') {
        registeredDomListeners.push({ type, fn, opts });
      }
      return origWindowAddEventListener(type, fn, opts);
    };
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
    for (const { type, fn, opts } of registeredDomListeners) {
      window.removeEventListener(type, fn, opts);
    }
    window.addEventListener = origWindowAddEventListener;
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

  it('スリープ復帰を検知すると安全ガード確認後にセッションをリロードし、準備完了後に利用枠を再取得する (Issue #52)', async () => {
    const callOrder = [];
    invokeMock.mockImplementation(async (cmd, args) => {
      callOrder.push({ cmd, args });
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/thread/room-1' };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'reload_session') {
        return {
          executed: true,
          success: true,
          reason: args?.reason,
          before_url: 'https://muse.ai/thread/room-1',
          after_url: 'https://muse.ai/thread/room-1',
          url_matched: true,
          ready: true,
        };
      }
      if (cmd === 'get_usage_limit') {
        return { plan_name: '無料プラン', used_percent: 40, remaining_percent: 60, reset_text: '11月14日リセット' };
      }
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: '初期メッセージ' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'リンク済み' };
      return {};
    });

    // システム時刻を 5 分進めてスリープ復帰をシミュレートし、3秒定期ループを1回発火
    const jumpedTime = Date.now() + 5 * 60 * 1000;
    vi.setSystemTime(jumpedTime);
    await vi.advanceTimersByTimeAsync(3100);

    const reloadIdx = callOrder.findIndex((c) => c.cmd === 'reload_session');
    expect(reloadIdx).toBeGreaterThanOrEqual(0);
    expect(callOrder[reloadIdx].args).toEqual({ reason: 'sleep_resume', force: false });

    // reload_session の後に forceRefresh: true で利用枠が再取得されていること
    const refetchIdx = callOrder.findIndex(
      (c, i) => i > reloadIdx && c.cmd === 'get_usage_limit' && c.args?.forceRefresh === true
    );
    expect(refetchIdx).toBeGreaterThan(reloadIdx);
    expect(document.getElementById('avatar-limit-badge').textContent).toBe('60%');

    // スリープ検知ログが記録されていること
    expect(callOrder.some((c) => c.cmd === 'log_session_recovery_event' && c.args?.event === 'sleep_resume_detected')).toBe(true);
  });

  it('安全ガード（下書きあり・生成中・セッション表示中）に該当する場合は自動リロードをスキップし理由をログに記録する (Issue #52)', async () => {
    const logs = [];
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/thread/room-1' };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: '初期メッセージ' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'リンク済み' };
      return {};
    });

    // ケース1: マスコット側ミニ入力欄に未送信の下書きがある場合
    const mascotInputField = document.getElementById('mascot-input-field');
    mascotInputField.value = '入力途中のテキスト';
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=mascot_draft_present'))).toBe(true);

    // ケース2: セッション側入力欄に未送信の下書きがある場合
    mascotInputField.value = '';
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: true };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: '初期メッセージ' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'リンク済み' };
      return {};
    });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=session_draft_present'))).toBe(true);

    // ケース3: セッション側が生成中の場合
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: true, hasDraft: false };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: '初期メッセージ' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'リンク済み' };
      return {};
    });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=session_generating'))).toBe(true);

    // ケース4: セッション画面表示中の場合
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_session_status') return { exists: true, visible: true };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: '初期メッセージ' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'リンク済み' };
      return {};
    });
    eventListeners['session-visibility-changed']({ payload: true });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=session_visible'))).toBe(true);

    // ケース5: メインチャット入力欄 (#chat-input) に未送信の下書きがある場合
    eventListeners['session-visibility-changed']({ payload: false });
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: '初期メッセージ' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'リンク済み' };
      return {};
    });
    const chatInput = document.getElementById('chat-input');
    chatInput.value = 'メイン入力欄の下書き';
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=mascot_draft_present'))).toBe(true);
  });

  it('ウェイク処理中 (isWakingForLiveQuotes) はスリープ復帰を検知しても自動リロードをスキップする (Issue #52)', async () => {
    const logs = [];
    let wakeResolve;
    let wakeCalled = false;

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_live_quotes') {
        return { items: [], recent_shown: [] };
      }
      if (cmd === 'get_avatar_video_pack') {
        return {
          idle: 'data:video/mp4;base64,AAAA',
          waking: 'data:video/mp4;base64,BBBB',
          working: 'data:video/mp4;base64,CCCC',
          making_something: 'data:video/mp4;base64,DDDD',
          milestone_level_up: 'data:video/mp4;base64,EEEE',
          plugins: [{ name: 'dummy.mp4', data_url: 'data:video/mp4;base64,AAAA' }],
          setting: {},
          quotes: {},
        };
      }
      if (cmd === 'get_plugin_configs') {
        return {
          setting: {
            idle_threshold_sec: 1,
            action_interval_sec: 9999,
            default_action_duration_sec: 1,
            live_quotes: {
              enabled: true,
              target_mode: 'main',
              min_interval_min: 1,
              daily_limit: 6,
              quiet_hours_start: '03:00',
              quiet_hours_end: '03:01',
            },
          },
          quotes: {},
        };
      }
      if (cmd === 'send_live_quotes_wake') {
        wakeCalled = true;
        return new Promise((resolve) => {
          wakeResolve = resolve;
        });
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: '初期メッセージ' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'リンク済み' };
      return {};
    });

    // 1. 初回IDLEアクション(1秒)完了後、action_interval_sec 待機中にライブつぶやきウェイクを発動させる
    await vi.advanceTimersByTimeAsync(3100);
    await vi.advanceTimersByTimeAsync(3100);
    expect(wakeCalled).toBe(true);

    // 2. ウェイク応答待ちのまま時刻を5分ジャンプさせてスリープ復帰を発生させる
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=wake_in_progress'))).toBe(true);

    if (wakeResolve) wakeResolve({ sendResult: { success: true }, preWakeAssistant: '' });
  });

  it('連続失敗フォールバック自動リロードは1エピソードにつき1回限りで、取得成功時にリセットされる (Issue #52)', async () => {
    let reloadCount = 0;
    let limitResponse = { plan_name: '無料プラン', used_percent: null, remaining_percent: null, reset_text: '' };

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'get_usage_limit') return limitResponse;
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/thread/room-1' };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'reload_session') {
        reloadCount += 1;
        return {
          executed: true,
          success: true,
          reason: args?.reason,
          before_url: 'https://muse.ai/thread/room-1',
          after_url: 'https://muse.ai/thread/room-1',
          url_matched: true,
          ready: true,
        };
      }
      return {};
    });

    const btnRefreshLimit = document.getElementById('btn-refresh-limit');

    // 1回目失敗: まだリロードしない
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(reloadCount).toBe(0);

    // 2回目連続失敗: フォールバックリロードが 1 回だけ発動
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(reloadCount).toBe(1);

    // 3回目・4回目失敗しても同一エピソードでは再リロードしない
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(reloadCount).toBe(1);

    // 取得成功でエピソードがリセットされる
    limitResponse = { plan_name: '無料プラン', used_percent: 30, remaining_percent: 70, reset_text: '11月14日リセット' };
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.getElementById('avatar-limit-badge').textContent).toBe('70%');

    // 新しいエピソードで再び連続2回失敗すると 1 回だけリロードが発動
    limitResponse = { plan_name: '無料プラン', used_percent: null, remaining_percent: null, reset_text: '' };
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(reloadCount).toBe(1);

    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(reloadCount).toBe(2);
  });

  it('session-reloaded イベント受信時に入力欄準備完了なら利用枠を再取得する (Issue #52)', async () => {
    expect(eventListeners['session-reloaded']).toBeDefined();
    invokeMock.mockClear();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_usage_limit') {
        return { plan_name: '無料プラン', used_percent: 15, remaining_percent: 85, reset_text: '11月14日リセット' };
      }
      return {};
    });

    eventListeners['session-reloaded']({
      payload: {
        executed: true,
        success: true,
        reason: 'manual_tray',
        ready: true,
        url_matched: true,
      },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(invokeMock).toHaveBeenCalledWith('get_usage_limit', { forceRefresh: true });
    expect(document.getElementById('avatar-limit-badge').textContent).toBe('85%');
  });

  it('通常メッセージとつぶやき（ひとりごと）で吹き出しタイトルと is-quote クラスが切り替わる (Issue #56)', async () => {
    // 初回同期（ベースライン記録）を完了させる
    await vi.advanceTimersByTimeAsync(2000);

    const bubble = document.getElementById('mascot-bubble');
    const titleEl = bubble.querySelector('.mascot-bubble-title');
    const avatarContainer = document.getElementById('avatar-container');

    // 1. タッチリアクション（つぶやき系）の単クリックで is-quote & 💭 ひとりごと になる
    avatarContainer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, screenX: 100, screenY: 100 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, screenX: 100, screenY: 100 }));
    await vi.advanceTimersByTimeAsync(300);

    expect(bubble.classList.contains('hidden')).toBe(false);
    expect(bubble.classList.contains('is-quote')).toBe(true);
    expect(titleEl.textContent).toBe('💭 ひとりごと');

    // 2. 閉じるボタンで hidden かつ is-quote / タイトルがリセットされる
    document.getElementById('btn-bubble-close').click();
    expect(bubble.classList.contains('hidden')).toBe(true);
    expect(bubble.classList.contains('is-quote')).toBe(false);
    expect(titleEl.textContent).toBe('Muse');

    // 3. Muse からの通常メッセージ受信時は is-quote 無し & タイトル Muse になる
    if (eventListeners['session-visibility-changed']) {
      eventListeners['session-visibility-changed']({ payload: false });
    }
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/?__pwa=1' };
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'リンク済み' };
      if (cmd === 'get_chat_messages') {
        return [
          { role: 'assistant', text: '初期メッセージ' },
          { role: 'assistant', text: '通常の新着返信です！' },
        ];
      }
      return {};
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(bubble.classList.contains('hidden')).toBe(false);
    expect(bubble.classList.contains('is-quote')).toBe(false);
    expect(titleEl.textContent).toBe('Muse');
  });

  it('ステータスピルにアバター名が返された場合は誤表示せず state に応じたフォールバック文言を表示する (Issue #57)', async () => {
    await vi.advanceTimersByTimeAsync(2000);

    const avatarNameEl = document.getElementById('avatar-name');
    avatarNameEl.textContent = 'ラッキー';
    const statusPill = document.getElementById('avatar-status-pill');
    const statusTextEl = document.getElementById('avatar-status-text');

    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/?__pwa=1' };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: '初期メッセージ' }];
      if (cmd === 'get_avatar_state') return { state: 'working', statusText: 'ラッキー' };
      return {};
    });

    await vi.advanceTimersByTimeAsync(3100);

    expect(statusPill.classList.contains('hidden')).toBe(false);
    expect(statusTextEl.textContent).toBe('🛠️ 作業中');
    expect(statusTextEl.textContent).not.toContain('ラッキー');
  });
});
