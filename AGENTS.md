# AGENTS.md - Muse Desktop Mascot 開発・運用ルール

本ファイルは、AI エージェントが本リポジトリ（`muse-desktop-mascot`）で開発・ビルド・リリース作業を行う際に必ず遵守すべきプロジェクト固有ルールを定義します。

---

## 1. ゴミファイル（不要な成果物・一時ファイル）残存防止ルール

ビルド、パッケージング、ドキュメント更新、および GitHub Release 作業を行う際は、**ワークスペース内に古いファイルや一時ファイルのゴミが絶対に残らないよう** 以下を徹底すること：

1. **配布用 ZIP アーカイブの整理（ルートディレクトリ）**
   - 新しいバージョン（例: `muse-desktop-mascot-v0.9.0-windows-x64.zip`）を作成・配置する際は、直前に必ず古いバージョンの ZIP ファイル（`muse-desktop-mascot-v*.zip`）を削除すること。
2. **`dist/` フォルダの最新化またはクリーンアップ**
   - `dist/` フォルダが存在する場合、リリースビルド完了時に必ず `dist/muse-desktop-mascot.exe`、`dist/README.md`、`dist/avatars/setting.json`、`dist/avatars/plugin/quotes.json` を最新ビルドの成果物で上書き更新すること（古いバージョンの `.exe` を放置しない）。
3. **ドキュメント・画像差し替え時の不要ファイル削除（`docs/` 等）**
   - `README.md` 等のスクリーンショットやアセットを新しいファイル名で追加・差し替えた場合は、参照されなくなった古い画像ファイル（例: 旧UIのスクリーンショット等）を速やかに `git rm` / 削除すること。
4. **一時ファイル（JSON ペイロード等）の即時削除**
   - GitHub REST API 送信用の UTF-8 JSON ファイル（`issue_payload.json`, `release_payload.json` 等）やパッケージング用の一時ステージングフォルダは、リポジトリルートに作成せず一時ディレクトリ（スクラッチ領域または `$env:TEMP`）に作成し、使用後は速やかに削除すること。

---

## 2. アバター動画（`.mp4`）の取り扱いルール

- 著作権およびユーザーごとの汎用性確保のため、`src-tauri/assets/avatars/*.mp4` および `src-tauri/assets/avatars/plugin/*.mp4` は **Git 管理対象外（`.gitignore`）** とし、**配布用 ZIP アーカイブ（`dist/` 含む）にも同梱しない** こと。
- Git リポジトリおよび配布用 ZIP には、設定ファイルである `src-tauri/assets/avatars/setting.json` と `src-tauri/assets/avatars/plugin/quotes.json` のみを同梱すること。
- Rust コード内で `.mp4` ファイルに対して `include_bytes!` を使用しないこと（`git clone` 直後で `.mp4` が存在しない環境でも `cargo build` が通るように保つこと）。

---

## 3. Git / GitHub Issue / Release 運用ルール

- 作業を開始する前に、何をするのかユーザーへメッセージを出力してから着手すること。
- Git リポジトリのコード・ドキュメントを変更する場合は、先に GitHub Issue を発行し、ユーザーの確認を得てから作業を進めること。
- Git コミットはユーザーの動作確認・レビュー承認後に実施し、日本語のコミットメッセージに `(Closes #<Issue番号>)` を含めること。
- `README.md` に記載された仕様・画面・設定に関連する変更を行った場合は、必ず `README.md`（および `dist/README.md`）を同期更新すること。
- 公開ドキュメントやソースコード内にファイルパスを記載する場合は、リポジトリルートからの相対パスを記載すること。

---

## 4. ビルド・動作確認ルール（Debug vs Release）

- **開発・各 Issue の動作確認時（`dev/*` ブランチ等）**:
  - ビルド時間の短縮のため、**Debug ビルド（`cargo build`）** で実施し、生成された `src-tauri/target/debug/muse-desktop-mascot.exe` を `dist/muse-desktop-mascot.exe` へ配置して動作確認を行うこと（配布用 ZIP やインストーラの作成はスキップ）。
- **Release 時（`main` ブランチへマージする直前）**:
  - バージョンの全機能が揃い、ユーザーから「Releaseします！」と指示された `main` マージ直前のタイミングでのみ、**Release ビルドおよびインストーラ作成（`npm run build:installer` / `npx tauri build`）** を行い、最適化された `.exe` を `dist/` へ上書き配置し、配布用 ZIP アーカイブ（`muse-desktop-mascot-v*.zip`）および NSIS セットアップインストーラを作成・Release へ添付すること。通常開発時はインストーラ作成を行わないこと。
  - **Release 前ドキュメント同期チェックリスト**（ビルド・タグ打ちの前に必ず確認すること）：
    1. `git log <前回タグ>..HEAD --oneline` で対象バージョンの全変更（Issue）を洗い出す。
    2. `README.md` のバージョンバッジ（`version-vX.Y.Z`）および記載内容を最新化し、`dist/README.md` へ同期する。
    3. `docs/SPEC.md` の該当セクション（新仕様・挙動変更）および「§18 バージョンと機能の対応」に当該バージョン行を追記する。
    4. 設定項目・トレイメニュー・UI 操作に変更がある場合、`docs/CUSTOMIZE.md` を更新する。


---

## 5. デグレード防止・3層自動テスト運用ルール

機能追加やバグ修正に伴うデグレード（既存機能の破損・UIレイアウト崩れ・DOM抽出ミス等）を防止するため、以下の **3層自動テストスイート** を整備しています。

- **第1層：Rust バックエンド単体テスト (`npm run test:rust`)**
  - 対象: `src-tauri/src/lib.rs`（設定互換性、AppDataシード・プラグイン動画収集、URL正規化、異常座標ガード等）
- **第2層：フロントエンド＆ブリッジ単体テスト (`npm run test:unit`)**
  - 対象: `tests/unit/session_bridge.test.js`, `tests/unit/main_logic.test.js`, `tests/unit/docs_sync.test.js`（Vitest + jsdom による Muse DOM 解析・選択肢抽出・利用枠算出・IME二重送信防止・ライブつぶやき抽出・ドキュメント/バージョン整合性等の検証）
- **第3層：Playwright 実ブラウザ UI / レイアウト回帰テスト (`npm run test:e2e`)**
  - 対象: `tests/e2e/mascot.spec.js`（Microsoft Edge ヘッドレスエンジン上で `src/index.html`・`src/settings.html` を実描画し、ステータスピル表示時のアバター位置ブレ 0px 検証やスケール切替・選択肢返信・設定保存を E2E 検証）

### 必須運用ルール
1. **動作確認依頼前の全テスト実行必須**
   - コード（`.rs`, `.js`, `.html`, `.css`）を変更した場合は、ユーザーへ動作確認を依頼する前に **必ず `npm test`（全3層一括テスト）を実行し、全テストがパスすることを確認** すること。
2. **バグ修正時の再発防止テスト追加**
   - 新たな不具合やデグレードを修正する際は、原則としてその不具合を再現・検証するテストケースを `tests/unit/`、`tests/e2e/`、または `src-tauri/src/lib.rs` のいずれかに追加すること。
