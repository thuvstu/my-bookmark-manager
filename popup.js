// =========================================================================
//  共通ユーティリティ
// =========================================================================

const $ = id => document.getElementById(id);
const statusDiv = $('status');
function setStatus(msg) { statusDiv.textContent = msg; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const blobUrls = new Set();
function createBlob(content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  blobUrls.add(url);
  return url;
}
function revokeBlobs() { blobUrls.forEach(u => URL.revokeObjectURL(u)); blobUrls.clear(); }

function showProg(id, pct, text) {
  const c = $(id);
  if (c) c.classList.add('visible');
  const f = $(`${id}-fill`), t = $(`${id}-text`);
  if (f) f.style.width = `${Math.min(100, pct)}%`;
  if (t) t.textContent = text || '';
}
function hideProg(id) { const c = $(id); if (c) c.classList.remove('visible'); }

function escapeHtml(s) { return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') : ''; }
function escapeCsv(s) { if (s == null) return ''; const t = String(s); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }

async function notify(title, message) {
  const s = await chrome.storage.local.get('cfg-notify');
  if (s['cfg-notify'] === false) return;
  try { await chrome.runtime.sendMessage({ type: 'notify', title, message }); } catch { }
}

async function updateStat(key, inc = 1) {
  const s = await chrome.storage.local.get('stats');
  const st = s.stats || {};
  st[key] = (st[key] || 0) + inc;
  st.lastRun = Date.now();
  await chrome.storage.local.set({ stats: st });
}

async function pushHistory(entry) {
  const s = await chrome.storage.local.get('history');
  const h = s.history || [];
  h.unshift({ ...entry, at: Date.now() });
  if (h.length > 50) h.length = 50;
  await chrome.storage.local.set({ history: h });
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// =========================================================================
//  設定
// =========================================================================

const SETTING_IDS = [
  'chk-bm', 'chk-rl', 'chk-hs', 'chk-lw-hs', 'chk-csv-hs', 'chk-save-as',
  'chk-dry-run', 'chk-diff', 'hs-limit', 'enc-password',
  'yt-chk-json', 'yt-chk-lw', 'yt-chk-csv', 'yt-chk-pl', 'yt-chk-del',
  'yt-chk-sub-json', 'yt-chk-sub-csv',
  'yt-delay', 'yt-batch', 'yt-parallel', 'yt-scroll-max',
  'yt-restore-delay', 'yt-retry', 'yt-restore-dedup', 'yt-restore-resume',
  'cfg-notify', 'cfg-schedule', 'cfg-schedule-freq',
  'cfg-url-enabled', 'cfg-url-log', 'cfg-url-exclude',
  'link-check-parallel', 'restore-folder-name'
];

async function loadSettings() {
  try {
    const s = await chrome.storage.local.get(SETTING_IDS);
    SETTING_IDS.forEach(id => {
      const el = $(id);
      if (!el || s[id] === undefined) return;
      el.type === 'checkbox' ? (el.checked = s[id]) : (el.value = s[id]);
    });
  } catch (e) { console.warn(e); }
}

async function saveSettings() {
  const s = {};
  SETTING_IDS.forEach(id => {
    const el = $(id);
    if (!el) return;
    s[id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  await chrome.storage.local.set(s);
}

document.querySelectorAll('input, select, textarea').forEach(el => {
  el.addEventListener('change', saveSettings);
});

// =========================================================================
//  初期化
// =========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupTabs();
  setupAccordions();
  await updateBrowserCounts();
  await updateLastBackup();
  setupBrowserTab();
  setupYtTab();
  setupYtRestoreTab();
  setupTabManager();
  setupAnalysisTab();
  setupSettingsTab();
  await checkFailedIds();
});

function setupTabs() {
  const tabs = ['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5', 'tab-6'];
  const views = ['view-1', 'view-2', 'view-3', 'view-4', 'view-5', 'view-6'];
  tabs.forEach((tid, i) => {
    $(tid).addEventListener('click', () => {
      tabs.forEach(t => $(t).classList.remove('active'));
      views.forEach(v => $(v).classList.remove('active'));
      $(tid).classList.add('active');
      $(views[i]).classList.add('active');
      if (i === 3) loadTabList();
      if (i === 4) loadSessions();
    });
  });
}

function setupAccordions() {
  ['acc-b1', 'acc-y1', 'acc-y2'].forEach(id => {
    const h = $(id);
    if (!h) return;
    h.addEventListener('click', () => {
      $(`${id}-content`).classList.toggle('open');
      $(`${id}-icon`).classList.toggle('open');
    });
  });
}

// =========================================================================
//  ブラウザデータ
// =========================================================================

async function updateBrowserCounts() {
  const bm = await new Promise(r => chrome.bookmarks.getTree(t => {
    let c = 0;
    const walk = n => { for (const i of n) { if (i.url) c++; if (i.children) walk(i.children); } };
    walk(t); r(c);
  }));
  $('c-bm').textContent = `${bm.toLocaleString()} 件`;

  if (chrome.readingList) {
    try { const rl = await chrome.readingList.query({}); $('c-rl').textContent = `${rl.length} 件`; }
    catch { $('c-rl').textContent = 'エラー'; }
  } else $('c-rl').textContent = '未対応';

  const hs = await new Promise(r => chrome.history.search({ text: '', maxResults: 1000 }, r));
  $('c-hs').textContent = hs.length >= 1000 ? '1000+' : `${hs.length} 件`;
}

async function updateLastBackup() {
  const { lastBackupAt } = await chrome.storage.local.get('lastBackupAt');
  if (!lastBackupAt) { $('last-backup').textContent = '未実行'; return; }
  const d = Date.now() - lastBackupAt;
  const days = Math.floor(d / 86400000);
  const hrs = Math.floor((d % 86400000) / 3600000);
  $('last-backup').textContent = days > 0 ? `${days}日前` : `${hrs}時間前`;
}

async function getAllBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const result = [];
  const walk = n => { for (const i of n) { if (i.url) result.push(i); if (i.children) walk(i.children); } };
  walk(tree);
  return result;
}

function createLwHtml(name, items) {
  let h = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n    <DT><H3>${escapeHtml(name)}</H3>\n    <DL><p>\n`;
  for (const i of items) h += `        <DT><A HREF="${escapeHtml(i.url)}">${escapeHtml(i.title || i.url)}</A>\n`;
  h += `    </DL><p>\n</DL><p>`;
  return createBlob(h, 'text/html');
}

function createCsv(items, headers) {
  const rows = [headers.join(',')];
  for (const i of items) rows.push(headers.map(h => escapeCsv(i[h])).join(','));
  return createBlob('\uFEFF' + rows.join('\n'), 'text/csv');
}

async function generateHtmlBackup(doBm, doRl) {
  let h = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n`;
  let bmC = 0, rlC = 0;
  if (doBm) {
    const tree = await chrome.bookmarks.getTree();
    const proc = n => {
      let o = '';
      if (n.url) { o += `    <DT><A HREF="${escapeHtml(n.url)}">${escapeHtml(n.title)}</A>\n`; bmC++; }
      else if (n.children) {
        o += `    <DT><H3>${escapeHtml(n.title)}</H3>\n    <DL><p>\n`;
        for (const c of n.children) o += proc(c);
        o += `    </DL><p>\n`;
      }
      return o;
    };
    if (tree[0]?.children) for (const c of tree[0].children) h += proc(c);
  }
  if (doRl && chrome.readingList) {
    try {
      const rl = await chrome.readingList.query({});
      if (rl.length > 0) {
        h += `    <DT><H3>Reading List</H3>\n    <DL><p>\n`;
        for (const i of rl) { h += `        <DT><A HREF="${escapeHtml(i.url)}">${escapeHtml(i.title)}</A>\n`; rlC++; }
        h += `    </DL><p>\n`;
      }
    } catch { }
  }
  h += `</DL><p>`;
  return { url: createBlob(h, 'text/html'), bmCount: bmC, rlCount: rlC };
}

async function generateHistoryBackup(limit) {
  const items = await new Promise(r => chrome.history.search({ text: '', startTime: 0, maxResults: limit }, r));
  const clean = items.map(i => ({
    title: i.title || i.url, url: i.url,
    visitCount: i.visitCount, lastVisit: new Date(i.lastVisitTime).toLocaleString()
  }));
  return { items: clean, count: clean.length };
}

function downloadFileAndWait(url, name, saveAs = true) {
  return new Promise((resolve, reject) => {
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    chrome.downloads.download({ url, filename: name.replace('.', `_${ts}.`), saveAs, conflictAction: 'uniquify' }, id => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!id) return reject(new Error('キャンセル'));
      const timeout = setTimeout(() => { chrome.downloads.onChanged.removeListener(c); reject(new Error('タイムアウト')); }, 120000);
      const c = d => {
        if (d.id !== id || !d.state) return;
        if (d.state.current === 'complete') { clearTimeout(timeout); chrome.downloads.onChanged.removeListener(c); resolve(); }
        else if (d.state.current === 'interrupted') { clearTimeout(timeout); chrome.downloads.onChanged.removeListener(c); reject(new Error('失敗')); }
      };
      chrome.downloads.onChanged.addListener(c);
    });
  });
}

// ═══ ブラウザタブセットアップ ═══
function setupBrowserTab() {
  async function runBrowser(backupOnly = false) {
    const doBm = $('chk-bm').checked, doRl = $('chk-rl').checked, doHs = $('chk-hs').checked;
    const doLwHs = $('chk-lw-hs').checked, doCsvHs = $('chk-csv-hs').checked;
    const saveAs = $('chk-save-as').checked, dryRun = $('chk-dry-run').checked;
    const diffMode = $('chk-diff').checked, hsLimit = parseInt($('hs-limit').value) || 100000;
    const password = $('enc-password').value || '';

    if (!doBm && !doRl && !doHs) { setStatus('対象なし'); return; }
    if (!backupOnly && dryRun) {
      alert(`【ドライラン】BM:${$('c-bm').textContent} RL:${$('c-rl').textContent} 履歴:${$('c-hs').textContent}`);
      setStatus('ドライラン完了'); return;
    }
    if (!backupOnly && !confirm('バックアップして削除します。よろしいですか？')) return;

    $('btn-browser-run').disabled = true;
    $('btn-browser-backup-only').disabled = true;
    const t0 = Date.now();

    try {
      const st = { bm: 0, rl: 0, hs: 0 };
      if (doBm || doRl) {
        setStatus('BM/RL保存中...');
        const { url, bmCount, rlCount } = await generateHtmlBackup(doBm, doRl);
        let dataUrl = url;
        if (password) {
          const raw = await fetch(url).then(r => r.blob()).then(b => b.text());
          const enc = await encryptText(raw, password);
          dataUrl = createBlob(enc, 'text/plain');
        }
        await downloadFileAndWait(dataUrl, `browser_backup${password ? '_encrypted' : ''}.html`, saveAs);
        st.bm = bmCount; st.rl = rlCount;
      }

      if (doHs) {
        setStatus('履歴保存中...');
        const { items, count } = await generateHistoryBackup(hsLimit);
        st.hs = count;
        let saveItems = items;
        if (diffMode) {
          const { prevSnapshot } = await chrome.storage.local.get('prevSnapshot');
          const prevSet = new Set(prevSnapshot?.history || []);
          saveItems = items.filter(i => !prevSet.has(i.url));
        }
        const jsonStr = JSON.stringify({ exportedAt: new Date().toLocaleString(), mode: diffMode ? 'diff' : 'full', count: saveItems.length, items: saveItems }, null, 2);
        let finalUrl = createBlob(jsonStr, 'application/json');
        if (password) { finalUrl = createBlob(await encryptText(jsonStr, password), 'text/plain'); }
        await downloadFileAndWait(finalUrl, `history_backup${password ? '_enc' : ''}.json`, saveAs);

        if (doLwHs) await downloadFileAndWait(createLwHtml(`History ${new Date().toISOString().slice(0, 10)}`, saveItems), 'history_lw.html', saveAs);
        if (doCsvHs) await downloadFileAndWait(createCsv(saveItems, ['title', 'url', 'visitCount', 'lastVisit']), 'history.csv', saveAs);

        const { prevSnapshot } = await chrome.storage.local.get('prevSnapshot');
        await chrome.storage.local.set({ prevSnapshot: { history: items.map(i => i.url), bookmarks: [], savedAt: Date.now() } });
      }

      if (!backupOnly) {
        setStatus('削除中...');
        if (doBm) {
          const tree = await chrome.bookmarks.getTree();
          if (tree[0]?.children) for (const sys of tree[0].children) if (sys.children) for (const it of sys.children) await new Promise(r => chrome.bookmarks.removeTree(it.id, () => r()));
        }
        if (doRl && chrome.readingList) {
          const rl = await chrome.readingList.query({});
          for (let i = 0; i < rl.length; i += 10) {
            const batch = rl.slice(i, i + 10);
            await Promise.allSettled(batch.map(it => chrome.readingList.remove({ url: it.url })));
            await sleep(100);
          }
        }
        if (doHs) await new Promise(r => chrome.history.deleteAll(r));
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      setStatus(`完了 (${elapsed}秒) BM:${st.bm} RL:${st.rl} HS:${st.hs}`);
      await updateStat('bmTotal', st.bm);
      await updateStat('hsTotal', st.hs);
      await updateStat('runs', 1);
      await pushHistory({ type: backupOnly ? 'backup-only' : 'backup-delete', stats: st });
      await chrome.storage.local.set({ lastBackupAt: Date.now() });
      await updateBrowserCounts();
      await updateLastBackup();
      revokeBlobs();
      notify('ブラウザ掃除完了', `BM:${st.bm} RL:${st.rl} HS:${st.hs}`);
    } catch (e) { setStatus(`エラー: ${e.message}`); console.error(e); }
    finally { $('btn-browser-run').disabled = false; $('btn-browser-backup-only').disabled = false; }
  }

  $('btn-browser-run').addEventListener('click', () => runBrowser(false));
  $('btn-browser-backup-only').addEventListener('click', () => runBrowser(true));

  // ブックマーク復元
  $('btn-restore-bm').addEventListener('click', async () => {
    const file = $('file-restore-bm').files[0];
    if (!file) { setStatus('ファイルを選択'); return; }
    try {
      setStatus('解析中...');
      const text = await file.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      const folderName = $('restore-folder-name').value.trim();

      // ルートフォルダ作成
      let parentId = '1'; // ブックマークバー
      if (folderName) {
        const created = await chrome.bookmarks.create({ parentId: '1', title: folderName });
        parentId = created.id;
      }

      let count = 0;
      const dlElements = doc.querySelectorAll('dt');

      async function processDl(parentEl, destId) {
        for (const dt of parentEl.children) {
          if (dt.tagName !== 'DT') continue;
          const h3 = dt.querySelector(':scope > h3');
          const a = dt.querySelector(':scope > a');
          const subDl = dt.querySelector(':scope > dl');

          if (h3 && subDl) {
            const folder = await chrome.bookmarks.create({ parentId: destId, title: h3.textContent });
            await processDl(subDl, folder.id);
          } else if (a && a.href) {
            await chrome.bookmarks.create({ parentId: destId, title: a.textContent, url: a.href });
            count++;
          }
        }
      }

      const rootDl = doc.querySelector('dl');
      if (rootDl) await processDl(rootDl, parentId);

      setStatus(`復元完了: ${count}件`);
      await updateBrowserCounts();
      notify('ブックマーク復元完了', `${count}件復元`);
    } catch (e) { setStatus(`復元エラー: ${e.message}`); }
  });
}

// ═══ 暗号化ユーティリティ ═══
async function encryptText(text, password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  const result = { salt: Array.from(salt), iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
  return btoa(JSON.stringify(result));
}

// =========================================================================
//  YouTube退避
// =========================================================================

function setupYtTab() {
  $('btn-yt-run').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('youtube.com/playlist?list=LL')) { setStatus('YouTube「高評価した動画」を開いてください'); return; }

    const opts = {
      isJson: $('yt-chk-json').checked, isLw: $('yt-chk-lw').checked,
      isCsv: $('yt-chk-csv').checked, isPl: $('yt-chk-pl').checked,
      isDelete: $('yt-chk-del').checked,
      delay: parseInt($('yt-delay').value) || 400,
      batchSize: parseInt($('yt-batch').value) || 50,
      parallel: parseInt($('yt-parallel').value) || 1,
      scrollMax: parseInt($('yt-scroll-max').value) || 300
    };

    if (!opts.isJson && !opts.isLw && !opts.isCsv && !opts.isPl && !opts.isDelete) { setStatus('1つ以上選択'); return; }
    if (opts.isDelete && !confirm('高評価を取り消します。よろしいですか？')) return;

    await chrome.storage.local.set({ ytPaused: false, ytCancelled: false });
    $('yt-controls').classList.add('visible');
    setStatus('YouTubeスクリプト実行中...');

    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: runYoutubeManager, args: [opts], world: 'MAIN' }, async () => {
      if (chrome.runtime.lastError) setStatus('エラー: ' + chrome.runtime.lastError.message);
      else { await updateStat('ytBackup', 1); await pushHistory({ type: 'yt-backup' }); }
      $('yt-controls').classList.remove('visible');
    });
  });

  // 一時停止・中止
  $('btn-yt-pause').addEventListener('click', async () => {
    const { ytPaused } = await chrome.storage.local.get('ytPaused');
    await chrome.storage.local.set({ ytPaused: !ytPaused });
    $('btn-yt-pause').textContent = ytPaused ? '⏸ 一時停止' : '▶ 再開';
  });
  $('btn-yt-cancel').addEventListener('click', async () => {
    if (confirm('中止しますか？')) await chrome.storage.local.set({ ytCancelled: true });
  });

  // 購読チャンネル退避
  $('btn-yt-sub-export').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('youtube.com/feed/channels')) {
      setStatus('YouTube「チャンネル登録」ページを開いてください');
      return;
    }
    setStatus('購読チャンネル取得中...');
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runChannelExport,
      args: [{ isJson: $('yt-chk-sub-json').checked, isCsv: $('yt-chk-sub-csv').checked }],
      world: 'MAIN'
    }, async () => {
      if (chrome.runtime.lastError) setStatus('エラー: ' + chrome.runtime.lastError.message);
      else { await updateStat('subExport', 1); setStatus('購読チャンネル退避完了'); }
    });
  });
}

