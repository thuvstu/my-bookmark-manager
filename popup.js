document.addEventListener('DOMContentLoaded', async () => {
  await updateCounts();
  setupTabs();
});

const statusDiv = document.getElementById('status');

// --- UI制御 ---
function setupTabs() {
  const tab1 = document.getElementById('tab-1');
  const tab2 = document.getElementById('tab-2');
  const view1 = document.getElementById('view-1');
  const view2 = document.getElementById('view-2');
  const toggle = (t1, t2, v1, v2) => {
    t1.classList.add('active'); t2.classList.remove('active');
    v1.classList.add('active'); v2.classList.remove('active');
  };
  tab1.addEventListener('click', () => toggle(tab1, tab2, view1, view2));
  tab2.addEventListener('click', () => toggle(tab2, tab1, view2, view1));
}

function setStatus(msg) { statusDiv.textContent = msg; }

// =========================================================================
//  ブラウザ管理機能
// =========================================================================
const btnBrowser = document.getElementById('btn-browser-process');
btnBrowser.addEventListener('click', async () => {
  if(!confirm("【警告】\nブラウザのブックマークと履歴をバックアップ後に削除します。\nよろしいですか？")) return;
  try {
    btnBrowser.disabled = true;
    setStatus("🚀 開始: ブックマーク保存中...");
    const bmUrl = await createBookmarkHTMLUrl();
    await downloadFileAndWait(bmUrl, "bookmarks_backup.html");
    
    setStatus("履歴保存中...");
    const histUrl = await createHistoryJsonUrl();
    await downloadFileAndWait(histUrl, "history_youtube_backup.json");
    
    setStatus("削除実行中...");
    await deleteAllBookmarks();
    setStatus("✅ 完了しました！");
    updateCounts();
  } catch (e) {
    setStatus(`⚠️ エラー: ${e.message}`);
  } finally {
    btnBrowser.disabled = false;
  }
});

