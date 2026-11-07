import { test, expect } from '@playwright/test';

test.describe('Muse Desktop Mascot - Real Browser UI & Layout Regression Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Inject Tauri IPC mock before page scripts run
    await page.addInitScript(() => {
      window.__TAURI_INVOKED__ = [];
      window.__TAURI_LISTENERS__ = {};
      window.__MOCK_AVATAR_STATE__ = { state: 'idle', statusText: 'リンク済み' };
      window.__MOCK_MESSAGES__ = [
        { role: 'assistant', text: 'こんにちは！何かお手伝いしましょうか？' },
      ];

      window.__TAURI__ = {
        core: {
          invoke: async (cmd, args) => {
            window.__TAURI_INVOKED__.push({ cmd, args });
            if (cmd === 'get_gadget_config') {
              return {
                size_mode: 'mascot',
                mascot_scale: 'standard',
                mascot_bubble_on_left: true,
                message_limit: 5,
                avatar_name: 'ラッキー',
              };
            }
            if (cmd === 'get_session_status') {
              return {
                exists: true,
                visible: false,
                url: 'https://muse.ai/chat/dedicated-room-123',
              };
            }
            if (cmd === 'get_avatar_video_pack') {
              return {
                idle: 'data:video/mp4;base64,AAAA',
                waking: 'data:video/mp4;base64,BBBB',
                working: 'data:video/mp4;base64,CCCC',
                making_something: 'data:video/mp4;base64,DDDD',
                milestone_level_up: 'data:video/mp4;base64,EEEE',
                plugins: [],
                setting: {
                  sound_enabled: false,
                  bubble_display_duration_sec: 30,
                  idle_threshold_sec: 180,
                },
                quotes: {},
              };
            }
            if (cmd === 'get_usage_limit') {
              return {
                plan_name: 'Proプラン',
                used_percent: 20,
                remaining_percent: 80,
                reset_text: '1週間の上限は11月14日にリセットされます',
              };
            }
            if (cmd === 'get_chat_messages') {
              return window.__MOCK_MESSAGES__;
            }
            if (cmd === 'get_avatar_state') {
              return window.__MOCK_AVATAR_STATE__;
            }
            if (cmd === 'check_bridge_health') {
              return {
                avatar_name: 'ラッキー',
                avatar_state: window.__MOCK_AVATAR_STATE__.state,
                r1_avatar: { ok: true, selector: 'video' },
                r2_messages: { ok: true, selector: '.group/msg' },
                r3_input: { ok: true, selector: 'textarea' },
                r5_limit: { ok: true, selector: 'button' },
              };
            }
            if (cmd === 'get_plugin_configs') {
              return {
                setting: {
                  avatar_name: 'ラッキー',
                  idle_threshold_sec: 180,
                  action_interval_sec: 180,
                  default_duration_sec: 30,
                  bubble_display_duration_sec: 30,
                  touch_reaction_duration_sec: 8,
                  sound_enabled: true,
                  sound_volume: 45,
                  live_quotes: {
                    enabled: false,
                    target_mode: 'main',
                    custom_chat_url: '',
                    batch_count: 4,
                    min_interval_min: 60,
                    daily_limit: 6,
                    quiet_hours_start: '22:00',
                    quiet_hours_end: '07:00',
                  },
                },
                quotes: {
                  touch_reactions: ['はーい！'],
                  default_idle_quotes: ['今日もいい天気だね'],
                  videos: {},
                },
              };
            }
            if (cmd === 'sync_mascot_bubble_direction') return true;
            return true;
          },
        },
        event: {
          listen: async (eventName, cb) => {
            window.__TAURI_LISTENERS__[eventName] = cb;
            return () => {};
          },
        },
      };
    });
  });

  test('Issue #35, #36: ステータスピル表示・非表示切り替え時にアバターの位置が 1px もブレないこと', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('body')).toHaveClass(/mode-mascot/);

    const avatarContainer = page.locator('#avatar-container');
    const statusPill = page.locator('#avatar-status-pill');

    // 初期状態（idle / リンク済み）ではステータスピルは非表示
    await expect(statusPill).toBeHidden();
    const rectBefore = await avatarContainer.boundingBox();
    expect(rectBefore).not.toBeNull();

    // Muse が動作中（考え中...）に変化した場合をシミュレート
    await page.evaluate(async () => {
      window.__MOCK_AVATAR_STATE__ = { state: 'working', statusText: '考え中...' };
      if (typeof syncAvatarStateWithMuse === 'function') {
        await syncAvatarStateWithMuse();
      }
    });

    await expect(statusPill).toBeVisible();
    await expect(page.locator('#avatar-status-text')).toHaveText('🛠️ 考え中...');

    const rectDuringWorking = await avatarContainer.boundingBox();
    expect(rectDuringWorking).not.toBeNull();

    // アバターの X, Y, Width, Height が 1px もブレていないことを検証
    expect(Math.round(rectDuringWorking.x)).toBe(Math.round(rectBefore.x));
    expect(Math.round(rectDuringWorking.y)).toBe(Math.round(rectBefore.y));
    expect(Math.round(rectDuringWorking.width)).toBe(Math.round(rectBefore.width));
    expect(Math.round(rectDuringWorking.height)).toBe(Math.round(rectBefore.height));

    // 再び idle（リンク済み）に戻ったときにピルが消え、位置も変わらないこと
    await page.evaluate(async () => {
      window.__MOCK_AVATAR_STATE__ = { state: 'idle', statusText: 'リンク済み' };
      if (typeof syncAvatarStateWithMuse === 'function') {
        await syncAvatarStateWithMuse();
      }
    });
    await expect(statusPill).toBeHidden();
  });

  test('Issue #25: マスコットスケール切替 (small / standard / large) で実描画サイズが正確に変化すること', async ({ page }) => {
    await page.goto('/index.html');
    const avatarContainer = page.locator('#avatar-container');

    // standard (116px)
    const boxStd = await avatarContainer.boundingBox();
    expect(Math.round(boxStd.width)).toBe(116);

    // small (93px)
    await page.evaluate(() => {
      window.__TAURI_LISTENERS__['mascot-scale-changed']({ payload: 'small' });
    });
    const boxSmall = await avatarContainer.boundingBox();
    expect(Math.round(boxSmall.width)).toBe(93);

    // large (145px)
    await page.evaluate(() => {
      window.__TAURI_LISTENERS__['mascot-scale-changed']({ payload: 'large' });
    });
    const boxLarge = await avatarContainer.boundingBox();
    expect(Math.round(boxLarge.width)).toBe(145);
  });

  test('Issue #32: 選択肢付き返答の吹き出し表示とワンクリック返信が正常に動作すること', async ({ page }) => {
    await page.goto('/index.html');

    // まず初回同期（過去ログのベースライン記録）を実行し、その後に選択肢付きの新着メッセージを配信
    await page.evaluate(async () => {
      await loadChatMessages();
      window.__MOCK_MESSAGES__ = [
        { role: 'assistant', text: 'こんにちは！何かお手伝いしましょうか？' },
        {
          role: 'assistant',
          text: '進める方針を選んでね！',
          options: ['方針Aで実行', '方針Bで実行'],
        },
      ];
      await loadChatMessages();
    });

    const bubble = page.locator('#mascot-bubble');
    await expect(bubble).toBeVisible();

    // タイピング完了後に選択肢ボタンが表示されるのを待つ
    const optionBtnA = page.locator('.mascot-option-btn', { hasText: '方針Aで実行' });
    await expect(optionBtnA).toBeVisible({ timeout: 5000 });

    // 選択肢ボタンをクリックしてワンクリック送信
    await optionBtnA.click();

    const sentCall = await page.evaluate(() => {
      return window.__TAURI_INVOKED__.find(
        (c) => c.cmd === 'send_chat_message' && c.args?.text === '方針Aで実行'
      );
    });
    expect(sentCall).toBeTruthy();
  });

  test('Issue #37, #39: 設定画面のタブ切り替え、専用チャットURL登録ボタン、設定保存が正常に機能すること', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 720 });
    await page.goto('/settings.html');

    // 初期状態でタイマータブが表示されていること
    await expect(page.locator('#tab-timers')).toBeVisible();
    await expect(page.locator('#input-avatar-name')).toHaveValue('ラッキー');

    // 「🎬 放置アクション ＆ セリフ」タブへ切り替え
    await page.locator('.tab-btn[data-tab="tab-quotes"]').click();
    await expect(page.locator('#tab-quotes')).toBeVisible();

    // 専用チャットURLモードを選択するとURL入力欄が表示されること
    await expect(page.locator('#live-quotes-custom-url-group')).toBeHidden();
    await page.locator('input[name="live-quotes-target-mode"][value="custom"]').check();
    await expect(page.locator('#live-quotes-custom-url-group')).toBeVisible();

    // 「📍 今開いているチャットを登録」ボタンをクリックするとセッションの現在URLが入ること
    await page.locator('#btn-fill-current-chat-url').click();
    await expect(page.locator('#live-quotes-custom-url')).toHaveValue(
      'https://muse.ai/chat/dedicated-room-123'
    );

    // 「💾 保存して適用」をクリックすると save_plugin_configs が呼ばれること
    await page.locator('#btn-save').click();
    const savedCall = await page.evaluate(() => {
      return window.__TAURI_INVOKED__.find((c) => c.cmd === 'save_plugin_configs');
    });
    expect(savedCall).toBeTruthy();
    expect(savedCall.args.setting.live_quotes.target_mode).toBe('custom');
    expect(savedCall.args.setting.live_quotes.custom_chat_url).toBe(
      'https://muse.ai/chat/dedicated-room-123'
    );
  });
});