// ═══ YouTube復元 ═══
let restoreVideoIds = [];

async function checkFailedIds() {
  const { failedIds } = await chrome.storage.local.get('failedIds');
  const info = $('failed-info'), btn = $('btn-retry-failed');
  if (failedIds?.length > 0) {
    info.textContent = `前回失敗: ${failedIds.length}件`;
    info.style.display = 'block';
    btn.style.display = 'block';
  } else { info.style.display = 'none'; btn.style.display = 'none'; }
}

function setupYtRestoreTab() {
  $('btn-yt-restore').addEventListener('click', async () => {
    const file = $('yt-file-restore').files[0];
    if (!file) { setStatus('JSONを選択'); return; }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('youtube.com/')) { setStatus('YouTubeを開いてください'); return; }

    try {
      setStatus('解析中...');
      const data = JSON.parse(await file.text());
      let videos = data.videos || data.youtubeHistory || data.items || [];
      let ids = videos.map(v => v.id || (v.url ? new URL(v.url).searchParams.get('v') : null)).filter(Boolean);
      if ($('yt-restore-dedup').checked) ids = [...new Set(ids)];

      if ($('yt-restore-resume').checked) {
        const { processedIds } = await chrome.storage.local.get('processedIds');
        if (processedIds?.length > 0) {
          const ps = new Set(processedIds);
          const before = ids.length;
          ids = ids.filter(id => !ps.has(id));
          if (before !== ids.length) setStatus(`処理済${before - ids.length}件スキップ`);
        }
      }

      if (!ids.length) throw new Error('対象なし');
      if (!confirm(`${ids.length}件を再評価しますか？`)) return;
      restoreVideoIds = ids;

      await chrome.storage.local.set({ ytPaused: false, ytCancelled: false });
      $('yt-controls').classList.add('visible');
      setStatus(`${ids.length}件 再評価開始...`);

      const delay = parseInt($('yt-restore-delay').value) || 400;
      const maxRetries = parseInt($('yt-retry').value) || 3;
      chrome.scripting.executeScript({ target: { tabId: tab.id }, func: runYoutubeReliker, args: [ids, delay, maxRetries], world: 'MAIN' }, async () => {
        await updateStat('ytRestore', 1);
        await pushHistory({ type: 'yt-restore', count: ids.length });
        $('yt-controls').classList.remove('visible');
        setTimeout(checkFailedIds, 2000);
      });
    } catch (e) { setStatus('エラー: ' + e.message); }
  });

  $('btn-retry-failed').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('youtube.com/')) { setStatus('YouTubeを開いてください'); return; }
    const { failedIds } = await chrome.storage.local.get('failedIds');
    if (!failedIds?.length) { setStatus('失敗IDなし'); return; }
    if (!confirm(`${failedIds.length}件を再試行？`)) return;

    await chrome.storage.local.set({ ytPaused: false, ytCancelled: false });
    $('yt-controls').classList.add('visible');
    const delay = parseInt($('yt-restore-delay').value) || 400;
    const maxRetries = parseInt($('yt-retry').value) || 3;
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: runYoutubeReliker, args: [failedIds, delay, maxRetries], world: 'MAIN' }, async () => {
      await updateStat('ytRestore', 1);
      $('yt-controls').classList.remove('visible');
      setTimeout(checkFailedIds, 2000);
    });
  });
}