// (ブラウザ用ヘルパー関数群)
async function updateCounts() {
  chrome.bookmarks.getTree(t => {
    let c = 0; const f = n => { n.forEach(i => { if(i.url)c++; if(i.children)f(i.children); }) }; f(t);
    document.getElementById('count-bm').textContent = c + " items";
  });
  chrome.history.search({text:'', maxResults:1000}, r => {
    document.getElementById('count-hist').textContent = (r.length>=1000?"1000+":r.length) + " items";
  });
}
async function createBookmarkHTMLUrl() {
  const tree = await chrome.bookmarks.getTree();
  let rl = []; try{if(chrome.readingList) rl = await chrome.readingList.query({});}catch(e){}
  let h = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n`;
  const esc = s => s ? s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;") : "";
  const p = n => { let o=""; if(n.url)o+=`    <DT><A HREF="${esc(n.url)}">${esc(n.title)}</A>\n`; else if(n.children){o+=`    <DT><H3>${esc(n.title)}</H3>\n    <DL><p>\n`;n.children.forEach(c=>o+=p(c));o+=`    </DL><p>\n`;} return o; };
  if(tree[0].children) tree[0].children.forEach(c => h+=p(c));
  if(rl.length) { h+=`    <DT><H3>Reading List</H3>\n    <DL><p>\n`; rl.forEach(i=>h+=`        <DT><A HREF="${esc(i.url)}">${esc(i.title)}</A>\n`); h+=`    </DL><p>\n`; }
  h+=`</DL><p>`;
  return URL.createObjectURL(new Blob([h],{type:'text/html'}));
}
async function createHistoryJsonUrl() {
  const items = await chrome.history.search({text:'', startTime:0, maxResults:100000});
  const clean = items.map(i=>({title:i.title, url:i.url, visitCount:i.visitCount, lastVisit:new Date(i.lastVisitTime).toLocaleString()}));
  const yt = clean.filter(i=>i.url.includes("youtube.com/watch"));
  return URL.createObjectURL(new Blob([JSON.stringify({exportedAt:new Date().toLocaleString(), youtube:yt, full:clean},null,2)],{type:'application/json'}));
}
async function deleteAllBookmarks() {
  return new Promise(r => chrome.bookmarks.getTree(t => {
    const p=[]; t[0].children.forEach(f=>{if(f.children)f.children.forEach(n=>p.push(new Promise(res=>chrome.bookmarks.removeTree(n.id,res))))});
    Promise.all(p).then(r);
  }));
}
function downloadFileAndWait(url, name) {
  return new Promise((resolve, reject) => {
    const ts = new Date().toISOString().slice(0,10).replace(/-/g,'');
    chrome.downloads.download({url:url, filename:name.replace('.',`_${ts}.`), saveAs:true}, id => {
      if(!id) return reject(new Error("キャンセル"));
      const c = d => { if(d.id===id&&d.state){ if(d.state.current==='complete'){chrome.downloads.onChanged.removeListener(c);resolve();} else if(d.state.current==='interrupted'){chrome.downloads.onChanged.removeListener(c);reject(new Error("失敗"));}}};
      chrome.downloads.onChanged.addListener(c);
    });
  });
}

// =========================================================================
//  YouTube 管理機能 (修正版: removelike API使用)
// =========================================================================
const btnYt = document.getElementById('btn-yt-process');

btnYt.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url.includes("youtube.com/playlist?list=LL")) {
    setStatus("⚠️ エラー: YouTubeの「高く評価した動画」ページ(list=LL)を開いてください。");
    return;
  }

  const isJson = document.getElementById('chk-json').checked;
  const isDelete = document.getElementById('chk-delete').checked;

  if (isDelete) {
    const doubleCheck = confirm("【危険: 遡りモード】\nバックアップ完了後に、これらの動画の高評価を取り消します。\n(高評価リストから消え、代わりに古い動画が表示されるようになります)\n\n本当に実行しますか？");
    if (!doubleCheck) return;
  }

  setStatus("📺 YouTubeスクリプトを実行中...");
  
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: runYoutubeCloner,
    args: [{ isJson, isDelete }],
    world: 'MAIN'
  }, () => {
    if (chrome.runtime.lastError) setStatus("エラー: " + chrome.runtime.lastError.message);
  });
});

// --- ブラウザ内(MAIN world)で動くスクリプト ---
async function runYoutubeCloner(settings) {
  const log = (msg) => {
    console.log(`[YT Manager] ${msg}`);
    let box = document.getElementById('yt-man-log');
    if (!box) {
      box = document.createElement('div');
      box.id = 'yt-man-log';
      box.style.cssText = "position:fixed; bottom:10px; right:10px; width:340px; height:250px; background:rgba(0,0,0,0.95); color:#0f0; padding:10px; font-size:11px; overflow-y:scroll; z-index:9999; border-radius:6px; font-family:monospace; line-height:1.4;";
      document.body.appendChild(box);
    }
    box.innerText += msg + "\n";
    box.scrollTop = box.scrollHeight;
  };

  log(`開始: [JSON:${settings.isJson} / 削除:${settings.isDelete}]`);

  try {
    // 1. 環境チェック
    if (!window.ytcfg || !window.ytcfg.data_) throw new Error("YouTubeデータ(ytcfg)が見つかりません。リロードしてください。");
    const cfg = window.ytcfg.data_;
    const apiKey = cfg.INNERTUBE_API_KEY;
    const context = cfg.INNERTUBE_CONTEXT;
    const authUser = cfg.SESSION_INDEX || '0';

    // 2. 動画収集
    log("動画リストを取得中...");
    const videoMap = new Map();
    let noChange = 0;
    
    // スクロールループ (多めに設定)
    for (let i = 0; i < 100; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 1500));
      const links = document.querySelectorAll('a#video-title');
      const prevSize = videoMap.size;
      links.forEach(a => {
        const url = new URL(a.href);
        const vid = url.searchParams.get('v');
        if (vid && !videoMap.has(vid)) {
          const title = a.title || a.innerText || "Unknown Title";
          videoMap.set(vid, { id: vid, title: title.trim(), url: `https://www.youtube.com/watch?v=${vid}` });
        }
      });
      log(`スクロール ${i+1}: 検出 ${videoMap.size}件`);
      if (videoMap.size === prevSize) { noChange++; if(noChange>=3) break; } else { noChange = 0; }
      if (videoMap.size >= 5000) break;
    }

    const videos = Array.from(videoMap.values());
    if (videos.length === 0) throw new Error("動画が見つかりませんでした。");

    // 3. 認証ヘッダー
    const getHeaders = async () => {
      const match = document.cookie.match(/SAPISID=([^;]+)/);
      if (!match) throw new Error("SAPISID Cookieが見つかりません。");
      const sapisid = decodeURIComponent(match[1]);
      const origin = window.location.origin;
      const now = Math.floor(Date.now() / 1000);
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${now} ${sapisid} ${origin}`));
      const hash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
      return {
        "Authorization": `SAPISIDHASH ${now}_${hash}`,
        "X-Origin": origin,
        "X-Goog-AuthUser": authUser,
        "Content-Type": "application/json"
      };
    };
    const headers = await getHeaders();
    const dateStr = new Date().toISOString().slice(0,10);
    let backupSuccess = true;

    // 4. バックアップ処理 (JSON & Playlist)
    if (settings.isJson) {
      log("📄 JSONダウンロード準備...");
      const jsonStr = JSON.stringify({ exportedAt: new Date().toLocaleString(), count: videos.length, videos: videos }, null, 2);
      const url = URL.createObjectURL(new Blob([jsonStr], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `liked_videos_${dateStr}.json`; a.click();
      log("✅ JSONダウンロード開始");
      await new Promise(r => setTimeout(r, 1000));
    }

    const plTitle = `Liked Backup ${dateStr}`;
    log(`📺 プレイリスト作成: ${plTitle}`);
    const createRes = await fetch(`https://www.youtube.com/youtubei/v1/playlist/create?key=${apiKey}`, {
      method: "POST", headers: headers,
      body: JSON.stringify({ context: context, title: plTitle, privacyStatus: "PRIVATE" })
    });
    const createJson = await createRes.json();
    if (!createJson.playlistId) throw new Error("プレイリスト作成失敗");
    const plId = createJson.playlistId;
    log(`作成成功: ${plId}`);

    const chunkSize = 50;
    for (let i = 0; i < videos.length; i += chunkSize) {
      const chunk = videos.slice(i, i + chunkSize);
      const actions = chunk.map(v => ({ action: "ACTION_ADD_VIDEO", addedVideoId: v.id }));
      const addRes = await fetch(`https://www.youtube.com/youtubei/v1/browse/edit_playlist?key=${apiKey}`, {
        method: "POST", headers: headers,
        body: JSON.stringify({ context: context, playlistId: plId, actions: actions })
      });
      if(!addRes.ok) { log(`⚠️ 追加エラー`); backupSuccess = false; }
      log(`コピー進捗: ${Math.min(i+chunkSize, videos.length)}/${videos.length}`);
      await new Promise(r => setTimeout(r, 500));
    }

    // 5. 削除処理 (removelike API)
    if (settings.isDelete) {
      if (!backupSuccess) {
        log("⛔ バックアップ不完全のため削除中止");
        alert("バックアップエラーのため削除を中止しました。");
        return;
      }
      log("🗑️ 【高評価取り消し開始】...");
      
      // 1件ずつ処理する必要がある (バッチAPIがない可能性が高いため)
      let delCount = 0;
      for (const video of videos) {
        // 高評価取り消しAPI
        const delRes = await fetch(`https://www.youtube.com/youtubei/v1/like/removelike?key=${apiKey}`, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            context: context,
            target: { videoId: video.id }
          })
        });

        if (delRes.ok) {
          delCount++;
        } else {
          log(`⚠️ 失敗(${video.id}): Status ${delRes.status}`);
        }

        // 進捗ログを間引いて表示
        if (delCount % 10 === 0) {
          log(`削除済み: ${delCount} / ${videos.length}`);
        }
        
        // 短いウェイト (API制限対策)
        await new Promise(r => setTimeout(r, 150)); 
      }
      
      log("🎉 削除完了。ページをリロードしてください。");
      alert("処理完了！リロードすると過去の動画が表示されます。");
    } else {
      alert("バックアップ完了！");
    }

  } catch (e) {
    log(`❌ Error: ${e.message}`);
    console.error(e);
  }
