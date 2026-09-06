/* ═══════════════════════════════════════════════════
   ユーティリティ
   ═══════════════════════════════════════════════════ */

function el(id) { return document.getElementById(id); }
function setStatus(msg) { el('status').textContent = msg; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(s) {
  return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/>/g, '&gt;') : '';
}
function escapeCsv(s) {
  if (s == null) return '';
  const t = String(s);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const blobUrls = new Set();
function createBlob(content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  blobUrls.add(url);
  return url;
}
function revokeBlobs() {
  blobUrls.forEach(u => URL.revokeObjectURL(u));
  blobUrls.clear();
}

function showProg(id, pct, text) {
  const c = el(id); if (c) c.classList.add('visible');
  const f = el(id + '-fill'); if (f) f.style.width = Math.min(100, pct) + '%';
  const t = el(id + '-text'); if (t) t.textContent = text || '';
}
function hideProg(id) {
  const c = el(id); if (c) c.classList.remove('visible');
}

async function notify(title, message) {
  try {
    const s = await chrome.storage.local.get('cfg-notify');
    if (s['cfg-notify'] === false) return;
    await chrome.runtime.sendMessage({ type: 'notify', title, message });
  } catch (e) { console.warn('notify err:', e); }
}

async function updateStat(key, inc) {
  const s = await chrome.storage.local.get('stats');
  const st = s.stats || {};
  st[key] = (st[key] || 0) + (inc || 1);
  st.lastRun = Date.now();
  await chrome.storage.local.set({ stats: st });
}

async function pushHist(entry) {
  const s = await chrome.storage.local.get('runHistory');
  const h = s.runHistory || [];
  h.unshift({ ...entry, at: Date.now() });
  if (h.length > 50) h.length = 50;
  await chrome.storage.local.set({ runHistory: h });
}

/* ═══════════════════════════════════════════════════
   設定の保存/読み込み
   ═══════════════════════════════════════════════════ */

const SETTINGS = [
  'chk-bm', 'chk-rl', 'chk-hs', 'chk-lw-hs', 'chk-csv-hs', 'chk-save-as', 'hs-limit',
  'yt-chk-json', 'yt-chk-lw', 'yt-chk-pl', 'yt-chk-del',
  'yt-delay', 'yt-batch', 'yt-scroll-max',
  'yt-restore-delay', 'yt-retry',
  'cfg-notify', 'cfg-schedule', 'cfg-schedule-freq',
  'cfg-url-enabled', 'cfg-url-log', 'cfg-url-exclude'
];

async function loadSettings() {
  try {
    const s = await chrome.storage.local.get(SETTINGS);
    SETTINGS.forEach(id => {
      const e = el(id);
      if (!e || s[id] === undefined) return;
      if (e.type === 'checkbox') e.checked = s[id];
      else e.value = s[id];
    });
  } catch (e) { console.warn('loadSettings:', e); }
}

async function saveSettings() {
  const s = {};
  SETTINGS.forEach(id => {
    const e = el(id);
    if (!e) return;
    s[id] = e.type === 'checkbox' ? e.checked : e.value;
  });
  try { await chrome.storage.local.set(s); } catch (e) { console.warn('saveSettings:', e); }
}

/* ═══════════════════════════════════════════════════
   初期化
   ═══════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();

  // タブ切替
  const tabIds = ['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5'];
  const viewIds = ['view-1', 'view-2', 'view-3', 'view-4', 'view-5'];
  tabIds.forEach((tid, i) => {
    el(tid).addEventListener('click', async () => {
      tabIds.forEach(t => el(t).classList.remove('active'));
      viewIds.forEach(v => el(v).classList.remove('active'));
      el(tid).classList.add('active');
      el(viewIds[i]).classList.add('active');
      if (i === 3) renderStats();
    });
  });

  // アコーディオン
  ['acc-b1', 'acc-y1', 'acc-y2'].forEach(id => {
    const h = el(id);
    if (!h) return;
    h.addEventListener('click', () => {
      el(id + '-content').classList.toggle('open');
      el(id + '-icon').classList.toggle('open');
    });
  });

  // 自動保存
  document.querySelectorAll('input, select, textarea').forEach(e => {
    e.addEventListener('change', saveSettings);
  });

  // データカウント更新
  await updateCounts();
  await updateLastBackup();

  // 失敗ID確認
  checkFailed();

  // ── ボタンイベント登録 ──
  el('btn-browser-run').addEventListener('click', () => runBrowser(false));
  el('btn-browser-backup-only').addEventListener('click', () => runBrowser(true));
  el('btn-yt-run').addEventListener('click', ytRun);
  el('btn-yt-restore').addEventListener('click', ytRestore);
  el('btn-retry-failed').addEventListener('click', ytRetryFailed);
  el('btn-stats-reset').addEventListener('click', resetStats);

  // ── スイートヘッダー ──
  el('btn-open-editor').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    window.close();
  });

  el('btn-quick-backup').addEventListener('click', async () => {
    setStatus('⚡ クイックバックアップを実行中...');
    try {
      await chrome.runtime.sendMessage({ type: 'quick-backup' });
      setStatus('✅ クイックバックアップを開始しました（ダウンロードを確認）');
      await updateCounts();
      await updateLastBackup();
    } catch (err) {
      setStatus('エラー: ' + err.message);
    }
  });

  // 設定タブ
  el('cfg-schedule').addEventListener('change', async (e) => {
    const freq = parseInt(el('cfg-schedule-freq').value) || 10080;
    try {
      await chrome.runtime.sendMessage({ type: 'setSchedule', enabled: e.target.checked, intervalMinutes: freq });
    } catch (err) { console.warn(err); }
  });
  el('btn-export-settings').addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' }));
    a.download = 'ext_settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    setStatus('設定エクスポート完了');
  });
  el('btn-import-settings').addEventListener('click', () => el('import-settings-file').click());
  el('import-settings-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('設定を上書きしますか？')) return;
    try {
      const data = JSON.parse(await file.text());
      await chrome.storage.local.set(data);
      await loadSettings();
      setStatus('設定インポート完了');
    } catch (err) { setStatus('インポート失敗: ' + err.message); }
  });

  // URLクリーナー統計
  try {
    const s = await chrome.storage.local.get('urlStatsToday');
    const today = new Date().toISOString().slice(0, 10);
    el('url-today').textContent = (s.urlStatsToday?.date === today ? s.urlStatsToday.count : 0).toLocaleString();
  } catch (e) { }
});

/* ═══════════════════════════════════════════════════
   ブラウザデータ件数
   ═══════════════════════════════════════════════════ */

async function updateCounts() {
  // ブックマーク
  const bmCount = await new Promise(r => {
    chrome.bookmarks.getTree(tree => {
      let c = 0;
      const w = ns => { for (const n of ns) { if (n.url) c++; if (n.children) w(n.children); } };
      w(tree); r(c);
    });
  });
  el('c-bm').textContent = bmCount.toLocaleString() + ' 件';

  // RL
  if (chrome.readingList) {
    try {
      const rl = await chrome.readingList.query({});
      el('c-rl').textContent = rl.length + ' 件';
    } catch { el('c-rl').textContent = 'エラー'; }
  } else {
    el('c-rl').textContent = '未対応';
  }

  // 履歴
  const hs = await new Promise(r => chrome.history.search({ text: '', maxResults: 1000 }, r));
  el('c-hs').textContent = (hs.length >= 1000 ? '1000+' : hs.length) + ' 件';
}

async function updateLastBackup() {
  const { lastBackupAt } = await chrome.storage.local.get('lastBackupAt');
  if (!lastBackupAt) { el('last-backup').textContent = '未実行'; return; }
  const d = Date.now() - lastBackupAt;
  const days = Math.floor(d / 86400000);
  const hrs = Math.floor((d % 86400000) / 3600000);
  el('last-backup').textContent = days > 0 ? days + '日前' : hrs + '時間前';
}

/* ═══════════════════════════════════════════════════
   ブラウザ退避 & 削除
   ═══════════════════════════════════════════════════ */

function downloadFileAndWait(url, name, saveAs) {
  return new Promise((resolve, reject) => {
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    chrome.downloads.download(
      { url, filename: name.replace('.', '_' + ts + '.'), saveAs: !!saveAs, conflictAction: 'uniquify' },
      id => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!id) return reject(new Error('キャンセル'));
        const timeout = setTimeout(() => { chrome.downloads.onChanged.removeListener(cb); reject(new Error('タイムアウト')); }, 120000);
        const cb = d => {
          if (d.id !== id || !d.state) return;
          if (d.state.current === 'complete') { clearTimeout(timeout); chrome.downloads.onChanged.removeListener(cb); resolve(); }
          else if (d.state.current === 'interrupted') { clearTimeout(timeout); chrome.downloads.onChanged.removeListener(cb); reject(new Error('失敗')); }
        };
        chrome.downloads.onChanged.addListener(cb);
      }
    );
  });
}