// =========================================================================
//  タブ管理
// =========================================================================

async function loadTabList() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  $('tab-count').textContent = tabs.length;
  const list = $('tab-list');
  list.innerHTML = '';

  const domains = new Set();
  tabs.forEach(t => {
    try { domains.add(new URL(t.url).hostname); } catch { }
  });

  // ドメインセレクト更新
  const sel = $('tab-domain-select');
  sel.innerHTML = '';
  for (const d of domains) {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    sel.appendChild(opt);
  }

  tabs.forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'tab-item';
    div.innerHTML = `
      <input type="checkbox" data-tab-id="${t.id}" checked>
      <span class="tab-item-title" title="${escapeHtml(t.url)}" data-tab-id="${t.id}">${escapeHtml(t.title || t.url)}</span>
      <span class="tab-item-close" data-tab-id="${t.id}">✕</span>
    `;
    list.appendChild(div);
  });

  // クリックイベント
  list.querySelectorAll('.tab-item-title').forEach(el => {
    el.addEventListener('click', () => chrome.tabs.update(parseInt(el.dataset.tabId), { active: true }));
  });
  list.querySelectorAll('.tab-item-close').forEach(el => {
    el.addEventListener('click', async () => {
      await chrome.tabs.remove(parseInt(el.dataset.tabId));
      loadTabList();
    });
  });
}

