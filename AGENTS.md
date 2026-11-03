# AGENTS.md - Muse Desktop Gadget 開発・運用ルール

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