async function runBrowser(backupOnly) {
  const doBm = el('chk-bm').checked;
  const doRl = el('chk-rl').checked;
  const doHs = el('chk-hs').checked;
  const doLwHs = el('chk-lw-hs').checked;
  const doCsvHs = el('chk-csv-hs').checked;
  const saveAs = el('chk-save-as').checked;
  const hsLimit = parseInt(el('hs-limit').value) || 100000;

  if (!doBm && !doRl && !doHs) { setStatus('対象が選択されていません'); return; }
  if (!backupOnly && !confirm('バックアップ後に削除します。よろしいですか？')) return;

  el('btn-browser-run').disabled = true;
  el('btn-browser-backup-only').disabled = true;
  const t0 = Date.now();
  const stats = { bm: 0, rl: 0, hs: 0 };

  try {
    // ── BM/RL バックアップ ──
    if (doBm || doRl) {
      showProg('prog-browser', 10, 'BM/RL保存中...');
      setStatus('ブックマーク/RL保存中...');

      let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';

      if (doBm) {
        const tree = await chrome.bookmarks.getTree();
        const proc = n => {
          let o = '';
          if (n.url) { o += '    <DT><A HREF="' + escapeHtml(n.url) + '">' + escapeHtml(n.title) + '</A>\n'; stats.bm++; }
          else if (n.children) {
            o += '    <DT><H3>' + escapeHtml(n.title) + '</H3>\n    <DL><p>\n';
            for (const c of n.children) o += proc(c);
            o += '    </DL><p>\n';
          }
          return o;
        };
        if (tree[0] && tree[0].children) {
          for (const c of tree[0].children) html += proc(c);
        }
      }

      if (doRl && chrome.readingList) {
        try {
          const rl = await chrome.readingList.query({});
          if (rl.length > 0) {
            html += '    <DT><H3>Reading List</H3>\n    <DL><p>\n';
            for (const i of rl) { html += '        <DT><A HREF="' + escapeHtml(i.url) + '">' + escapeHtml(i.title) + '</A>\n'; stats.rl++; }
            html += '    </DL><p>\n';
          }
        } catch (e) { console.warn('RL読み込みエラー:', e); }
      }

      html += '</DL><p>';
      const bmUrl = createBlob(html, 'text/html');
      await downloadFileAndWait(bmUrl, 'browser_backup.html', saveAs);
    }

    // ── 履歴バックアップ ──
    if (doHs) {
      showProg('prog-browser', 40, '履歴JSON作成中...');
      setStatus('履歴JSON作成中...');

      const items = await new Promise(r => chrome.history.search({ text: '', startTime: 0, maxResults: hsLimit }, r));
      const clean = items.map(i => ({
        title: i.title || i.url, url: i.url,
        visitCount: i.visitCount, lastVisit: new Date(i.lastVisitTime).toLocaleString()
      }));
      stats.hs = clean.length;

      const jsonStr = JSON.stringify({
        exportedAt: new Date().toLocaleString(), count: clean.length,
        youtubeHistory: clean.filter(i => i.url.includes('youtube.com/watch')),
        fullHistory: clean
      }, null, 2);
      const jsonUrl = createBlob(jsonStr, 'application/json');
      await downloadFileAndWait(jsonUrl, 'history_backup.json', saveAs);

      if (doLwHs) {
        showProg('prog-browser', 60, '履歴HTML作成中...');
        let lwHtml = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';
        lwHtml += '    <DT><H3>Browser History (' + new Date().toISOString().slice(0, 10) + ')</H3>\n    <DL><p>\n';
        for (const i of clean) lwHtml += '        <DT><A HREF="' + escapeHtml(i.url) + '">' + escapeHtml(i.title) + '</A>\n';
        lwHtml += '    </DL><p>\n</DL><p>';
        const lwUrl = createBlob(lwHtml, 'text/html');
        await downloadFileAndWait(lwUrl, 'history_linkwarden.html', saveAs);
      }

      if (doCsvHs) {
        showProg('prog-browser', 70, '履歴CSV作成中...');
        const rows = ['title,url,visitCount,lastVisit'];
        for (const i of clean) rows.push([escapeCsv(i.title), escapeCsv(i.url), i.visitCount, escapeCsv(i.lastVisit)].join(','));
        const csvUrl = createBlob('\uFEFF' + rows.join('\n'), 'text/csv');
        await downloadFileAndWait(csvUrl, 'history.csv', saveAs);
      }
    }

    // ── 削除 ──
    if (!backupOnly) {
      showProg('prog-browser', 80, '削除中...');
      setStatus('データを削除中...');

      if (doBm) {
        const tree = await chrome.bookmarks.getTree();
        if (tree[0] && tree[0].children) {
          for (const sys of tree[0].children) {
            if (sys.children) {
              for (const it of sys.children) {
                await new Promise(r => {
                  chrome.bookmarks.removeTree(it.id, () => {
                    if (chrome.runtime.lastError) console.warn('BM削除エラー:', chrome.runtime.lastError.message);
                    r();
                  });
                });
              }
            }
          }
        }
      }

      if (doRl && chrome.readingList) {
        const rlItems = await chrome.readingList.query({});
        for (let i = 0; i < rlItems.length; i += 10) {
          const batch = rlItems.slice(i, i + 10);
          await Promise.allSettled(batch.map(it => chrome.readingList.remove({ url: it.url })));
          await sleep(100);
        }
      }

      if (doHs) {
        await new Promise(r => chrome.history.deleteAll(r));
      }
    }

    // ── 完了 ──
    showProg('prog-browser', 100, '完了');
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    setStatus('完了 (' + elapsed + '秒) BM:' + stats.bm + ' RL:' + stats.rl + ' HS:' + stats.hs);

    await updateStat('bmTotal', stats.bm);
    await updateStat('hsTotal', stats.hs);
    await updateStat('runs');
    await pushHist({ type: backupOnly ? 'backup' : 'backup+delete', stats });
    await chrome.storage.local.set({ lastBackupAt: Date.now() });
    await updateCounts();
    await updateLastBackup();
    revokeBlobs();
    notify('ブラウザ掃除完了', 'BM:' + stats.bm + ' RL:' + stats.rl + ' HS:' + stats.hs);
    setTimeout(() => hideProg('prog-browser'), 3000);

  } catch (e) {
    setStatus('エラー: ' + e.message);
    console.error(e);
  } finally {
    el('btn-browser-run').disabled = false;
    el('btn-browser-backup-only').disabled = false;
  }
}

