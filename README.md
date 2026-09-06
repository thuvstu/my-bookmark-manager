# 🔖 Bookmark Suite — Chrome 拡張

ブックマーク管理をひとつにまとめた統合スイート（Chrome 拡張 / Manifest V3）。
Web 版（`Github_Pages/HTMLeditor`）のフルエディタを同梱し、Chrome ブックマークと直接同期できます。

## 構成

| ファイル | 役割 |
|---|---|
| `popup.html` / `popup.js` | ポップアップ UI（掃除・YT退避/復元・統計・設定 + エディタ起動） |
| `index.html` / `app.js` / `style.css` / `parser-worker.js` | 同梱フルエディタ（Web 版と同一、更新時は再コピー） |
| `bridge.js` | エディタ ⇔ Chrome ブックマークの相互同期（拡張のみの追加層） |
| `background.js` | キーボードコマンド / 定期アラーム / 通知 / クイックバックアップ |
| `url-cleaner.js` | 全サイトでトラッキングパラメータを自動除去 |

## 使い方

1. `chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを指定
2. ツールバーのアイコン → ポップアップの **🚀 エディタを開く**（または右クリック→オプション）
3. エディタ内の新しいボタン：
   - **🌐 ブラウザから読み込み**: 現在の Chrome ブックマーク全体をエディタへ取り込み
   - **☁️ ブラウザへ書き戻す**: 編集結果で「ブックマークバー／その他」を上書き
     （直前状態を HTML バックアップとして自動ダウンロードしてから実行）

### ショートカット

| コマンド | キー |
|---|---|
| エディタを開く | `Alt+Shift+E` |
| クイックバックアップ | `Alt+Shift+B` |
| 開いているタブをブックマーク保存 | `Alt+Shift+T` |

## Web 版との同期

`index.html` / `style.css` / `app.js` / `parser-worker.js` は Web 版のコピーです。
Web 版を更新したら同名ファイルをこのフォルダへ再コピーしてください。
唯一の差分: 拡張側 `index.html` の末尾に `<script src="./bridge.js"></script>` が追加されています。

連携は `window.BookmarkSuite` API（`loadRawTree` / `getTree` / `confirm` / `toast` / `setStatus` 等）経由で行われるため、app.js 本体は無修正で共用できます。

## 注意

- 書き戻しは「ブックマークバー(id=1)」「その他のブックマーク(id=2)」を対象とします。
  読み込み時に自動付与される内部フラグ（`bid`）がないトップレベル項目は「その他」配下へ退避されます。
- YouTube 高評価の退避/復元は YouTube の内部 API を利用するため、仕様変更で動かなくなる可能性があります。
