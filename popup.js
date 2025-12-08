document.addEventListener('DOMContentLoaded', updateCount);

const btnProcess = document.getElementById('btn-process');
const statusDiv = document.getElementById('status');

btnProcess.addEventListener('click', async () => {
  // 1. ユーザーへの最終確認
  const confirmed = confirm("【手順】\n1. ブックマーク保存の画面が出ます。\n2. 保存が完了すると、自動的に全削除されます。\n\n実行しますか？");
  if (!confirmed) return;

  try {
    // UIをロック
    btnProcess.disabled = true;
    setStatus("⏳ バックアップデータを作成中...");

    // 2. HTMLデータの生成
    const url = await createBookmarkHTMLUrl();

    setStatus("💾 保存場所を選択してください...");

    // 3. ダウンロードを実行し、完了を待つ (ここが重要)
    await downloadFileAndWait(url);

    // 4. ダウンロード完了後、削除を実行
    setStatus("🗑️ バックアップ完了。削除を実行中...");
    await deleteAllBookmarks();

    // 5. 完了処理
    setStatus("✅ 全て完了しました。\nブックマークは安全にバックアップされ、削除されました。");
    updateCount();

  } catch (err) {
    console.error(err);
    // キャンセルされた場合やエラー時はここで止まる
    setStatus(`⚠️ 停止しました: ${err.message}`);
  } finally {
    btnProcess.disabled = false;
  }
});

function setStatus(msg) {
  statusDiv.textContent = msg;
}

// ---------------------------------------------------
// ダウンロード完了を確実に待つための関数
// ---------------------------------------------------
function downloadFileAndWait(url) {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const filename = `bookmarks_backup_${timestamp}.html`;

    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true // 保存ダイアログを出す
    }, (downloadId) => {
      // ユーザーがダイアログで「キャンセル」した場合のエラーハンドリング
      if (chrome.runtime.lastError) {
        return reject(new Error("保存がキャンセルされました。削除は実行しません。"));
      }
      if (!downloadId) {
        return reject(new Error("ダウンロードを開始できませんでした。"));
      }

      setStatus("⏳ ダウンロード中... 完了まで待機しています");

      // ダウンロードの状態変化を監視するイベントリスナー
      const onChanged = (delta) => {
        if (delta.id === downloadId) {
          if (delta.state && delta.state.current === 'complete') {
            // 完了したらリスナーを削除して解決
            chrome.downloads.onChanged.removeListener(onChanged);
            resolve();
          } else if (delta.state && delta.state.current === 'interrupted') {
            // 中断・失敗したらエラーにする
            chrome.downloads.onChanged.removeListener(onChanged);
            reject(new Error("ダウンロードが失敗・中断されました。削除は中止します。"));
          }
        }
      };
      
      // リスナー登録
      chrome.downloads.onChanged.addListener(onChanged);
    });
  });
}

// ---------------------------------------------------
// HTMLデータの生成 (Blob URLを返す)
// ---------------------------------------------------
async function createBookmarkHTMLUrl() {
  const tree = await chrome.bookmarks.getTree();
  let readingListItems = [];
  if (chrome.readingList) {
    try { readingListItems = await chrome.readingList.query({}); } catch(e){}
  }

  let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;

  const rootChildren = tree[0].children;
  if (rootChildren) {
    rootChildren.forEach(child => { html += processNode(child); });
  }

  if (readingListItems.length > 0) {
    const now = Math.floor(Date.now() / 1000);
    html += `    <DT><H3 ADD_DATE="${now}" LAST_MODIFIED="${now}">Reading List</H3>\n    <DL><p>\n`;
    readingListItems.forEach(item => {
      html += `        <DT><A HREF="${escapeHtml(item.url)}" ADD_DATE="${now}">${escapeHtml(item.title || item.url)}</A>\n`;
    });
    html += `    </DL><p>\n`;
  }

  html += `</DL><p>`;

  const blob = new Blob([html], { type: 'text/html' });
  return URL.createObjectURL(blob);
}

function processNode(node) {
  let output = "";
  const addDate = node.dateAdded ? Math.floor(node.dateAdded / 1000) : 0;
  
  if (node.url) {
    output += `    <DT><A HREF="${escapeHtml(node.url)}" ADD_DATE="${addDate}">${escapeHtml(node.title)}</A>\n`;
  } else if (node.children) {
    const lastModified = node.dateGroupModified ? Math.floor(node.dateGroupModified / 1000) : 0;
    output += `    <DT><H3 ADD_DATE="${addDate}" LAST_MODIFIED="${lastModified}">${escapeHtml(node.title)}</H3>\n    <DL><p>\n`;
    node.children.forEach(child => { output += processNode(child); });
    output += `    </DL><p>\n`;
  }
  return output;
}

function escapeHtml(text) {
  if (!text) return "";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ---------------------------------------------------
// 全削除ロジック & カウント
// ---------------------------------------------------
function updateCount() {
  chrome.bookmarks.getTree((tree) => {
    let count = 0;
    const traverse = (nodes) => {
      nodes.forEach(node => {
        if (node.url) count++;
        if (node.children) traverse(node.children);
      });
    };
    traverse(tree);
    document.getElementById('count').textContent = count + " 個";
  });
}

function deleteAllBookmarks() {
  return new Promise((resolve) => {
    chrome.bookmarks.getTree((tree) => {
      const root = tree[0];
      const children = root.children;
      if (!children) { resolve(); return; }

      const promises = [];
      children.forEach(mainFolder => {
        if (mainFolder.children) {
          mainFolder.children.forEach(bookmarkNode => {
            promises.push(new Promise((res) => {
              chrome.bookmarks.removeTree(bookmarkNode.id, res);
            }));
          });
        }
      });
      Promise.all(promises).then(resolve);
    });
  });
}