/* ═══════════════════════════════════════════════════
   YouTube 退避
   ═══════════════════════════════════════════════════ */

async function ytRun() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('youtube.com/playlist?list=LL')) {
    setStatus('YouTube「高く評価した動画」を開いてください');
    return;
  }

  const opts = {
    isJson: el('yt-chk-json').checked,
    isLw: el('yt-chk-lw').checked,
    isPl: el('yt-chk-pl').checked,
    isDelete: el('yt-chk-del').checked,
    delay: parseInt(el('yt-delay').value) || 400,
    batchSize: parseInt(el('yt-batch').value) || 50,
    scrollMax: parseInt(el('yt-scroll-max').value) || 300
  };

  if (!opts.isJson && !opts.isLw && !opts.isPl && !opts.isDelete) {
    setStatus('1つ以上選択してください');
    return;
  }
  if (opts.isDelete && !confirm('高評価を取り消します。よろしいですか？')) return;

  setStatus('YouTubeスクリプト実行中...\nページ上のパネルで進捗を確認できます');

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: ytManagerScript,
    args: [opts],
    world: 'MAIN'
  }, () => {
    if (chrome.runtime.lastError) {
      setStatus('エラー: ' + chrome.runtime.lastError.message);
    } else {
      updateStat('ytBackup');
      pushHist({ type: 'yt-backup' });
    }
  });
}