const btnRestore = document.getElementById('btn-yt-restore');
const fileInput = document.getElementById('file-restore');

btnRestore.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus("⚠️ JSONファイルを選択してください。"); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url.includes("youtube.com/")) { setStatus("⚠️ YouTubeのページを開いた状態で実行してください。"); return; }

  try {
    setStatus("📂 ファイル読み込み中...");
    const text = await file.text();
    const data = JSON.parse(text);
    
    // JSONの形式チェック (videos配列があるか)
    let videos = [];
    if (Array.isArray(data.videos)) {
      videos = data.videos; // このツールの形式
    } else if (Array.isArray(data.youtubeHistory)) {
      videos = data.youtubeHistory; // 履歴エクスポートの形式
    } else {
      throw new Error("対応していないJSON形式です。\n'videos' または 'youtubeHistory' 配列が見つかりません。");
    }

    if (videos.length === 0) throw new Error("動画リストが空です。");

    const confirmMsg = `ファイルから ${videos.length} 件の動画が見つかりました。\n\nこれら全てに「高評価」を押し直しますか？\n(※件数が多いと時間がかかります)`;
    if (!confirm(confirmMsg)) return;

    setStatus(`📺 ${videos.length}件の再評価プロセスを開始します...`);

    // 動画IDリストだけを抽出して渡す
    const videoIds = videos.map(v => {
      // URLからIDを抜くか、オブジェクトのIDプロパティを使う
      if (v.id) return v.id;
      if (v.url) {
        try { return new URL(v.url).searchParams.get('v'); } catch(e){ return null; }
      }
      return null;
    }).filter(id => id !== null);

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runYoutubeReliker,
      args: [videoIds],
      world: 'MAIN'
    }, () => {
      if (chrome.runtime.lastError) setStatus("エラー: " + chrome.runtime.lastError.message);
    });

  } catch (e) {
    setStatus("❌ エラー: " + e.message);
    console.error(e);
  }
});