function setupTabManager() {
  $('btn-tab-select-all').addEventListener('click', () => {
    $('tab-list').querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = true);
  });
  $('btn-tab-deselect').addEventListener('click', () => {
    $('tab-list').querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false);
  });

  $('btn-tab-close-selected').addEventListener('click', async () => {
    const ids = [...$('tab-list').querySelectorAll('input:checked')].map(c => parseInt(c.dataset.tabId));
    if (!ids.length) { setStatus('選択なし'); return; }
    if (!confirm(`${ids.length}個のタブを閉じますか？`)) return;
    await chrome.tabs.remove(ids);
    loadTabList();
  });

  $('btn-tab-close-dup').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const seen = new Map();
    const toClose = [];
    for (const t of tabs) {
      if (seen.has(t.url)) toClose.push(t.id);
      else seen.set(t.url, t.id);
    }
    if (!toClose.length) { setStatus('重複なし'); return; }
    if (!confirm(`${toClose.length}個の重複タブを閉じますか？`)) return;
    await chrome.tabs.remove(toClose);
    loadTabList();
  });

  $('btn-tab-close-other').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const active = tabs.find(t => t.active);
    const others = tabs.filter(t => !t.active).map(t => t.id);
    if (!others.length) { setStatus('他にタブなし'); return; }
    await chrome.tabs.remove(others);
    loadTabList();
  });

  $('btn-tab-close-left').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const activeIdx = tabs.findIndex(t => t.active);
    const toClose = tabs.slice(0, activeIdx).map(t => t.id);
    if (!toClose.length) { setStatus('左にタブなし'); return; }
    await chrome.tabs.remove(toClose);
    loadTabList();
  });

  $('btn-tab-close-domain').addEventListener('click', async () => {
    const domain = $('tab-domain-select').value;
    if (!domain) return;
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const toClose = tabs.filter(t => { try { return new URL(t.url).hostname === domain; } catch { return false; } }).map(t => t.id);
    if (!toClose.length) return;
    if (!confirm(`${domain}の${toClose.length}タブを閉じますか？`)) return;
    await chrome.tabs.remove(toClose);
    loadTabList();
  });

  // セッション保存
  $('btn-tab-save-session').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    await saveSession(`全タブ (${tabs.length}個)`, tabs.map(t => ({ title: t.title, url: t.url })));
    loadSessions();
  });

  $('btn-tab-save-sel').addEventListener('click', async () => {
    const ids = [...$('tab-list').querySelectorAll('input:checked')].map(c => parseInt(c.dataset.tabId));
    if (!ids.length) { setStatus('選択なし'); return; }
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const selected = tabs.filter(t => ids.includes(t.id));
    await saveSession(`選択 (${selected.length}個)`, selected.map(t => ({ title: t.title, url: t.url })));
    loadSessions();
  });

  loadSessions();
}

async function saveSession(name, tabData) {
  const { tabSessions } = await chrome.storage.local.get('tabSessions');
  const sessions = tabSessions || [];
  sessions.unshift({ name, savedAt: Date.now(), tabs: tabData });
  if (sessions.length > 30) sessions.length = 30;
  await chrome.storage.local.set({ tabSessions: sessions });
}

async function loadSessions() {
  const { tabSessions } = await chrome.storage.local.get('tabSessions');
  const sessions = tabSessions || [];
  const list = $('session-list');
  if (!sessions.length) { list.innerHTML = '<p class="note">保存済セッションなし</p>'; return; }

  list.innerHTML = '';
  sessions.forEach((s, idx) => {
    const div = document.createElement('div');
    div.className = 'session-item';
    const ago = formatAgo(s.savedAt);
    div.innerHTML = `
      <div class="session-info">
        <div class="session-name">${escapeHtml(s.name)}</div>
        <div class="session-meta">${s.tabs.length}タブ · ${ago}</div>
      </div>
      <div class="session-actions">
        <button class="btn-blue" data-idx="${idx}">復元</button>
        <button class="btn-red" data-idx="${idx}">削除</button>
      </div>
    `;
    list.appendChild(div);
  });

  list.querySelectorAll('.btn-blue').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx);
      const s = sessions[idx];
      for (const t of s.tabs) {
        if (t.url && (t.url.startsWith('http://') || t.url.startsWith('https://'))) {
          await chrome.tabs.create({ url: t.url, active: false });
        }
      }
      setStatus(`${s.tabs.length}タブ復元`);
    });
  });

  list.querySelectorAll('.btn-red').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx);
      sessions.splice(idx, 1);
      await chrome.storage.local.set({ tabSessions: sessions });
      loadSessions();
    });
  });
}

function formatAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

// =========================================================================
//  分析
// =========================================================================

function setupAnalysisTab() {
  let deadLinks = [];
  let duplicates = [];

  $('btn-analyze').addEventListener('click', async () => {
    setStatus('分析中...');
    const bookmarks = await getAllBookmarks();
    const urls = bookmarks.map(b => b.url).filter(Boolean);
    const urlCounts = {};
    urls.forEach(u => { urlCounts[u] = (urlCounts[u] || 0) + 1; });

    duplicates = Object.entries(urlCounts).filter(([, c]) => c > 1).map(([url, c]) => ({ url, count: c }));
    const domains = {};
    bookmarks.forEach(b => {
      try { const h = new URL(b.url).hostname; domains[h] = (domains[h] || 0) + 1; } catch { }
    });
    const folders = new Set();
    const walk = (n) => { for (const i of n) { if (!i.url && i.title) folders.add(i.title); if (i.children) walk(i.children); } };
    const tree = await chrome.bookmarks.getTree();
    walk(tree);

    $('analysis-cards').style.display = 'grid';
    $('an-total').textContent = bookmarks.length;
    $('an-dup').textContent = duplicates.length;
    $('an-domains').textContent = Object.keys(domains).length;
    $('an-folders').textContent = folders.size;

    // トップドメイン
    const topDomains = Object.entries(domains).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxCount = topDomains[0]?.[1] || 1;
    const colors = ['#0d6efd', '#198754', '#6f42c1', '#0d9488', '#f59e0b', '#dc3545', '#0ea5e9', '#8b5cf6', '#ec4899', '#64748b'];
    let barsHtml = '<h2>トップドメイン</h2>';
    topDomains.forEach(([domain, count], i) => {
      const pct = (count / maxCount) * 100;
      barsHtml += `<div class="analysis-bar">
        <span class="analysis-bar-name">${escapeHtml(domain)}</span>
        <div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:${pct}%;background:${colors[i % colors.length]};"></div></div>
        <span class="analysis-bar-count">${count}</span>
      </div>`;
    });
    $('analysis-top-domains').innerHTML = barsHtml;
    setStatus(`分析完了: ${bookmarks.length}件, 重複${duplicates.length}件`);
  });

  // リンクチェック
  $('btn-link-check').addEventListener('click', async () => {
    const bookmarks = await getAllBookmarks();
    const links = bookmarks.filter(b => b.url && (b.url.startsWith('http://') || b.url.startsWith('https://')));
    const parallel = parseInt($('link-check-parallel').value) || 5;
    deadLinks = [];

    showProg('prog-link', 0, `0/${links.length}`);
    setStatus(`リンクチェック開始 (${links.length}件)...`);

    for (let i = 0; i < links.length; i += parallel) {
      const batch = links.slice(i, i + parallel);
      const results = await Promise.allSettled(batch.map(async b => {
        try {
          const ctrl = new AbortController();
          const timeout = setTimeout(() => ctrl.abort(), 8000);
          const res = await fetch(b.url, { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal, redirect: 'follow' });
          clearTimeout(timeout);
          // no-corsではOKでもbodyは読めない。ok=falseでもCORSエラーの場合もある
          if (res.type === 'opaque') return null; // おそらくOK
          if (!res.ok) return b;
        } catch {
          return b;
        }
        return null;
      }));

      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value) deadLinks.push(r.value);
      });

      const checked = Math.min(i + parallel, links.length);
      showProg('prog-link', (checked / links.length) * 100, `${checked}/${links.length} (死リンク: ${deadLinks.length})`);
    }

    const resEl = $('link-results');
    resEl.style.display = 'block';
    resEl.innerHTML = deadLinks.length === 0
      ? '<p class="info-note">死リンクは見つかりませんでした！</p>'
      : deadLinks.map(b => `<div class="result-item"><span>❌</span><span>${escapeHtml(b.title || b.url)}</span></div>`).join('');

    $('btn-link-delete-dead').style.display = deadLinks.length > 0 ? 'block' : 'none';
    hideProg('prog-link');
    setStatus(`リンクチェック完了: ${deadLinks.length}件の死リンク`);
  });

  $('btn-link-delete-dead').addEventListener('click', async () => {
    if (!deadLinks.length) return;
    if (!confirm(`${deadLinks.length}件の死リンクを削除しますか？`)) return;
    let deleted = 0;
    for (const b of deadLinks) {
      if (b.id) {
        try { await chrome.bookmarks.remove(b.id); deleted++; } catch { }
      }
    }
    setStatus(`${deleted}件削除完了`);
    await updateBrowserCounts();
    deadLinks = [];
    $('link-results').innerHTML = '';
    $('btn-link-delete-dead').style.display = 'none';
  });

  // 重複除去
  $('btn-dedup').addEventListener('click', async () => {
    setStatus('重複検出中...');
    const bookmarks = await getAllBookmarks();
    const urlMap = new Map();
    bookmarks.forEach(b => {
      if (!b.url) return;
      if (urlMap.has(b.url)) urlMap.get(b.url).push(b);
      else urlMap.set(b.url, [b]);
    });

    duplicates = [];
    urlMap.forEach((items, url) => {
      if (items.length > 1) {
        // 最初の1つを残し、残りを「削除候補」とする
        for (let i = 1; i < items.length; i++) {
          duplicates.push(items[i]);
        }
      }
    });

    const resEl = $('dedup-results');
    resEl.style.display = 'block';
    resEl.innerHTML = duplicates.length === 0
      ? '<p class="info-note">重複はありませんでした！</p>'
      : duplicates.slice(0, 50).map(b => `<div class="result-item"><span>🔄</span><span>${escapeHtml(b.title || b.url)}</span></div>`).join('') + (duplicates.length > 50 ? `<p class="note">...他${duplicates.length - 50}件</p>` : '');

    $('btn-dedup-remove').style.display = duplicates.length > 0 ? 'block' : 'none';
    setStatus(`重複検出: ${duplicates.length}件`);
  });

  $('btn-dedup-remove').addEventListener('click', async () => {
    if (!duplicates.length) return;
    if (!confirm(`${duplicates.length}件の重複を削除しますか？`)) return;
    let deleted = 0;
    for (const b of duplicates) {
      if (b.id) {
        try { await chrome.bookmarks.remove(b.id); deleted++; } catch { }
      }
    }
    setStatus(`${deleted}件の重複を削除`);
    await updateBrowserCounts();
    duplicates = [];
    $('dedup-results').innerHTML = '';
    $('btn-dedup-remove').style.display = 'none';
  });
}

// =========================================================================
//  設定タブ
// =========================================================================