/* ═══════════════════════════════════════════════════
   YouTube 復元
   ═══════════════════════════════════════════════════ */

async function checkFailed() {
  const { failedIds } = await chrome.storage.local.get('failedIds');
  if (failedIds && failedIds.length > 0) {
    el('failed-info').textContent = '前回失敗: ' + failedIds.length + '件';
    el('failed-info').style.display = 'block';
    el('btn-retry-failed').style.display = 'block';
  } else {
    el('failed-info').style.display = 'none';
    el('btn-retry-failed').style.display = 'none';
  }
}

async function ytRestore() {
  const file = el('yt-file-restore').files[0];
  if (!file) { setStatus('JSONを選択してください'); return; }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('youtube.com/')) {
    setStatus('YouTubeのページを開いてください');
    return;
  }
  try {
    const data = JSON.parse(await file.text());
    const videos = data.videos || data.youtubeHistory || data.items || [];
    let ids = videos
      .map(v => v.id || (v.url ? new URL(v.url).searchParams.get('v') : null))
      .filter(Boolean);
    ids = [...new Set(ids)];
    if (!ids.length) throw new Error('動画IDなし');
    if (!confirm(ids.length + '件を再評価しますか？')) return;
    execRelike(ids, tab.id);
  } catch (e) { setStatus('エラー: ' + e.message); }
}

