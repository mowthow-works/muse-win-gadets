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
    delete window.__MUSE_SESSION_VISIBLE__;
    delete window.__MUSE_FETCHING_LIMIT__;
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

  it('fetchUsageLimit (Issue #49): 設定クリック後に非同期でモーダル・一般タブ・利用枠DOMが遅延描画される場合でもポーリング待機で確実に取得しモーダルを閉じる', async () => {
    let settingsClicked = false;
    let generalTabClicked = false;
    let modalClosed = false;

    document.body.innerHTML = `
      <main>
        <button title="設定" id="btn-settings">⚙️</button>
        <textarea placeholder="メッセージを入力"></textarea>
      </main>
      <div id="modal-root"></div>
    `;

    const settingsBtn = document.getElementById('btn-settings');
    settingsBtn.addEventListener('click', () => {
      if (settingsClicked) return;
      settingsClicked = true;
      // 60ms 後にモーダルと「一般」タブが非同期出現
      setTimeout(() => {
        const modalRoot = document.getElementById('modal-root');
        modalRoot.innerHTML = `
          <div role="dialog" id="settings-dialog">
            <button role="tab" id="tab-general">一般</button>
            <button aria-label="閉じる" id="btn-close-modal">×</button>
            <div id="tab-panel">読み込み中...</div>
          </div>
        `;
        const tabGeneral = document.getElementById('tab-general');
        tabGeneral.addEventListener('click', () => {
          if (generalTabClicked) return;
          generalTabClicked = true;
          // タブクリックからさらに 120ms 後に API レスポンスによる利用枠が非同期描画
          setTimeout(() => {
            const panel = document.getElementById('tab-panel');
            if (panel) {
              panel.innerHTML = `
                <span class="text-body text-text-primary">無料プラン</span>
                <div><span>42%</span> <span>使用済み</span></div>
                <p>1週間の上限は11月20日にリセットされます</p>
              `;
            }
          }, 120);
        });

        const closeBtn = document.getElementById('btn-close-modal');
        closeBtn.addEventListener('click', () => {
          modalClosed = true;
        });
      }, 60);
    });

    const res = await window.__MUSE_BRIDGE__.fetchUsageLimit(false, {
      pollIntervalMs: 30,
      maxTabWaitMs: 500,
      maxLimitWaitMs: 1000,
      closeWaitMs: 20,
      navWaitMs: 20,
    });

    expect(settingsClicked).toBe(true);
    expect(generalTabClicked).toBe(true);
    expect(modalClosed).toBe(true);
    expect(res.plan_name).toBe('無料プラン');
    expect(res.used_percent).toBe(42);
    expect(res.remaining_percent).toBe(58);
    expect(res.reset_text).toBe('1週間の上限は11月20日にリセットされます');
    expect(window.__MUSE_CACHED_LIMIT__).toEqual(res);
  });

  it('scanDomForLimit (Issue #49): プログレスバーのstyle幅や分割ノードから利用枠を正確に抽出する', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <span class="plan-badge">Free Plan</span>
        <div class="progress-track">
          <div class="progress-fill" style="width: 28%;"></div>
        </div>
        <div>残り 72%</div>
        <div>リセット: 11月21日</div>
      </div>
    `;

    const res = window.__MUSE_BRIDGE__.scanDomForLimit();
    expect(res).not.toBeNull();
    expect(res.plan_name).toBe('Free Plan');
    expect(res.remaining_percent).toBe(72);
    expect(res.used_percent).toBe(28);
    expect(res.reset_text).toBe('リセット: 11月21日');
  });

  it('fetchUsageLimit (Issue #49 ガードレール): 既に設定ダイアログが開いている状態では値を読み取るのみで絶対に勝手に閉じない', async () => {
    let closeClicked = false;
    let escapeDispatched = false;

    document.body.innerHTML = `
      <div role="dialog" id="user-opened-dialog">
        <button aria-label="閉じる" id="btn-close-dialog">×</button>
        <div id="dialog-content">設定メニュー表示中...</div>
      </div>
    `;

    document.getElementById('btn-close-dialog').addEventListener('click', () => {
      closeClicked = true;
    });
    const onKeyDown = (e) => {
      if (e.key === 'Escape') escapeDispatched = true;
    };
    document.addEventListener('keydown', onKeyDown);

    // 50ms 後にユーザーが一般タブを開いて利用枠が描画されたケース
    setTimeout(() => {
      const content = document.getElementById('dialog-content');
      if (content) {
        content.innerHTML = `<p>25% 使用済み</p>`;
      }
    }, 50);

    const res = await window.__MUSE_BRIDGE__.fetchUsageLimit(false, {
      pollIntervalMs: 25,
      maxTabWaitMs: 300,
    });

    document.removeEventListener('keydown', onKeyDown);

    expect(res.used_percent).toBe(25);
    expect(res.remaining_percent).toBe(75);
    expect(closeClicked).toBe(false);
    expect(escapeDispatched).toBe(false);
  });

  it('fetchUsageLimit (Issue #49 ガードレール): バックグラウンドポーリング中にセッション画面が表示された場合、即座に中断してモーダルを勝手に閉じない', async () => {
    let settingsClicked = false;
    let closeClicked = false;
    let escapeDispatched = false;

    document.body.innerHTML = `
      <main>
        <button aria-label="設定" id="btn-settings">⚙️</button>
        <textarea placeholder="メッセージを入力"></textarea>
      </main>
      <div id="modal-root"></div>
    `;

    document.getElementById('btn-settings').addEventListener('click', () => {
      settingsClicked = true;
      document.getElementById('modal-root').innerHTML = `
        <div role="dialog">
          <button aria-label="閉じる" id="btn-close-modal">×</button>
          <div id="tab-panel">読み込み中...</div>
        </div>
      `;
      document.getElementById('btn-close-modal').addEventListener('click', () => {
        closeClicked = true;
      });
      // ポーリング途中の 40ms 後にユーザーがセッション画面を開いた（__MUSE_SESSION_VISIBLE__ = true）
      setTimeout(() => {
        window.__MUSE_SESSION_VISIBLE__ = true;
      }, 40);
    });

    const onKeyDown = (e) => {
      if (e.key === 'Escape') escapeDispatched = true;
    };
    document.addEventListener('keydown', onKeyDown);

    await window.__MUSE_BRIDGE__.fetchUsageLimit(false, {
      pollIntervalMs: 25,
      maxTabWaitMs: 300,
      maxLimitWaitMs: 300,
    });

    document.removeEventListener('keydown', onKeyDown);

    expect(settingsClicked).toBe(true);
    expect(closeClicked).toBe(false);
    expect(escapeDispatched).toBe(false);
  });

  it('inspectReloadSafety (Issue #52): 生成中（停止ボタン）および未送信下書きの有無を正確に判定する', () => {
    document.body.innerHTML = `
      <main>
        <textarea placeholder="メッセージを入力"></textarea>
      </main>
    `;
    const ta = document.querySelector('textarea');

    // 1. 何も入力されておらず停止ボタンも無い場合
    let safety = window.__MUSE_BRIDGE__.inspectReloadSafety();
    expect(safety.isGenerating).toBe(false);
    expect(safety.hasDraft).toBe(false);
    expect(safety.draftLength).toBe(0);

    // 2. 空白のみの場合は下書きなし扱い
    ta.value = '   \n  ';
    safety = window.__MUSE_BRIDGE__.inspectReloadSafety();
    expect(safety.hasDraft).toBe(false);

    // 3. 未送信の下書きがある場合
    ta.value = 'まだ送っていない質問';
    safety = window.__MUSE_BRIDGE__.inspectReloadSafety();
    expect(safety.hasDraft).toBe(true);
    expect(safety.draftLength).toBe(10);

    // 4. 下書きを消して停止ボタンが現れた場合（回答生成中）
    ta.value = '';
    const stopBtn = document.createElement('button');
    stopBtn.setAttribute('aria-label', '回答の生成を停止');
    document.querySelector('main').appendChild(stopBtn);
    safety = window.__MUSE_BRIDGE__.inspectReloadSafety();
    expect(safety.isGenerating).toBe(true);
    expect(safety.hasDraft).toBe(false);
  });

  it('外部リンククリックおよび window.open を検知して __MUSE_OPEN_URL__ タイトル通知を発行する (Issue #54)', () => {
    document.title = 'Muse AI - Session';
    document.body.innerHTML = `
      <main>
        <a id="ext-link" href="https://example.com/docs" target="_blank"><span>外部リンク</span></a>
        <a id="int-link" href="https://muse.ai/thread/abc">内部リンク</a>
        <a id="oauth-link" href="https://accounts.google.com/o/oauth2/auth">Googleログイン</a>
      </main>
    `;

    // 内部リンクはフックしない
    const intEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.getElementById('int-link').dispatchEvent(intEvent);
    expect(intEvent.defaultPrevented).toBe(false);
    expect(document.title).toBe('Muse AI - Session');

    // OAuthリンクもフックしない
    const oauthEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.getElementById('oauth-link').dispatchEvent(oauthEvent);
    expect(oauthEvent.defaultPrevented).toBe(false);
    expect(document.title).toBe('Muse AI - Session');

    // 外部リンク（子要素 <span> クリック）はフックして __MUSE_OPEN_URL__ を設定する
    const extSpan = document.querySelector('#ext-link span');
    const extEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    extSpan.dispatchEvent(extEvent);
    expect(extEvent.defaultPrevented).toBe(true);
    expect(document.title).toBe('__MUSE_OPEN_URL__:https://example.com/docs');

    // window.open でも外部URLなら __MUSE_OPEN_URL__ を設定して null を返す
    document.title = 'Muse AI - Session';
    const opened = window.open('https://github.com/mowthow-works', '_blank');
    expect(opened).toBeNull();
    expect(document.title).toBe('__MUSE_OPEN_URL__:https://github.com/mowthow-works');
  });
});