function setupSettingsTab() {
  const { urlStatsToday } = chrome.storage.local.get ? {} : {};
  chrome.storage.local.get('urlStatsToday').then(s => {
    const today = new Date().toISOString().slice(0, 10);
    $('url-today').textContent = (s.urlStatsToday?.date === today ? s.urlStatsToday.count : 0).toLocaleString();
  });

  $('cfg-schedule')?.addEventListener('change', async (e) => {
    await chrome.runtime.sendMessage({ type: 'setSchedule', enabled: e.target.checked, intervalMinutes: parseInt($('cfg-schedule-freq').value) || 10080 });
  });

  $('btn-export-settings').addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    downloadBlob(new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' }), 'settings.json');
    setStatus('設定エクスポート完了');
  });

  $('btn-import-settings').addEventListener('click', () => $('import-settings-file').click());
  $('import-settings-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !confirm('設定を上書きしますか？')) return;
    try {
      await chrome.storage.local.set(JSON.parse(await file.text()));
      await loadSettings();
      setStatus('設定インポート完了');
    } catch (e) { setStatus('インポート失敗: ' + e.message); }
  });

  $('btn-stats-reset').addEventListener('click', async () => {
    if (!confirm('全データをリセットしますか？\n(バックアップファイルは残ります)')) return;
    await chrome.storage.local.clear();
    await loadSettings();
    setStatus('全データリセット完了');
  });
}

// =========================================================================
//  YouTube スクリプト（ページ内注入）
// =========================================================================