async function ytRetryFailed() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('youtube.com/')) { setStatus('YouTubeを開いてください'); return; }
  const { failedIds } = await chrome.storage.local.get('failedIds');
  if (!failedIds || !failedIds.length) { setStatus('失敗IDなし'); return; }
  if (!confirm(failedIds.length + '件を再試行？')) return;
  execRelike(failedIds, tab.id);
}

function execRelike(ids, tabId) {
  const delay = parseInt(el('yt-restore-delay').value) || 400;
  const maxRetries = parseInt(el('yt-retry').value) || 3;
  setStatus(ids.length + '件の再評価を開始...');

  chrome.scripting.executeScript({
    target: { tabId },
    func: ytRelikerScript,
    args: [ids, delay, maxRetries],
    world: 'MAIN'
  }, () => {
    if (chrome.runtime.lastError) setStatus('エラー: ' + chrome.runtime.lastError.message);
    else { updateStat('ytRestore'); pushHist({ type: 'yt-restore', count: ids.length }); }
    setTimeout(checkFailed, 3000);
  });
}

/* ═══════════════════════════════════════════════════
   統計タブ
   ═══════════════════════════════════════════════════ */

async function renderStats() {
  const { stats, runHistory } = await chrome.storage.local.get(['stats', 'runHistory']);
  const s = stats || {};
  el('stat-bm-total').textContent = (s.bmTotal || 0).toLocaleString();
  el('stat-hs-total').textContent = (s.hsTotal || 0).toLocaleString();
  el('stat-yt-backup').textContent = (s.ytBackup || 0).toLocaleString();
  el('stat-yt-restore').textContent = (s.ytRestore || 0).toLocaleString();
  el('stat-url-cleaned').textContent = (s.urlCleaned || 0).toLocaleString();
  el('stat-runs').textContent = (s.runs || 0).toLocaleString();

  const h = runHistory || [];
  const listEl = el('history-list');
  if (!h.length) { listEl.innerHTML = '<p class="note">なし</p>'; return; }
  listEl.innerHTML = h.slice(0, 10).map(e => {
    const time = new Date(e.at).toLocaleString();
    const info = e.stats ? 'BM:' + e.stats.bm + ' RL:' + e.stats.rl + ' HS:' + e.stats.hs :
      e.count ? e.count + '件' : '';
    return '<div style="padding:3px 0;border-bottom:1px solid var(--bdr);"><strong>' +
      escapeHtml(e.type) + '</strong><br><span style="font-size:10px;color:var(--sub);">' +
      time + ' ' + info + '</span></div>';
  }).join('');
}

async function resetStats() {
  if (!confirm('統計をリセットしますか？')) return;
  await chrome.storage.local.remove(['stats', 'runHistory']);
  renderStats();
  setStatus('統計リセット完了');
}

/* ═══════════════════════════════════════════════════
   YouTube注入スクリプト: 高評価バックアップ
   ═══════════════════════════════════════════════════ */

