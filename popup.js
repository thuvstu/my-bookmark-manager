document.addEventListener('DOMContentLoaded', async () => {
  await updateCounts();
  setupTabs();
});

const statusDiv = document.getElementById('status');

// ---------------------------------------------------
// 1. タブ制御と共通UI
// ---------------------------------------------------
function setupTabs() {
  const tab1 = document.getElementById('tab-1');
  const tab2 = document.getElementById('tab-2');
  const view1 = document.getElementById('view-1');
  const view2 = document.getElementById('view-2');

  tab1.addEventListener('click', () => {
    tab1.classList.add('active'); tab2.classList.remove('active');
    view1.classList.add('active'); view2.classList.remove('active');
  });

  tab2.addEventListener('click', () => {
    tab2.classList.add('active'); tab1.classList.remove('active');
    view2.classList.add('active'); view1.classList.remove('active');
  });
}

function setStatus(msg) {
  statusDiv.textContent = msg;
}

// ---------------------------------------------------
// 2. ブラウザ管理機能 (ブックマーク/履歴)
// ---------------------------------------------------
const btnBrowser = document.getElementById('btn-browser-process');

btnBrowser.addEventListener('click', async () => {
  const confirmed = confirm("【警告】\n1. ブックマーク(HTML)の保存\n2. 履歴とYouTube視聴リスト(JSON)の保存\n\n上記完了後に「ブックマークを全削除」します。\nよろしいですか？");
  if (!confirmed) return;

  try {
    btnBrowser.disabled = true;
    setStatus("🚀 処理を開始します...");

    setStatus("1/3: ブックマークをバックアップ中...");
    const bmUrl = await createBookmarkHTMLUrl();
    await downloadFileAndWait(bmUrl, "bookmarks_backup.html");

    setStatus("2/3: 履歴データを抽出中...");
    const histUrl = await createHistoryJsonUrl();
    await downloadFileAndWait(histUrl, "history_youtube_backup.json");

    setStatus("3/3: 🗑️ ブックマーク削除を実行中...");
    await deleteAllBookmarks();

    setStatus("✅ 全て完了しました！");
    updateCounts();

  } catch (err) {
    console.error(err);
    setStatus(`⚠️ エラー: ${err.message}`);
  } finally {
    btnBrowser.disabled = false;
  }
});

async function updateCounts() {
  chrome.bookmarks.getTree((tree) => {
    let c = 0;
    const t = (n) => { n.forEach(i => { if(i.url) c++; if(i.children) t(i.children); }) };
    t(tree);
    document.getElementById('count-bm').textContent = c + " items";
  });
  chrome.history.search({text: '', maxResults: 1000}, (res) => {
    document.getElementById('count-hist').textContent = (res.length >= 1000 ? "1000+" : res.length) + " items";
  });
}