async function runYoutubeManager(opts) {
  const { isJson, isLw, isCsv, isPl, isDelete, delay = 400, batchSize = 50, parallel = 1, scrollMax = 300 } = opts;

  const mkPanel = (title, color) => {
    let box = document.getElementById('yt-ext-log');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'yt-ext-log';
    box.style.cssText = `position:fixed;bottom:16px;right:16px;width:400px;max-height:400px;background:rgba(10,10,20,0.97);color:${color};padding:12px;font-size:12px;overflow-y:auto;z-index:99999;border-radius:10px;font-family:monospace;line-height:1.5;box-shadow:0 4px 20px rgba(0,0,0,0.5);border:1px solid ${color};`;
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid ${color};">
        <span style="font-weight:bold;">${title}</span>
        <span>
          <button id="yt-ext-pause" style="background:#f59e0b;border:none;color:white;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">⏸</button>
          <button id="yt-ext-cancel" style="background:#dc3545;border:none;color:white;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">⏹</button>
          <button id="yt-ext-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:14px;">✕</button>
        </span>
      </div>
      <div style="width:100%;height:6px;background:#222;border-radius:3px;overflow:hidden;"><div id="yt-ext-progress" style="height:100%;width:0%;background:linear-gradient(90deg,${color},#00bfff);transition:width 0.3s;"></div></div>
      <div id="yt-ext-progress-text" style="font-size:10px;color:#aaa;text-align:center;margin:4px 0 8px;"></div>
      <div id="yt-ext-logarea" style="max-height:250px;overflow-y:auto;"></div>
    `;
    document.body.appendChild(box);
    document.getElementById('yt-ext-close').onclick = () => box.remove();
    document.getElementById('yt-ext-pause').onclick = () => {
      window.__ytPaused = !window.__ytPaused;
      document.getElementById('yt-ext-pause').textContent = window.__ytPaused ? '▶' : '⏸';
    };
    document.getElementById('yt-ext-cancel').onclick = () => { if (confirm('中止?')) window.__ytCancelled = true; };
    return box;
  };

  const log = (msg, c) => {
    console.log('[YT]', msg);
    const area = document.getElementById('yt-ext-logarea');
    if (!area) return;
    const d = document.createElement('div');
    d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (c) d.style.color = c;
    area.appendChild(d);
    area.scrollTop = area.scrollHeight;
    while (area.children.length > 200) area.removeChild(area.firstChild);
  };
  const setProg = (c, t, l) => { const b = document.getElementById('yt-ext-progress'); const x = document.getElementById('yt-ext-progress-text'); if (b) b.style.width = `${(c / t) * 100}%`; if (x) x.textContent = l || `${c}/${t}`; };
  const escH = s => s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') : '';
  const wait = async () => { while (window.__ytPaused && !window.__ytCancelled) await new Promise(r => setTimeout(r, 500)); };
  const check = () => { if (window.__ytCancelled) throw new Error('中止'); };

  const fetchRetry = async (url, opts, mr = 3) => {
    for (let a = 0; a <= mr; a++) {
      try {
        const r = await fetch(url, opts);
        if (r.status === 429) { const w = parseInt(r.headers.get('Retry-After') || '5', 10) * 1000; log(`⏳ Rate limit ${w / 1000}s`, '#ff9800'); await new Promise(x => setTimeout(x, w)); continue; }
        if (r.status >= 500 && a < mr) { const w = 1000 * Math.pow(2, a); log(`⏳ ${r.status} retry ${w}ms`, '#ff9800'); await new Promise(x => setTimeout(x, w)); continue; }
        return r;
      } catch (e) { if (a >= mr) throw e; const w = 1000 * Math.pow(2, a); await new Promise(x => setTimeout(x, w)); }
    }
    throw new Error('retry limit');
  };

  try {
    window.__ytPaused = false; window.__ytCancelled = false;
    mkPanel('📺 YT Backup', '#00ff88');
    log('🚀 開始', '#00ff88');
    if (!window.ytcfg?.data_) throw new Error('ytcfg なし。リロード必要');
    const cfg = window.ytcfg.data_;
    const apiKey = cfg.INNERTUBE_API_KEY || null;
    const ctx = cfg.INNERTUBE_CONTEXT;
    const au = cfg.SESSION_INDEX || '0';
    const cv = cfg.INNERTUBE_CLIENT_VERSION || '2.0';
    const mkUrl = p => `https://www.youtube.com/youtubei/v1/${p}${apiKey ? '?key=' + apiKey : ''}${apiKey ? '&' : ''}prettyPrint=false`;

    let hdr = null, hts = 0;
    const gH = async (f = false) => {
      const now = Math.floor(Date.now() / 1000);
      if (!f && hdr && (now - hts) < 30) return hdr;
      const m = document.cookie.match(/SAPISID=([^;]+)/);
      if (!m) throw new Error('SAPISID なし');
      const sap = decodeURIComponent(m[1]);
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${now} ${sap} ${location.origin}`));
      const h = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      hdr = { 'Authorization': `SAPISIDHASH ${now}_${h}`, 'X-Origin': location.origin, 'X-Goog-AuthUser': au, 'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': cv, 'Content-Type': 'application/json' };
      hts = now; return hdr;
    };

    log('🔍 スクロール収集');
    const vm = new Map(); let nc = 0;
    for (let i = 0; i < scrollMax; i++) {
      await wait(); check();
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 800));
      if (document.querySelector('ytd-continuation-item-renderer, tp-yt-paper-spinner-lite')) await new Promise(r => setTimeout(r, 1500));
      const links = document.querySelectorAll('ytd-playlist-video-renderer a#video-title[href*="watch"],ytd-grid-video-renderer a#video-title[href*="watch"],a#video-title[href*="watch?v="]');
      const ps = vm.size;
      for (const a of links) { try { const u = new URL(a.href, location.origin); const v = u.searchParams.get('v'); if (v && !vm.has(v)) vm.set(v, { id: v, title: (a.title || a.textContent || '').trim() || 'Unknown', url: `https://www.youtube.com/watch?v=${v}` }); } catch { } }
      setProg(vm.size, 5000, `収集: ${vm.size}件`);
      if (vm.size === ps) { nc++; if (nc >= 5) { log('✅ 終端'); break; } } else nc = 0;
      if (vm.size >= 5000) { log('ℹ️ 5000上限'); break; }
    }
    const videos = Array.from(vm.values());
    if (!videos.length) throw new Error('動画なし');
    log(`📊 ${videos.length}件`, '#00bfff');
    const headers = await gH();
    const ds = new Date().toISOString().slice(0, 10);
    let ec = 0;

    if (isJson) {
      log('📄 JSON作成...');
      downloadBlob(new Blob([JSON.stringify({ exportedAt: new Date().toLocaleString(), count: videos.length, videos }, null, 2)], { type: 'application/json' }), `liked_${ds}.json`);
      log('✅ JSON DL', '#00ff88'); await new Promise(r => setTimeout(r, 500));
    }
    if (isLw) {
      log('📄 LW HTML作成...');
      let h = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n    <DT><H3>Liked ${ds}</H3>\n    <DL><p>\n`;
      videos.forEach(v => { h += `        <DT><A HREF="${escH(v.url)}">${escH(v.title)}</A>\n`; });
      h += `    </DL><p>\n</DL><p>`;
      downloadBlob(new Blob([h], { type: 'text/html' }), `liked_lw_${ds}.html`);
      log('✅ LW DL', '#00ff88'); await new Promise(r => setTimeout(r, 500));
    }
    if (isCsv) {
      log('📄 CSV作成...');
      let csv = 'id,title,url\n';
      videos.forEach(v => { csv += `${v.id},"${v.title.replace(/"/g, '""')}","${v.url}"\n`; });
      downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv' }), `liked_${ds}.csv`);
      log('✅ CSV DL', '#00ff88'); await new Promise(r => setTimeout(r, 500));
    }
    if (isPl) {
      log(`📺 PL作成...`);
      const cr = await fetchRetry(mkUrl('playlist/create'), { method: 'POST', headers, body: JSON.stringify({ context: ctx, title: `Liked ${ds}`, privacyStatus: 'PRIVATE' }) });
      const cj = await cr.json();
      if (!cj.playlistId) throw new Error('PL作成失敗');
      const plId = cj.playlistId;
      log(`✅ PL ${plId}`, '#00ff88');
      const chunks = []; for (let i = 0; i < videos.length; i += batchSize) chunks.push(videos.slice(i, i + batchSize));
      let done = 0;
      for (let i = 0; i < chunks.length; i += parallel) {
        const batch = chunks.slice(i, i + parallel);
        await Promise.all(batch.map(async (c) => {
          await wait(); check();
          try {
            const r = await fetchRetry(mkUrl('browse/edit_playlist'), { method: 'POST', headers, body: JSON.stringify({ context: ctx, playlistId: plId, actions: c.map(v => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v.id })) }) });
            if (!r.ok) { log(`⚠️ Chunk fail`, '#ff5555'); ec++; }
          } catch { ec++; }
        }));
        done += batch.reduce((s, c) => s + c.length, 0);
        setProg(done, videos.length, `PL: ${done}/${videos.length}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    if (isDelete) {
      if (ec > 0 && !confirm(`${ec}件エラーあり。削除続行?`)) { log('⛔ 中止', '#ff5555'); return; }
      log('🗑️ 取り消し開始', '#ff9800');
      let ok = 0, ng = 0; const failed = [];
      for (let i = 0; i < videos.length; i++) {
        await wait(); check();
        if (i % 50 === 0 && i > 0) try { await gH(true); } catch { }
        try { const r = await fetchRetry(mkUrl('like/removelike'), { method: 'POST', headers, body: JSON.stringify({ context: ctx, target: { videoId: videos[i].id } }) }); if (r.ok) ok++; else { ng++; failed.push(videos[i].id); } } catch { ng++; failed.push(videos[i].id); }
        if ((i + 1) % 20 === 0 || i === videos.length - 1) setProg(i + 1, videos.length, `削除: ${i + 1}/${videos.length} ✓${ok}`);
        await new Promise(r => setTimeout(r, delay));
      }
      if (failed.length) chrome.storage?.local?.set({ failedIds: failed }).catch(() => { });
      log(`🎉 完了 ✓${ok} ✗${ng}`, '#00ff88');
      alert(`完了!\n成功:${ok} 失敗:${ng}\nリロードで隠れた動画が出現`);
    } else log('🎉 完了', '#00ff88');
  } catch (e) { log(`❌ ${e.message}`, '#ff5555'); console.error(e); }
}

async function runYoutubeReliker(ids, delay = 400, maxRetries = 3) {
  const mkPanel = () => {
    let box = document.getElementById('yt-ext-log');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'yt-ext-log';
    box.style.cssText = 'position:fixed;bottom:16px;right:16px;width:400px;max-height:400px;background:rgba(0,30,10,0.97);color:#aaff88;padding:12px;font-size:12px;overflow-y:auto;z-index:99999;border-radius:10px;font-family:monospace;line-height:1.5;box-shadow:0 4px 20px rgba(0,0,0,0.5);border:1px solid #aaff88;';
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #aaff88;">
        <span style="font-weight:bold;">❤️ YT Restore</span>
        <span>
          <button id="yt-ext-pause" style="background:#f59e0b;border:none;color:white;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">⏸</button>
          <button id="yt-ext-cancel" style="background:#dc3545;border:none;color:white;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">⏹</button>
          <button id="yt-ext-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:14px;">✕</button>
        </span>
      </div>
      <div style="width:100%;height:6px;background:#222;border-radius:3px;overflow:hidden;"><div id="yt-ext-progress" style="height:100%;width:0%;background:linear-gradient(90deg,#aaff88,#88ffcc);transition:width 0.3s;"></div></div>
      <div id="yt-ext-progress-text" style="font-size:10px;color:#aaa;text-align:center;margin:4px 0 8px;"></div>
      <div id="yt-ext-logarea" style="max-height:250px;overflow-y:auto;"></div>
    `;
    document.body.appendChild(box);
    document.getElementById('yt-ext-close').onclick = () => box.remove();
    document.getElementById('yt-ext-pause').onclick = () => { window.__ytPaused = !window.__ytPaused; document.getElementById('yt-ext-pause').textContent = window.__ytPaused ? '▶' : '⏸'; };
    document.getElementById('yt-ext-cancel').onclick = () => { if (confirm('中止?')) window.__ytCancelled = true; };
    return box;
  };

  const log = (m, c) => { console.log('[Reliker]', m); mkPanel(); const a = document.getElementById('yt-ext-logarea'); if (!a) return; const d = document.createElement('div'); d.textContent = `[${new Date().toLocaleTimeString()}] ${m}`; if (c) d.style.color = c; a.appendChild(d); a.scrollTop = a.scrollHeight; while (a.children.length > 200) a.removeChild(a.firstChild); };
  const setProg = (c, t, l) => { const b = document.getElementById('yt-ext-progress'); const x = document.getElementById('yt-ext-progress-text'); if (b) b.style.width = `${(c / t) * 100}%`; if (x) x.textContent = l || `${c}/${t}`; };
  const wait = async () => { while (window.__ytPaused && !window.__ytCancelled) await new Promise(r => setTimeout(r, 500)); };
  const check = () => { if (window.__ytCancelled) throw new Error('中止'); };

  const fetchRetry = async (url, opts, retries = maxRetries) => {
    for (let a = 0; a <= retries; a++) { try { const r = await fetch(url, opts); if (r.status === 429) { const w = parseInt(r.headers.get('Retry-After') || '10', 10) * 1000; log(`⏳ 429 ${w / 1000}s`, '#ff9800'); await new Promise(x => setTimeout(x, w)); continue; } if (r.status >= 500 && a < retries) { const w = 1000 * Math.pow(2, a); await new Promise(x => setTimeout(x, w)); continue; } return r; } catch (e) { if (a >= retries) throw e; await new Promise(x => setTimeout(x, 1000 * Math.pow(2, a))); } }
    throw new Error('retry limit');
  };

  try {
    window.__ytPaused = false; window.__ytCancelled = false;
    mkPanel(); log(`🚀 復元 ${ids.length}件`, '#aaff88');
    if (!window.ytcfg?.data_) throw new Error('ytcfg なし');
    const cfg = window.ytcfg.data_;
    const apiKey = cfg.INNERTUBE_API_KEY || null;
    const ctx = cfg.INNERTUBE_CONTEXT;
    const au = cfg.SESSION_INDEX || '0';
    const cv = cfg.INNERTUBE_CLIENT_VERSION || '2.0';
    const mkUrl = p => `https://www.youtube.com/youtubei/v1/${p}${apiKey ? '?key=' + apiKey : ''}${apiKey ? '&' : ''}prettyPrint=false`;

    let hdr = null, hts = 0;
    const gH = async (f = false) => { const now = Math.floor(Date.now() / 1000); if (!f && hdr && (now - hts) < 30) return hdr; const m = document.cookie.match(/SAPISID=([^;]+)/); if (!m) throw new Error('SAPISID なし'); const sap = decodeURIComponent(m[1]); const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${now} ${sap} ${location.origin}`)); const h = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''); hdr = { 'Authorization': `SAPISIDHASH ${now}_${h}`, 'X-Origin': location.origin, 'X-Goog-AuthUser': au, 'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': cv, 'Content-Type': 'application/json' }; hts = now; return hdr; };

    let headers = await gH(); let ok = 0, ng = 0; const failed = [], processed = [];
    for (let i = 0; i < ids.length; i++) {
      await wait(); check();
      if (i % 30 === 0 && i > 0) { headers = await gH(true); log('🔑 header refresh'); }
      try { const r = await fetchRetry(mkUrl('like/like'), { method: 'POST', headers, body: JSON.stringify({ context: ctx, target: { videoId: ids[i] } }) }); if (r.ok) { ok++; processed.push(ids[i]); } else { ng++; failed.push(ids[i]); if (ng <= 10) log(`⚠️ ${r.status}: ${ids[i]}`, '#ff5555'); } } catch (e) { ng++; failed.push(ids[i]); log(`⚠️ ${ids[i]}: ${e.message}`, '#ff5555'); }
      if ((i + 1) % 10 === 0 || i === ids.length - 1) setProg(i + 1, ids.length, `${i + 1}/${ids.length} ✓${ok} ✗${ng}`);
      await new Promise(r => setTimeout(r, delay));
    }
    log(`🎉 完了 ✓${ok} ✗${ng}`, '#aaff88');
    if (failed.length) chrome.storage?.local?.set({ failedIds: failed }).catch(() => { });
    else chrome.storage?.local?.remove('failedIds').catch(() => { });
    chrome.storage?.local?.set({ processedIds: processed }).catch(() => { });
    alert(`完了!\n成功:${ok}\n失敗:${ng}`);
  } catch (e) { log(`❌ ${e.message}`, '#ff5555'); console.error(e); }
}

// ═══ YouTube 購読チャンネル退避 ═══
async function runChannelExport(opts) {
  const { isJson, isCsv } = opts;
  const log = (m, c) => console.log('[Channel]', m);

  try {
    // スクロールしてチャンネルを収集
    const channelMap = new Map();
    let nc = 0;
    for (let i = 0; i < 100; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 1000));
      if (document.querySelector('ytd-continuation-item-renderer')) await new Promise(r => setTimeout(r, 1500));

      const items = document.querySelectorAll('ytd-grid-channel-renderer, ytd-channel-renderer');
      const ps = channelMap.size;
      for (const item of items) {
        const link = item.querySelector('a#main-link, a#avatar-link, a[href*="/channel/"], a[href*="/@"]');
        const titleEl = item.querySelector('#channel-title, #text.ytd-channel-name, .style-scope.ytd-channel-name');
        if (link) {
          const url = link.href;
          const match = url.match(/\/(channel|@)\/([^/?]+)/);
          if (match && !channelMap.has(match[2])) {
            channelMap.set(match[2], {
              id: match[2],
              name: titleEl?.textContent?.trim() || match[2],
              url: url.split('?')[0]
            });
          }
        }
      }

      if (channelMap.size === ps) { nc++; if (nc >= 3) break; } else nc = 0;
    }

    const channels = Array.from(channelMap.values());
    log(`📊 ${channels.length}チャンネル取得`);

    const ds = new Date().toISOString().slice(0, 10);

    if (isJson) {
      const data = JSON.stringify({ exportedAt: new Date().toLocaleString(), count: channels.length, channels }, null, 2);
      downloadBlob(new Blob([data], { type: 'application/json' }), `subscriptions_${ds}.json`);
    }

    if (isCsv) {
      let csv = 'id,name,url\n';
      channels.forEach(c => { csv += `${c.id},"${c.name.replace(/"/g, '""')}","${c.url}"\n`; });
      downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv' }), `subscriptions_${ds}.csv`);
    }

    log(`✅ 退避完了 ${channels.length}チャンネル`);
  } catch (e) {
    log(`❌ ${e.message}`);
  }
}