async function ytManagerScript(opts) {
  const { isJson, isLw, isPl, isDelete, delay, batchSize, scrollMax } = opts;

  // ─── UIパネル作成 ───
  const panel = (() => {
    let box = document.getElementById('yt-ext-log');
    if (box) { box.remove(); }
    box = document.createElement('div');
    box.id = 'yt-ext-log';
    box.style.cssText = 'position:fixed;bottom:16px;right:16px;width:400px;max-height:400px;background:rgba(10,10,20,.97);color:#0f8;padding:12px;font-size:12px;overflow-y:auto;z-index:99999;border-radius:10px;font-family:monospace;line-height:1.5;box-shadow:0 4px 20px rgba(0,0,0,.5);border:1px solid #0f8;';
    box.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><b>📺 YT Backup</b><button id="yt-ext-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:14px;">✕</button></div>' +
      '<div style="width:100%;height:6px;background:#222;border-radius:3px;overflow:hidden;"><div id="yt-ext-prog" style="height:100%;width:0;background:linear-gradient(90deg,#0f8,#0bf);transition:width .3s;"></div></div>' +
      '<div id="yt-ext-ptext" style="font-size:10px;color:#aaa;text-align:center;margin:4px 0 8px;"></div>' +
      '<div id="yt-ext-area" style="max-height:260px;overflow-y:auto;"></div>';
    document.body.appendChild(box);
    document.getElementById('yt-ext-close').onclick = () => box.remove();
    return box;
  })();

  function log(msg) {
    console.log('[YT]', msg);
    const area = document.getElementById('yt-ext-area');
    if (!area) return;
    const d = document.createElement('div');
    d.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    area.appendChild(d);
    area.scrollTop = area.scrollHeight;
    while (area.children.length > 200) area.removeChild(area.firstChild);
  }

  function prog(c, t, label) {
    const bar = document.getElementById('yt-ext-prog');
    const txt = document.getElementById('yt-ext-ptext');
    if (bar) bar.style.width = (c / t * 100) + '%';
    if (txt) txt.textContent = label || (c + '/' + t);
  }

  function esc(s) { return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') : ''; }

  async function fetchRetry(url, opts, maxR) {
    maxR = maxR || 3;
    for (let a = 0; a <= maxR; a++) {
      try {
        const r = await fetch(url, opts);
        if (r.status === 429) {
          const w = parseInt(r.headers.get('Retry-After') || '5') * 1000;
          log('⏳ Rate limit ' + (w / 1000) + 's');
          await new Promise(x => setTimeout(x, w));
          continue;
        }
        if (r.status >= 500 && a < maxR) {
          await new Promise(x => setTimeout(x, 1000 * Math.pow(2, a)));
          continue;
        }
        return r;
      } catch (e) {
        if (a >= maxR) throw e;
        await new Promise(x => setTimeout(x, 1000 * Math.pow(2, a)));
      }
    }
    throw new Error('リトライ上限');
  }

  try {
    log('🚀 開始');

    if (!window.ytcfg || !window.ytcfg.data_) throw new Error('ytcfgなし。リロードしてください');
    const cfg = window.ytcfg.data_;
    const apiKey = cfg.INNERTUBE_API_KEY || null;
    const ctx = cfg.INNERTUBE_CONTEXT;
    const au = cfg.SESSION_INDEX || '0';
    const cv = cfg.INNERTUBE_CLIENT_VERSION || '2.0';

    function mkUrl(path) {
      let u = 'https://www.youtube.com/youtubei/v1/' + path + '?prettyPrint=false';
      if (apiKey) u += '&key=' + apiKey;
      return u;
    }

    // 認証ヘッダー
    let hdrCache = null, hdrTs = 0;
    async function getHeaders(force) {
      const now = Math.floor(Date.now() / 1000);
      if (!force && hdrCache && (now - hdrTs) < 30) return hdrCache;
      const m = document.cookie.match(/SAPISID=([^;]+)/);
      if (!m) throw new Error('SAPISIDなし。ログインしてください');
      const sap = decodeURIComponent(m[1]);
      const origin = window.location.origin;
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(now + ' ' + sap + ' ' + origin));
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      hdrCache = {
        'Authorization': 'SAPISIDHASH ' + now + '_' + hash,
        'X-Origin': origin, 'X-Goog-AuthUser': au,
        'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': cv,
        'Content-Type': 'application/json'
      };
      hdrTs = now;
      return hdrCache;
    }

    // スクロール収集
    log('🔍 スクロール収集');
    const vm = new Map();
    let nc = 0;
    for (let i = 0; i < scrollMax; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 800));
      if (document.querySelector('ytd-continuation-item-renderer, tp-yt-paper-spinner-lite')) {
        await new Promise(r => setTimeout(r, 1500));
      }
      const links = document.querySelectorAll(
        'ytd-playlist-video-renderer a#video-title[href*="watch"],' +
        'a#video-title[href*="watch?v="]'
      );
      const ps = vm.size;
      for (const a of links) {
        try {
          const url = new URL(a.href, location.origin);
          const v = url.searchParams.get('v');
          if (v && !vm.has(v)) {
            vm.set(v, { id: v, title: (a.title || a.textContent || '').trim() || 'Unknown', url: 'https://www.youtube.com/watch?v=' + v });
          }
        } catch (e) { }
      }
      prog(vm.size, 5000, '収集: ' + vm.size + '件');
      if (vm.size === ps) { nc++; if (nc >= 5) { log('✅ 終端'); break; } } else nc = 0;
      if (vm.size >= 5000) { log('ℹ️ 5000上限'); break; }
    }

    const videos = Array.from(vm.values());
    if (!videos.length) throw new Error('動画なし');
    log('📊 ' + videos.length + '件取得');

    const headers = await getHeaders();
    const ds = new Date().toISOString().slice(0, 10);
    let errorCount = 0;

    // JSONダウンロード
    if (isJson) {
      log('📄 JSON作成...');
      const data = JSON.stringify({ exportedAt: new Date().toLocaleString(), count: videos.length, videos: videos }, null, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = 'liked_videos_' + ds + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      log('✅ JSON完了');
      await new Promise(r => setTimeout(r, 500));
    }

    // Linkwarden HTML
    if (isLw) {
      log('📄 LW HTML作成...');
      let h = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';
      h += '    <DT><H3>YouTube Liked Videos (' + ds + ')</H3>\n    <DL><p>\n';
      for (const v of videos) h += '        <DT><A HREF="' + esc(v.url) + '">' + esc(v.title) + '</A>\n';
      h += '    </DL><p>\n</DL><p>';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([h], { type: 'text/html' }));
      a.download = 'liked_videos_lw_' + ds + '.html';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      log('✅ LW HTML完了');
      await new Promise(r => setTimeout(r, 500));
    }

    // プレイリスト作成
    if (isPl) {
      const plTitle = 'Liked Backup ' + ds;
      log('📺 PL作成: ' + plTitle);
      const cr = await fetchRetry(mkUrl('playlist/create'), {
        method: 'POST', headers: headers,
        body: JSON.stringify({ context: ctx, title: plTitle, privacyStatus: 'PRIVATE' })
      });
      const cj = await cr.json();
      if (!cj.playlistId) throw new Error('PL作成失敗');
      const plId = cj.playlistId;
      log('✅ PL作成 ID:' + plId);

      for (let i = 0; i < videos.length; i += batchSize) {
        const chunk = videos.slice(i, i + batchSize);
        const actions = chunk.map(v => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v.id }));
        try {
          const r = await fetchRetry(mkUrl('browse/edit_playlist'), {
            method: 'POST', headers: headers,
            body: JSON.stringify({ context: ctx, playlistId: plId, actions: actions })
          });
          if (!r.ok) { log('⚠️ Chunk失敗'); errorCount++; }
        } catch (e) { log('⚠️ Chunkエラー: ' + e.message); errorCount++; }
        prog(Math.min(i + batchSize, videos.length), videos.length, 'PL: ' + Math.min(i + batchSize, videos.length) + '/' + videos.length);
        await new Promise(r => setTimeout(r, delay));
      }
      log('✅ PL追加完了');
    }

    // 高評価取り消し
    if (isDelete) {
      if (errorCount > 0 && !confirm(errorCount + '件のエラーがありました。削除を続行しますか？')) {
        log('⛔ 中止');
        return;
      }
      log('🗑️ 取り消し開始');
      let ok = 0, ng = 0;
      for (let i = 0; i < videos.length; i++) {
        if (i % 50 === 0 && i > 0) {
          try { await getHeaders(true); } catch (e) { log('⚠️ header更新失敗'); }
        }
        try {
          const r = await fetchRetry(mkUrl('like/removelike'), {
            method: 'POST', headers: headers,
            body: JSON.stringify({ context: ctx, target: { videoId: videos[i].id } })
          });
          if (r.ok) ok++; else ng++;
        } catch (e) { ng++; }
        if ((i + 1) % 20 === 0 || i === videos.length - 1) {
          prog(i + 1, videos.length, '削除: ' + (i + 1) + '/' + videos.length + ' ✓' + ok);
        }
        await new Promise(r => setTimeout(r, delay));
      }
      log('🎉 完了 成功=' + ok + ' 失敗=' + ng);
      alert('完了!\n成功: ' + ok + '\n失敗: ' + ng + '\nリロードで隠れた動画が出現');
    } else {
      log('🎉 全処理完了');
    }
  } catch (e) {
    log('❌ ' + e.message);
    console.error('[YT-Ext]', e);
  }
}