async function createBookmarkHTMLUrl() {
  const tree = await chrome.bookmarks.getTree();
  let rList = [];
  try { if (chrome.readingList) rList = await chrome.readingList.query({}); } catch(e){}

  let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n`;
  const esc = (s) => s ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;") : "";
  const proc = (node) => {
    let o = "";
    if (node.url) o += `    <DT><A HREF="${esc(node.url)}">${esc(node.title)}</A>\n`;
    else if (node.children) {
      o += `    <DT><H3>${esc(node.title)}</H3>\n    <DL><p>\n`;
      node.children.forEach(c => o += proc(c));
      o += `    </DL><p>\n`;
    }
    return o;
  };
  if (tree[0].children) tree[0].children.forEach(c => html += proc(c));
  if (rList.length > 0) {
    html += `    <DT><H3>Reading List</H3>\n    <DL><p>\n`;
    rList.forEach(i => html += `        <DT><A HREF="${esc(i.url)}">${esc(i.title)}</A>\n`);
    html += `    </DL><p>\n`;
  }
  html += `</DL><p>`;
  return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
}

async function createHistoryJsonUrl() {
  const items = await chrome.history.search({ text: '', startTime: 0, maxResults: 100000 });
  const clean = items.map(i => ({
    title: i.title, url: i.url, visitCount: i.visitCount,
    lastVisit: new Date(i.lastVisitTime).toLocaleString()
  }));
  const yt = clean.filter(i => i.url.includes("youtube.com/watch"));
  const json = JSON.stringify({ exportedAt: new Date().toLocaleString(), youtubeHistory: yt, fullHistory: clean }, null, 2);
  return URL.createObjectURL(new Blob([json], { type: 'application/json' }));
}

async function deleteAllBookmarks() {
  return new Promise(resolve => {
    chrome.bookmarks.getTree(tree => {
      const root = tree[0];
      if(!root.children) { resolve(); return; }
      const p = [];
      root.children.forEach(f => {
        if(f.children) f.children.forEach(n => p.push(new Promise(r => chrome.bookmarks.removeTree(n.id, r))));
      });
      Promise.all(p).then(resolve);
    });
  });
}

function downloadFileAndWait(url, name) {
  return new Promise((resolve, reject) => {
    const ts = new Date().toISOString().slice(0,10).replace(/-/g, '');
    chrome.downloads.download({ url: url, filename: name.replace('.', `_${ts}.`), saveAs: true }, (id) => {
      if (chrome.runtime.lastError || !id) return reject(new Error("保存キャンセル"));
      const cb = (d) => {
        if (d.id === id && d.state) {
          if (d.state.current === 'complete') { chrome.downloads.onChanged.removeListener(cb); resolve(); }
          else if (d.state.current === 'interrupted') { chrome.downloads.onChanged.removeListener(cb); reject(new Error("失敗")); }
        }
      };
      chrome.downloads.onChanged.addListener(cb);
    });
  });
}

// ---------------------------------------------------
// 3. YouTube 管理機能 (修正箇所)
// ---------------------------------------------------
const btnYt = document.getElementById('btn-yt-clone');

btnYt.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url.includes("youtube.com/playlist?list=LL")) {
    setStatus("⚠️ エラー: YouTubeの「高く評価した動画」ページを開いてください。");
    return;
  }
  
  setStatus("📺 YouTube操作スクリプトを実行中...");
  
  // 【重要】world: 'MAIN' を指定することで、ページ内の変数(API Key)にアクセス可能にします
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: runYoutubeCloner,
    world: 'MAIN' 
  }, () => {
    if (chrome.runtime.lastError) setStatus("エラー: " + chrome.runtime.lastError.message);
  });
});

async function runYoutubeCloner() {
  const log = (msg) => {
    console.log(`[YT Manager] ${msg}`);
    let box = document.getElementById('yt-man-log');
    if (!box) {
      box = document.createElement('div');
      box.id = 'yt-man-log';
      box.style.cssText = "position:fixed; bottom:10px; right:10px; width:320px; height:200px; background:rgba(0,0,0,0.85); color:#0f0; padding:10px; font-size:12px; overflow-y:scroll; z-index:9999; border-radius:8px;";
      document.body.appendChild(box);
    }
    box.innerText += msg + "\n";
    box.scrollTop = box.scrollHeight;
  };

  log("開始: 動画リストの取得を開始します...");

  try {
    // 1. スクロールしてID収集
    const ids = new Set();
    let noChange = 0;
    for (let i = 0; i < 100; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 1500));
      const links = document.querySelectorAll('a#video-title');
      const prevSize = ids.size;
      links.forEach(a => {
        const v = new URL(a.href).searchParams.get('v');
        if (v) ids.add(v);
      });
      log(`スクロール ${i+1}: 現在 ${ids.size} 件検出`);
      if (ids.size === prevSize) { noChange++; if(noChange >= 3) break; } else { noChange = 0; }
      if (ids.size >= 5000) break;
    }

    const videoIds = Array.from(ids);
    if (videoIds.length === 0) throw new Error("動画が見つかりませんでした。");

    // 2. プレイリスト作成
    const title = `Liked Backup ${new Date().toISOString().slice(0,10)}`;
    log(`プレイリスト作成中: ${title}`);
    
    // APIキーのチェック
    if (!window.ytcfg || !window.ytcfg.data_ || !window.ytcfg.data_.INNERTUBE_API_KEY) {
      throw new Error("APIキーが見つかりません。YouTubeのページが正しく読み込まれているか確認してください。");
    }
    const key = window.ytcfg.data_.INNERTUBE_API_KEY;
    const ctx = window.ytcfg.data_.INNERTUBE_CONTEXT;

    const res = await fetch(`https://www.youtube.com/youtubei/v1/playlist/create?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: ctx, title: title, privacyStatus: "PRIVATE" })
    });
    const json = await res.json();
    if (!json.playlistId) throw new Error("プレイリスト作成に失敗しました: " + JSON.stringify(json));
    
    const plId = json.playlistId;
    log(`作成成功 ID: ${plId}`);

    // 3. 動画追加
    log(`動画を追加中 (${videoIds.length}件)...`);
    const chunkSize = 50;
    for (let i = 0; i < videoIds.length; i += chunkSize) {
      const chunk = videoIds.slice(i, i + chunkSize);
      await fetch(`https://www.youtube.com/youtubei/v1/browse/edit_playlist?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: ctx, playlistId: plId,
          actions: chunk.map(v => ({ action: "ACTION_ADD_VIDEO", addedVideoId: v }))
        })
      });
      log(`進捗: ${Math.min(i+chunkSize, videoIds.length)} / ${videoIds.length}`);
      await new Promise(r => setTimeout(r, 500));
    }
    
    log("🎉 全て完了しました！");
    alert("バックアップ完了しました！YouTubeのライブラリを確認してください。");

  } catch (e) {
    log(`❌ エラー: ${e.message}`);
    console.error(e);
  }
}