# Muse Desktop Mascot

[![Release](https://img.shields.io/badge/version-v1.1.1-blue.svg)](https://github.com/mowthow-works/muse-win-gadets/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6.svg)](https://www.microsoft.com/windows)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Muse（パーソナルAIエージェント `https://muse.ai`）の Windows 向け常駐型デスクトップマスコット＆チャット連携アプリです。
普段はデスクトップの隅に円形アバターマスコットとして控えめに常駐し、Muse の状態に応じたアニメーション・気まぐれアクション・新着メッセージのルパン風タイピング吹き出しを表示します。ダブルクリックやショートカットキー（`Ctrl + Shift + M`）で、いつでもフル機能の Muse AI チャット画面（セッション画面）を即座に呼び出せます。

<div align="center">
  <table>
    <tr>
      <td align="center" width="40%">
        <b>✨ マスコット状態（タスクバー・デスクトップ常駐）</b><br />
        <img src="docs/screenshot_mascot.png" alt="Muse Desktop Mascot Mode" width="300" />
      </td>
      <td align="center" width="60%">
        <b>💬 チャット画面（Muse AI セッション画面）</b><br />
        <img src="docs/screenshot_session.png" alt="Muse AI Session Chat Screen" width="500" />
      </td>
    </tr>
  </table>
</div>

---

## 🌟 特徴

- **状態に連動するアバターアニメーション**：Muse の状態（待機・思考中・作業中・完了）を監視し、対応するアバター動画を 500ms の滑らかなクロスフェードで自動切替
- **放置（IDLE）アクション**：操作がない状態が続くと、プラグイン動画（食事・メイク・スマホ・居眠りなど）をランダム再生し、セリフを吹き出し表示
- **ライブつぶやき**：IDLE 中に Muse 本人が生成した一言をその場で取得して表示（任意機能・既定 OFF）→ [詳細](#-ライブつぶやき任意機能)
- **新着通知**：新着メッセージをルパン風パタパタタイピング吹き出しで通知。未読バッジ（🔴 1〜9+）も表示
- **クイック1行入力**：セッション画面を開かず、マスコット横のミニ入力バーからそのまま質問を送信（日本語打鍵音つき）
- **利用枠の可視化**：残り利用枠に応じてマスコット外周枠の色が変化し、ネームプレートに残量 % を常時表示

<div align="center">
  <table>
    <tr>
      <th align="center">🟢 安全（残り80%以上）</th>
      <th align="center">🟠 注意警戒（50%〜79%）</th>
      <th align="center">🔴 危険（50%未満）＋ 未読通知</th>
    </tr>
    <tr>
      <td align="center">
        <img src="docs/mascot_status_safe.png" alt="安全（緑枠・85%）" width="170" /><br />
        <b><code>[ ラッキー 85% ]</code></b>
      </td>
      <td align="center">
        <img src="docs/mascot_status_warn.png" alt="注意（オレンジ枠・59%）" width="170" /><br />
        <b><code>[ ラッキー 59% ]</code></b>
      </td>
      <td align="center">
        <img src="docs/mascot_status_danger.png" alt="危険（赤枠・15% ＋ 未読通知バッジ）" width="170" /><br />
        <b><code>[ ラッキー 15% ]</code> ＋ 🔴<code>1</code></b>
      </td>
    </tr>
  </table>
</div>

---

## 📥 インストール

[Releases](https://github.com/mowthow-works/muse-win-gadets/releases) からインストーラ（`Muse Desktop Mascot_<version>_x64-setup.exe`）をダウンロードして実行してください。管理者権限は不要（Per-user インストール）で、デスクトップショートカットとアンインストーラが自動構成されます。

### Windows SmartScreen 警告が出た場合

ダウンロードしたインストーラやポータブル版の実行時に **「Windows によって PC が保護されました」** という青い画面が表示される場合があります。これは、個人開発・オープンソースの新しいバイナリに対して SmartScreen が「ダウンロード実績がまだ少ない未知のアプリ」として機械的に表示する安全確認の画面です。以下の手順でそのままインストール・起動できます。

<div align="center">
  <img src="docs/smartscreen_warning.png" alt="Windows SmartScreen 警告画面" width="340" />
</div>

1. 警告画面の左上にある **「詳細情報」**（下線リンク）をクリックします。
2. 画面右下に現れる **「実行」** ボタンをクリックします。
3. 通常通りセットアップ画面（またはアプリ）が起動します。

> [!TIP]
> ダウンロードした `.exe` ファイルを右クリック ➜ **「プロパティ」** を開き、全般タブの一番下にある **「セキュリティ: 許可する」**（または「ブロックの解除」）にチェックを入れて「OK」を押すことでも警告を回避できます。

---

## 🚀 クイックスタート

1. アプリを起動すると、デスクトップ右下付近にマスコットが表示されます。
2. マスコットを **ダブルクリック**（または `Ctrl + Shift + M` / トレイアイコンをクリック）して **Muse AI チャット画面** を開きます。
3. Google OAuth またはメールアドレス等で Muse にサインインします。
4. ログイン完了後、チャット画面右上の `−` または `×` を押すとマスコット状態に戻り、アバター名称・ステータス・新着チャットが自動同期されます（次回以降はログインセッションが自動維持されます）。

アカウントの認証情報（パスワードや Google OAuth）はアプリ側で一切保存しません。ログインは公式セッション画面上で行われ、セッション Cookie はアプリ専用のローカルデータフォルダにのみ永続化されます。

---

## 🖱️ 基本操作

| 操作 | 動作 |
| :--- | :--- |
| **マスコットをドラッグ** | デスクトップの好きな位置へ移動（位置は自動保存） |
| **マスコットをシングルクリック** | 喜びポーズ＋一言リアクション吹き出し |
| **クイック1行入力（💬）** | アバター右クリック または 💬ボタンでミニ入力バーを展開、その場で質問を送信（`Enter` で送信 / `Esc` で閉じる） |
| **マスコットをダブルクリック** | Muse AI チャット画面（セッション画面）を開く（前回終了時の位置・サイズを復元） |
| **吹き出し / 未読バッジをクリック** | チャット画面を開いてすぐ返信（未読バッジクリア） |
| **チャット画面の `−` / `×` ボタン** | チャット画面を隠してマスコット状態へ最小化 |
| **他アプリを操作（チャット画面が裏へ）** | マスコットが自動的に最前面へ現れる（チャット画面が表に戻ると自動非表示） |
| **`Ctrl + Shift + M`** | チャット画面 ⇄ マスコット状態の表示トグル（グローバルホットキー） |
| **トレイアイコン左クリック** | チャット画面 ⇄ マスコット状態の表示トグル |
| **トレイアイコン右クリック** | コンテキストメニュー表示（設定、表示サイズ、自動起動、効果音、ブラウザで開く、完全終了 等） |

マスコットの表示サイズ（大 125% / 標準 100% / 小 80%）、Windows 起動時の自動起動、効果音の有効/無効などは、トレイメニューまたは設定画面から変更できます。

---

## 🎨 カスタマイズ

本リポジトリには、著作権および汎用性（ユーザーごとにアバターが異なる点）への配慮から **アバター動画（`.mp4`）を含めていません**（設定ファイル `setting.json` と `quotes.json` のみ同梱）。ご自身のアバター動画を用意して配置してください。

- **GUI 設定画面**：トレイメニューの「設定...」から、動作タイマー（放置時間・吹き出し秒数等）、放置動画ごとの有効/無効、セリフの追加・編集が行えます
- **ホットリロード**：`setting.json` と `quotes.json` は、アプリ起動中でも保存するだけで 3 秒以内に自動反映されます
- **動画の配置先**：基本動画 5 種類（`idle` / `waking` / `working` / `making_something` / `milestone_level_up`）は `avatars/` 直下、放置アクション用は `avatars/plugin/` フォルダへ

動画の取得・配置手順、`setting.json` / `quotes.json` の全項目リファレンス、トレイメニューの全項目、開発者ツールの活用例は **[カスタマイズガイド](docs/CUSTOMIZE.md)** を参照してください。

---

## 💬 ライブつぶやき（任意機能）

IDLE 中のセリフを、固定の `quotes.json` だけでなく **Muse 本人がその場で生成した一言** にできます。

- マスコットが待機状態のときだけ、アプリが Muse のチャットへ短い作成依頼（ウェイク）を送り、返ってきた一言をプールに貯めて IDLE アクションで表示します
- 取得先は **メインチャット**（普段のチャット。そのまま使えて文脈の濃い一言になりやすい）か **専用チャット**（URL を設定に登録。普段のスレッドを汚さない）から選べます
- 実行中の会話を割り込まないよう、Muse が IDLE のときだけ取得します。取得間隔の下限（既定 60 分）、1 日の上限（既定 6 回）、静かな時間帯（既定 22:00〜07:00）も設定できます
- プールのセリフは 24 時間で破棄され、表示すると消費されます。プールが空の間は従来の固定セリフが表示されます

> [!IMPORTANT]
> **利用枠（Limit）の消費について**：ウェイク 1 回は Muse の会話 1 ターン分の利用枠を消費します。そのため本機能は **既定で OFF** です。有効にする場合は設定画面で ON にしてください。

設定項目の詳細は [カスタマイズガイド](docs/CUSTOMIZE.md) を参照してください。

---

## 🔒 セキュリティ

1. **ゼロ・ケイパビリティ設計**：Tauri の IPC 権限はマスコット本体ウィンドウのみに限定し、セッション画面（`https://muse.ai/?__pwa=1`）およびリモートオリジンには一切付与していません。
2. **Title Bridge**：リモート側に IPC を露出しないため、ステータス・新着メッセージ・アバター名などの同期データは WebView2 の `document.title` を使ったカスタムブリッジ経由で安全に渡されます。
3. **認証情報の保護**：パスワードや OAuth 情報をアプリ側で保存しません（クイックスタート節も参照）。

---

## 📚 ドキュメント構成

| ドキュメント | 役割 |
| :--- | :--- |
| **README.md**（本書） | 本アプリの概要・クイックスタート・基本操作 |
| **[カスタマイズガイド](docs/CUSTOMIZE.md)** | 利用者向けリファレンス（アバター動画の準備・配置手順、設定項目、トレイメニュー詳細） |
| **[機能仕様書](docs/SPEC.md)** | **実装の正（Single Source of Truth）**。セリフ選択抽選仕様、Title Bridge プロトコル、動作詳細仕様 |
| **[初期設計書](DESIGN.md)** | 初期構想・設計意図のアーカイブ（現行仕様は機能仕様書が優先） |

---

## 🛠️ 開発・ビルド手順

### 必要環境
- Windows 11 / 10
- Node.js 20+
- Rust (stable, MSVC ツールチェーン)
- Visual Studio C++ Build Tools

### 開発起動
```powershell
# PATH の設定（必要に応じて）
$env:PATH = "$env:USERPROFILE\.cargo\bin;C:\Program Files\nodejs;" + $env:PATH

# 依存関係のインストール（初回のみ）
npm install

# 開発モード起動
npm run dev
```

### プロダクションビルド

ポータブル単体実行ファイル（手動配置・ZIP 配布向け）：
```powershell
cargo build --release --manifest-path "src-tauri/Cargo.toml"
# 生成先: src-tauri/target/release/muse-desktop-mascot.exe
```

NSIS セットアップインストーラ（一般配布向け）：
```powershell
npm run build:installer
# または
npx tauri build
# 生成先: src-tauri/target/release/bundle/nsis/Muse Desktop Mascot_<version>_x64-setup.exe
```

---

## 📜 ライセンス

[MIT License](LICENSE) © 2026 mowthow-works