/* ═══════════════════════════════════════════════════
   YouTube注入スクリプト: 再評価
   ═══════════════════════════════════════════════════ */

async function ytRelikerScript(videoIds, delay, maxRetries) {
  // UIパネル
  let box = document.getElementById('yt-ext-log');
  if (box) box.remove();
  box = document.createElement('div');
  box.id = 'yt-ext-log';
  box.style.cssText = 'position:fixed;bottom:16px;right:16px;width:400px;max-height:400px;background:rgba(0,30,10,.97);color:#af8;padding:12px;font-size:12px;overflow-y:auto;z-index:99999;border-radius:10px;font-family:monospace;line-height:1.5;box-shadow:0 4px 20px rgba(0,0,0,.5);border:1px solid #af8;';
  box.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><b>❤️ YT Restore</b><button id="yt-ext-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:14px;">✕</button></div>' +
    '<div style="width:100%;height:6px;background:#222;border-radius:3px;overflow:hidden;"><div id="yt-ext-prog" style="height:100%;width:0;background:linear-gradient(90deg,#af8,#8fc);transition:width .3s;"></div></div>' +
    '<div id="yt-ext-ptext" style="font-size:10px;color:#aaa;text-align:center;margin:4px 0 8px;"></div>' +
    '<div id="yt-ext-area" style="max-height:260px;overflow-y:auto;"></div>';
  document.body.appendChild(box);
  document.getElementById('yt-ext-close').onclick = () => box.remove();

  function log(msg) {
    console.log('[Reliker]', msg);
    const area = document.getElementById('yt-ext-area');
    if (!area) return;
    const d = document.createElement('div');
    d.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    area.appendChild(d);
    area.scrollTop = area.scrollHeight;
    while (area.children.length > 200) area.removeChild(area.firstChild);
  }

  function prog(c, t, l) {
    const bar = document.getElementById('yt-ext-prog');
    const txt = document.getElementById('yt-ext-ptext');
    if (bar) bar.style.width = (c / t * 100) + '%';
    if (txt) txt.textContent = l || (c + '/' + t);
  }

  async function fetchRetry(url, opts, retries) {
    for (let a = 0; a <= retries; a++) {
      try {
        const r = await fetch(url, opts);
        if (r.status === 429) {
          const w = parseInt(r.headers.get('Retry-After') || '10') * 1000;
          log('⏳ 429 ' + (w / 1000) + 's');
          await new Promise(x => setTimeout(x, w));
          continue;
        }
        if (r.status >= 500 && a < retries) {
          await new Promise(x => setTimeout(x, 1000 * Math.pow(2, a)));
          continue;
        }
        return r;
      } catch (e) {
        if (a >= retries) throw e;
        await new Promise(x => setTimeout(x, 1000 * Math.pow(2, a)));
      }
    }
    throw new Error('リトライ上限');
  }

  try {
    log('🚀 復元 ' + videoIds.length + '件');
    if (!window.ytcfg || !window.ytcfg.data_) throw new Error('ytcfgなし');

    const cfg = window.ytcfg.data_;
    const apiKey = cfg.INNERTUBE_API_KEY || null;
    const ctx = cfg.INNERTUBE_CONTEXT;
    const au = cfg.SESSION_INDEX || '0';
    const cv = cfg.INNERTUBE_CLIENT_VERSION || '2.0';

    function mkUrl(path) {
      let u = 'https://www.youtube.com/youtubei/v1/' + path + '?prettyPrint=false';
      if (apiKey) u += '&key=' + apiKey;
      return u;
    }

    let hdr = null, hts = 0;
    async function gH(force) {
      const now = Math.floor(Date.now() / 1000);
      if (!force && hdr && (now - hts) < 30) return hdr;
      const m = document.cookie.match(/SAPISID=([^;]+)/);
      if (!m) throw new Error('SAPISIDなし');
      const sap = decodeURIComponent(m[1]);
      const origin = window.location.origin;
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(now + ' ' + sap + ' ' + origin));
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      hdr = {
        'Authorization': 'SAPISIDHASH ' + now + '_' + hash,
        'X-Origin': origin, 'X-Goog-AuthUser': au,
        'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': cv,
        'Content-Type': 'application/json'
      };
      hts = now;
      return hdr;
    }

    let headers = await gH();
    let ok = 0, ng = 0;
    const failed = [];
    const processed = [];

    for (let i = 0; i < videoIds.length; i++) {
      if (i % 30 === 0 && i > 0) {
        headers = await gH(true);
        log('🔑 header更新');
      }
      try {
        const r = await fetchRetry(mkUrl('like/like'), {
          method: 'POST', headers: headers,
          body: JSON.stringify({ context: ctx, target: { videoId: videoIds[i] } })
        }, maxRetries);
        if (r.ok) { ok++; processed.push(videoIds[i]); }
        else { ng++; failed.push(videoIds[i]); if (ng <= 10) log('⚠️ HTTP ' + r.status + ': ' + videoIds[i]); }
      } catch (e) {
        ng++; failed.push(videoIds[i]);
        log('⚠️ ' + videoIds[i] + ': ' + e.message);
      }
      if ((i + 1) % 10 === 0 || i === videoIds.length - 1) {
        prog(i + 1, videoIds.length, (i + 1) + '/' + videoIds.length + ' ✓' + ok + ' ✗' + ng);
      }
      await new Promise(r => setTimeout(r, delay));
    }

    log('🎉 完了 ✓' + ok + ' ✗' + ng);

    // 結果をストレージに保存
    try {
      if (failed.length) chrome.storage.local.set({ failedIds: failed });
      else chrome.storage.local.remove('failedIds');
      chrome.storage.local.set({ processedIds: processed });
    } catch (e) { }

    alert('完了!\n成功: ' + ok + '\n失敗: ' + ng);
  } catch (e) {
    log('❌ ' + e.message);
    console.error('[Reliker]', e);
  }
}