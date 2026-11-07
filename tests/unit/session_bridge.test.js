import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bridgeScriptPath = path.resolve(__dirname, '../../src-tauri/src/session_bridge.js');
const bridgeScriptContent = fs.readFileSync(bridgeScriptPath, 'utf-8');

describe('session_bridge.js DOM Scraping & Guardrails Suite', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = 'Muse AI';
    delete window.__MUSE_BRIDGE__;
    delete window.__MUSE_STORE__;
    delete window.__MUSE_CACHED_LIMIT__;
    delete window.__MUSE_CACHED_AVATAR_NAME__;
    delete window.__MUSE_BLOB_STATE_MAP__;
    if (window.__MUSE_PASSIVE_WATCHER__) {
      clearInterval(window.__MUSE_PASSIVE_WATCHER__);
      delete window.__MUSE_PASSIVE_WATCHER__;
    }
    // Load session_bridge.js into window
    const fn = new Function(bridgeScriptContent);
    fn();
  });

  afterEach(() => {
    if (window.__MUSE_PASSIVE_WATCHER__) {
      clearInterval(window.__MUSE_PASSIVE_WATCHER__);
      delete window.__MUSE_PASSIVE_WATCHER__;
    }
  });

  it('extractAvatarName: リンク済みの直前行からアバター名を正確に抽出する', () => {
    document.body.innerHTML = `
      <aside class="avatar-dock">
        <div>
          <video src="blob:https://muse.ai/1234"></video>
          <div>
            <span>ラッキー</span>
            <span>リンク済み</span>
          </div>
        </div>
      </aside>
    `;
    const el = document.querySelector('aside > div');
    // jsdom does not implement innerText layout line breaks automatically unless mocked or structured
    Object.defineProperty(el, 'innerText', {
      value: 'ラッキー\nリンク済み',
      configurable: true,
    });

    const name = window.__MUSE_BRIDGE__.extractAvatarName();
    expect(name).toBe('ラッキー');
  });

  it('getAvatarState (Issue #35, #42): チャット本文内のキーワードを誤検出せず、アバター周辺のステータスのみを検出する', async () => {
    document.body.innerHTML = `
      <div class="avatar-header">
        <video data-hatch-media-owner="avatar-layer" src=""></video>
        <span class="status-label">リンク済み</span>
      </div>
      <main>
        <div class="group/msg">
          <div class="prose">現在バッチ処理が動作中です。しばらく待機中になります。</div>
        </div>
      </main>
    `;

    const stateIdle = await window.__MUSE_BRIDGE__.getAvatarState();
    expect(stateIdle.state).toBe('idle');
    expect(stateIdle.statusText).toBe('リンク済み');

    // アバター下のステータスが「考え中...」に変化した場合
    document.querySelector('.status-label').textContent = '考え中...';
    const stateWorking = await window.__MUSE_BRIDGE__.getAvatarState();
    expect(stateWorking.state).toBe('working');
    expect(stateWorking.statusText).toBe('考え中...');

    // 「コードを作成中」に変化した場合
    document.querySelector('.status-label').textContent = 'コードを作成中';
    const stateMaking = await window.__MUSE_BRIDGE__.getAvatarState();
    expect(stateMaking.state).toBe('making_something');
    expect(stateMaking.statusText).toBe('コードを作成中');
  });

  it('getMessages (Issue #32): 選択肢ボタンを抽出し、システムボタン（コピー・評価等）を除外し、本文末尾の重複を除去する', async () => {
    document.body.innerHTML = `
      <main>
        <div class="group/msg" id="msg-1">
          <span class="sr-only">自分:</span>
          <div class="prose">どの案がいいかな？</div>
        </div>
        <div class="group/msg" id="msg-2">
          <span class="sr-only">アシスタントメッセージ:</span>
          <div class="prose">2つのプランを用意しました！どちらにしますか？A案で進めるB案で進める</div>
          <div class="actions">
            <button aria-label="コピー">コピー</button>
            <button aria-label="いいね">Good</button>
            <button class="suggestion-chip">A案で進める</button>
            <button class="suggestion-chip">B案で進める</button>
          </div>
        </div>
        <textarea placeholder="メッセージを入力"></textarea>
      </main>
    `;

    // Configure innerText for jsdom
    const msg1Prose = document.querySelector('#msg-1 .prose');
    Object.defineProperty(msg1Prose, 'innerText', { value: 'どの案がいいかな？', configurable: true });
    const msg2Prose = document.querySelector('#msg-2 .prose');
    Object.defineProperty(msg2Prose, 'innerText', {
      value: '2つのプランを用意しました！どちらにしますか？\nA案で進める\nB案で進める',
      configurable: true,
    });

    const messages = await window.__MUSE_BRIDGE__.getMessages(5);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'user',
      text: 'どの案がいいかな？',
    });
    expect(messages[1]).toEqual({
      role: 'assistant',
      text: '2つのプランを用意しました！どちらにしますか？',
      options: ['A案で進める', 'B案で進める'],
    });
  });

  it('fetchUsageLimit (Issue #33, #43): 使用済み%またはプログレスバーから残り%を正確に算出する', async () => {
    document.body.innerHTML = `
      <div role="dialog">
        <span class="text-body text-text-primary">Proプラン</span>
        <div role="progressbar" aria-valuenow="35"></div>
        <p>35% 使用済み</p>
        <p>1週間の上限は11月14日にリセットされます</p>
      </div>
    `;
    Object.defineProperty(document.body, 'innerText', {
      value: 'Proプラン\n35% 使用済み\n1週間の上限は11月14日にリセットされます',
      configurable: true,
    });

    const limit = await window.__MUSE_BRIDGE__.fetchUsageLimit(true);
    expect(limit.plan_name).toBe('Proプラン');
    expect(limit.used_percent).toBe(35);
    expect(limit.remaining_percent).toBe(65);
    expect(limit.reset_text).toBe('1週間の上限は11月14日にリセットされます');
  });

  it('fetchUsageLimit (Issue #34): AI回答生成中（停止ボタン存在時）は自動画面遷移を行わずフォールバックまたはキャッシュを返す', async () => {
    window.__MUSE_CACHED_LIMIT__ = {
      plan_name: '無料プラン',
      used_percent: 20,
      remaining_percent: 80,
      reset_text: 'キャッシュ済みリセット日',
    };

    let settingsClicked = false;
    document.body.innerHTML = `
      <button aria-label="設定" id="btn-settings">設定</button>
      <button aria-label="回答を停止">停止</button>
    `;
    Object.defineProperty(document.body, 'innerText', { value: '', configurable: true });
    document.getElementById('btn-settings').addEventListener('click', () => {
      settingsClicked = true;
    });

    // passiveOnly = false で呼んでも、停止ボタンがあるためクリック遷移しないこと
    const res = await window.__MUSE_BRIDGE__.fetchUsageLimit(false);
    expect(settingsClicked).toBe(false);
    expect(res.remaining_percent).toBe(80);
  });

  it('checkChatReady (Issue #46): URL正規化比較と入力欄の有効状態を判定する', async () => {
    document.body.innerHTML = `<textarea placeholder="メッセージを入力"></textarea>`;
    const currentHref = window.location.href;

    const readySame = await window.__MUSE_BRIDGE__.checkChatReady(currentHref + '/?__pwa=1#hash');
    expect(readySame.ready).toBe(true);
    expect(readySame.urlMatched).toBe(true);

    const readyDiff = await window.__MUSE_BRIDGE__.checkChatReady('https://muse.ai/chat/other-thread-999');
    expect(readyDiff.ready).toBe(true);
    expect(readyDiff.urlMatched).toBe(false);
  });
});