// --- YouTubeページ内で動く「再・高評価」スクリプト ---
async function runYoutubeReliker(videoIds) {
  const log = (msg) => {
    console.log(`[Reliker] ${msg}`);
    let box = document.getElementById('yt-man-log');
    if (!box) {
      box = document.createElement('div');
      box.id = 'yt-man-log';
      box.style.cssText = "position:fixed; bottom:10px; right:10px; width:340px; height:250px; background:rgba(0,50,0,0.95); color:#afa; padding:10px; font-size:11px; overflow-y:scroll; z-index:9999; border-radius:6px; font-family:monospace; line-height:1.4;";
      document.body.appendChild(box);
    }
    box.innerText += msg + "\n";
    box.scrollTop = box.scrollHeight;
  };

  log(`開始: ${videoIds.length} 件の動画を再評価します。`);

  try {
    if (!window.ytcfg || !window.ytcfg.data_) throw new Error("YouTubeデータが見つかりません。");
    const cfg = window.ytcfg.data_;
    const apiKey = cfg.INNERTUBE_API_KEY;
    const context = cfg.INNERTUBE_CONTEXT;
    const authUser = cfg.SESSION_INDEX || '0';

    // 認証ヘッダー作成
    const getHeaders = async () => {
      const match = document.cookie.match(/SAPISID=([^;]+)/);
      if (!match) throw new Error("SAPISID Cookieが見つかりません。");
      const sapisid = decodeURIComponent(match[1]);
      const origin = window.location.origin;
      const now = Math.floor(Date.now() / 1000);
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${now} ${sapisid} ${origin}`));
      const hash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
      return {
        "Authorization": `SAPISIDHASH ${now}_${hash}`,
        "X-Origin": origin,
        "X-Goog-AuthUser": authUser,
        "Content-Type": "application/json"
      };
    };

    const headers = await getHeaders();
    let successCount = 0;
    let failCount = 0;

    // ループ処理
    for (let i = 0; i < videoIds.length; i++) {
      const vid = videoIds[i];
      
      // like API を叩く
      const res = await fetch(`https://www.youtube.com/youtubei/v1/like/like?key=${apiKey}`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          context: context,
          target: { videoId: vid }
        })
      });

      if (res.ok) {
        successCount++;
        // ログは少し間引く（全件出すと重いので）
        if (i % 5 === 0) log(`[${i+1}/${videoIds.length}] OK: ${vid}`);
      } else {
        failCount++;
        log(`[${i+1}/${videoIds.length}] 失敗(${res.status}): ${vid}`);
      }

      // スパム判定回避のためのウェイト (重要)
      // 削除よりもリスクが高いため、少し長めに待つ (500ms - 800ms)
      await new Promise(r => setTimeout(r, 600)); 
    }

    log(`🎉 全処理完了！`);
    log(`成功: ${successCount}件, 失敗: ${failCount}件`);
    alert(`完了しました！\n${successCount} 件の動画を再び「高く評価」しました。`);

  } catch (e) {
    log(`❌ Error: ${e.message}`);
    console.error(e);
  }
}
}