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
   Reading List helpers
   chrome.readingList API: query / addEntry / updateEntry / removeEntry
   (旧実装が呼んでいた chrome.readingList.remove は存在しない)
   ═══════════════════════════════════════════════════ */

function rlAvailable() {
  return !!(chrome.readingList && typeof chrome.readingList.query === 'function'
    && typeof chrome.readingList.addEntry === 'function'
    && typeof chrome.readingList.removeEntry === 'function');
}

function rlErrorMessage(prefix, err) {
  const msg = err?.message || String(err || '不明なエラー');
  console.warn(prefix, err);
  return `${prefix}: ${msg}`;
}

// Promise / callback 両対応で lastError を吸い上げる
function rlCall(method, arg) {
  return new Promise((resolve, reject) => {
    const fn = chrome.readingList?.[method];
    if (typeof fn !== 'function') {
      reject(new Error(`chrome.readingList.${method} が利用できません（Chrome 120+ / Reading List 有効を確認）`));
      return;
    }
    try {
      const ret = fn.call(chrome.readingList, arg, result => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
      // Promise API の場合だけ resolve させる（ callback 版は二重 resolve しない）
      if (ret && typeof ret.then === 'function') {
        ret.then(resolve, reject);
      }
    } catch (e) {
      reject(e);
    }
  });
}

function rlQuery(info = {}) { return rlCall('query', info); }
function rlAdd(entry) { return rlCall('addEntry', entry); }
function rlUpdate(info) { return rlCall('updateEntry', info); }
function rlRemove(url) { return rlCall('removeEntry', { url }); }

async function getActiveHttpTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  if (!/^https?:/i.test(url)) throw new Error('http/https のページで実行してください');
  return { title: tab.title || url, url };
}

/* ═══════════════════════════════════════════════════
   設定の保存/読み込み & キャッシュ一括ロード
   ═══════════════════════════════════════════════════ */

const SETTINGS = [
  'chk-bm', 'chk-rl', 'chk-hs', 'chk-lw-hs', 'chk-csv-hs', 'chk-save-as', 'hs-limit',
  'cfg-notify', 'cfg-schedule', 'cfg-schedule-freq',
  'cfg-url-enabled', 'cfg-url-log', 'cfg-url-exclude'
];

const ALL_INIT_KEYS = [
  ...SETTINGS,
  'lastBackupAt',
  'urlStatsToday',
  'cachedCounts'
];

function renderLastBackup(lastBackupAt) {
  const target = el('last-backup');
  if (!target) return;
  if (!lastBackupAt) { target.textContent = '未実行'; return; }
  const d = Date.now() - lastBackupAt;
  const days = Math.floor(d / 86400000);
  const hrs = Math.floor((d % 86400000) / 3600000);
  target.textContent = days > 0 ? days + '日前' : (hrs > 0 ? hrs + '時間前' : 'たった今');
}

function renderCounts({ bm, rl, hs }) {
  if (bm !== undefined && el('c-bm')) el('c-bm').textContent = bm.toLocaleString() + ' 件';
  if (rl !== undefined && el('c-rl')) el('c-rl').textContent = typeof rl === 'number' ? rl.toLocaleString() + ' 件' : rl;
  if (hs !== undefined && el('c-hs')) el('c-hs').textContent = hs;
}

async function loadInitialData() {
  try {
    const s = await chrome.storage.local.get(ALL_INIT_KEYS);

    // 1. 各種フォーム・設定値（値が異なる場合のみ代入してDOMリフロー抑制）
    SETTINGS.forEach(id => {
      const e = el(id);
      if (!e || s[id] === undefined) return;
      if (e.type === 'checkbox') {
        if (e.checked !== s[id]) e.checked = s[id];
      } else {
        if (e.value !== String(s[id])) e.value = s[id];
      }
    });

    // 2. 前回バックアップ時刻
    renderLastBackup(s.lastBackupAt);

    // 3. 今日のURL浄化件数
    if (el('url-today')) {
      const today = new Date().toISOString().slice(0, 10);
      const val = (s.urlStatsToday?.date === today ? s.urlStatsToday.count : 0).toLocaleString();
      if (el('url-today').textContent !== val) el('url-today').textContent = val;
    }

    // 4. キャッシュされた件数を一瞬で適用（0ms表示）
    if (s.cachedCounts) {
      renderCounts(s.cachedCounts);
    }
  } catch (e) {
    console.warn('loadInitialData:', e);
  } finally {
    // 最初のペイント完了後にトランジションを解禁
    requestAnimationFrame(() => {
      document.body.classList.remove('is-loading');
    });
  }
}

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
   初期化（DOMContentLoadedを待たず即時同期実行してレスポンス最大化）
   ═══════════════════════════════════════════════════ */

(async function init() {
  // 1回のストレージアクセスで設定・キャッシュを即座に復元（リフロー防止）
  await loadInitialData();

  // タブ切替
  const tabIds = ['tab-1', 'tab-2', 'tab-3', 'tab-4'];
  const viewIds = ['view-1', 'view-2', 'view-3', 'view-4'];
  tabIds.forEach((tid, i) => {
    el(tid).addEventListener('click', async () => {
      tabIds.forEach(t => el(t).classList.remove('active'));
      viewIds.forEach(v => el(v).classList.remove('active'));
      el(tid).classList.add('active');
      el(viewIds[i]).classList.add('active');
      if (i === 2) renderStats();
      if (i === 1) renderYtLiked();
    });
  });

  // アコーディオン
  ['acc-b1'].forEach(id => {
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

  // 初期ロード完了後、メインスレッドをブロックしないよう静かにバックグラウンド更新
  setTimeout(() => {
    updateCounts().catch(() => {});
  }, 500);

  // 高評価コレクターは YT タブを開いた時にだけ読み込む (初期表示しない)

  // ── ボタンイベント登録 ──
  el('btn-browser-run').addEventListener('click', () => runBrowser(false));
  el('btn-browser-backup-only').addEventListener('click', () => runBrowser(true));
  el('btn-rl-save-current').addEventListener('click', async () => {
    try {
      const { title, url } = await getActiveHttpTab();
      await rlAdd({ title, url, hasBeenRead: false });
      setStatus('✅ Reading List に保存しました: ' + title);
      await updateCounts();
    } catch (e) { setStatus('❌ RL保存失敗: ' + e.message); }
  });
  el('btn-rl-read').addEventListener('click', async () => {
    try {
      const { url } = await getActiveHttpTab();
      await rlUpdate({ url, hasBeenRead: true });
      setStatus('✅ 既読にしました');
      await updateCounts();
    } catch (e) { setStatus('❌ 既読化失敗: ' + e.message); }
  });
  el('btn-rl-remove-current').addEventListener('click', async () => {
    try {
      const { url } = await getActiveHttpTab();
      await rlRemove(url);
      setStatus('✅ Reading List から削除しました');
      await updateCounts();
    } catch (e) { setStatus('❌ RL削除失敗: ' + e.message); }
  });
  el('btn-rl-open').addEventListener('click', async () => {
    try {
      if (chrome.sidePanel?.open) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.sidePanel.open({ windowId: tab.windowId });
      } else {
        setStatus('サイドパネルAPIが使えません。Chrome の Reading List (サイドパネル) を手動で開いてください');
      }
    } catch (e) { setStatus('サイドパネルを開けません: ' + e.message); }
  });
  el('btn-yt-save-current').addEventListener('click', ytSaveCurrent);
  el('btn-yt-import').addEventListener('click', ytImport);

async function ytImport() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/youtube\.com/.test(tab.url || '')) {
    setStatus('先にYouTube（または Music）の高評価リストページを開いてください');
    return;
  }
  setStatus('リストを取り込み中...');
  try {
    const r = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type: 'yt-collect-page' }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp);
      });
    });
    if (!r?.ok) { setStatus('取り込み失敗: ' + (r?.error || '不明')); return; }
    setStatus('取り込み完了: ページ ' + (r.imported || 0) + '件 / 保存済み ' + (r.total || 0) + '件');
    renderYtLiked();
  } catch (e) {
    setStatus('取り込み失敗: ' + e.message + '（拡張を再読み込みしてから試してください）');
  }
}
  el('btn-yt-export-json').addEventListener('click', ytExportJson);
  el('btn-yt-export-html').addEventListener('click', ytExportHtml);
  el('btn-yt-clear').addEventListener('click', ytClear);
  el('btn-stats-reset').addEventListener('click', resetStats);

  // ── スイートヘッダー ──
  el('btn-open-editor').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    window.close();
  });

  // 現在の Chrome ブックマークをダウンロードせず、直接エディタへ手渡す (.htm/.html どちらでも可)
  el('btn-open-editor-import').addEventListener('click', async () => {
    try {
      const tree = await chrome.bookmarks.getTree();
      let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';
      const proc = n => {
        let o = '';
        if (n.url) { o += '    <DT><A HREF="' + escapeHtml(n.url) + '">' + escapeHtml(n.title) + '</A>\n'; }
        else if (n.children) {
          o += '    <DT><H3>' + escapeHtml(n.title) + '</H3>\n    <DL><p>\n';
          for (const c of n.children) o += proc(c);
          o += '    </DL><p>\n';
        }
        return o;
      };
      if (tree[0]?.children) for (const c of tree[0].children) html += proc(c);
      html += '</DL><p>';
      await chrome.storage.local.set({ pendingImport: { html, at: Date.now() } });
      await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
      window.close();
    } catch (e) { setStatus('❌ エディタへ渡せません: ' + e.message); }
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
      await loadInitialData();
      setStatus('設定インポート完了');
    } catch (err) { setStatus('インポート失敗: ' + err.message); }
  });
})();

/* ═══════════════════════════════════════════════════
   ブラウザデータ件数
   ═══════════════════════════════════════════════════ */

async function updateCounts() {
  try {
    // ブックマーク件数
    let bm = 0;
    try {
      const tree = await chrome.bookmarks.getTree();
      const w = ns => { for (const n of ns) { if (n.url) bm++; if (n.children) w(n.children); } };
      w(tree);
    } catch (_) {}

    // リーディングリスト件数
    let rl = '未対応';
    if (rlAvailable()) {
      try {
        const list = await rlQuery({});
        rl = list.length;
      } catch (e) {
        rl = 'エラー';
        console.warn('RL counts:', e);
      }
    }

    // 履歴件数（負荷軽減のため上限100）
    let hs = '0 件';
    try {
      const list = await new Promise(r => chrome.history.search({ text: '', maxResults: 100 }, r));
      hs = (list.length >= 100 ? '100+' : list.length) + ' 件';
    } catch (_) {}

    const counts = { bm, rl, hs };
    renderCounts(counts);

    // 次回ポップアップ表示時に0msで描画できるようキャッシュ
    chrome.storage.local.set({ cachedCounts: counts }).catch(() => {});
  } catch (err) {
    console.warn('updateCounts err:', err);
  }
}

async function updateLastBackup() {
  const { lastBackupAt } = await chrome.storage.local.get('lastBackupAt');
  renderLastBackup(lastBackupAt);
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

      if (doRl) {
        try {
          const rl = await rlQuery({});
          if (rl.length > 0) {
            html += '    <DT><H3>Reading List</H3>\n    <DL><p>\n';
            for (const i of rl) { html += '        <DT><A HREF="' + escapeHtml(i.url) + '">' + escapeHtml(i.title) + '</A>\n'; stats.rl++; }
            html += '    </DL><p>\n';
          }
        } catch (e) {
          const msg = rlErrorMessage('RL読み込みエラー', e);
          setStatus(msg);
          stats.rlError = msg;
        }
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

      if (doRl) {
        try {
          const rlItems = await rlQuery({});
          let removed = 0;
          const failed = [];
          for (let i = 0; i < rlItems.length; i += 10) {
            const batch = rlItems.slice(i, i + 10);
            const results = await Promise.allSettled(batch.map(it => rlRemove(it.url)));
            results.forEach((r, idx) => {
              if (r.status === 'fulfilled') removed += 1;
              else failed.push(batch[idx].url + ' → ' + (r.reason?.message || r.reason));
            });
            await sleep(100);
          }
          stats.rlRemoved = removed;
          if (failed.length) {
            const msg = `RL削除 ${removed}件成功 / ${failed.length}件失敗: ${failed[0]}${failed.length > 1 ? ` 他${failed.length - 1}件` : ''}`;
            console.warn(msg, failed);
            stats.rlError = msg;
          }
        } catch (e) {
          stats.rlError = rlErrorMessage('RL削除エラー', e);
        }
      }

      if (doHs) {
        await new Promise(r => chrome.history.deleteAll(r));
      }
    }

    // ── 完了 ──
    showProg('prog-browser', 100, '完了');
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    let doneMsg = '完了 (' + elapsed + '秒) BM:' + stats.bm + ' RL:' + stats.rl + ' HS:' + stats.hs;
    if (typeof stats.rlRemoved === 'number') doneMsg += ' / RL削除:' + stats.rlRemoved + '件';
    if (stats.rlError) doneMsg += ' / ⚠️ ' + stats.rlError;
    setStatus(doneMsg);

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
   YouTube 高評価コレクター（ポップアップ側）
   保存実体は background が chrome.storage.local の ytLiked に持つ。
   ポップアップは一覧表示・ファイルエクスポート・手動追加だけを担う。
   ═══════════════════════════════════════════════════ */

async function ytList() {
  const r = await chrome.runtime.sendMessage({ type: 'yt-list' });
  return r?.videos || [];
}

async function renderYtLiked() {
  const listEl = el('yt-list');
  const countEl = el('yt-count');
  if (!listEl) return;
  try {
    const videos = await ytList();
    if (countEl) countEl.textContent = videos.length.toLocaleString() + ' 件';
    if (!videos.length) {
      listEl.innerHTML = '<p class="note">なし（YouTubeで動画に「いいね」を付けると自動で保存されます）</p>';
      return;
    }
    listEl.innerHTML = videos.slice(-50).reverse().map(v => {
      const date = v.likedAt ? new Date(v.likedAt).toLocaleString() : '';
      return '<div style="padding:3px 0;border-bottom:1px solid var(--bdr);">' +
        '<a href="' + escapeHtml(v.url) + '" target="_blank" rel="noopener" style="color:var(--accent);">' + escapeHtml(v.title || v.id) + '</a>' +
        (v.channel ? '<br><span style="font-size:10px;color:var(--sub);">' + escapeHtml(v.channel) + '</span>' : '') +
        (date ? '<br><span style="font-size:10px;color:var(--sub);">' + date + '</span>' : '') + '</div>';
    }).join('');
  } catch (e) {
    listEl.innerHTML = '<p class="note">読み込み失敗: ' + escapeHtml(e.message) + '</p>';
  }
}

async function ytSaveCurrent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const m = url.match(/[?&]v=([\w-]{6,20})/);
  if (!m) { setStatus('YouTubeの動画ページを開いてください'); return; }
  const id = m[1];
  const r = await chrome.runtime.sendMessage({
    type: 'yt-liked',
    video: { id, title: tab.title || id, channel: '', url: 'https://www.youtube.com/watch?v=' + id, likedAt: Date.now() }
  });
  setStatus(r?.ok ? '保存しました（' + (r.count || 0) + '件）' : '保存に失敗しました');
  renderYtLiked();
}

function ytDownload(filename, content, type) {
  const a = document.createElement('a');
  const url = createBlob(content, type);
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function ytExportJson() {
  const videos = await ytList();
  if (!videos.length) { setStatus('保存データがありません'); return; }
  ytDownload('youtube_liked_' + new Date().toISOString().slice(0, 10) + '.json',
    JSON.stringify({ exportedAt: new Date().toLocaleString(), count: videos.length, videos }, null, 2),
    'application/json');
  setStatus('JSONを保存しました（' + videos.length + '件）');
}

async function ytExportHtml() {
  const videos = await ytList();
  if (!videos.length) { setStatus('保存データがありません'); return; }
  let h = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';
  h += '    <DT><H3>YouTube Liked (' + new Date().toISOString().slice(0, 10) + ')</H3>\n    <DL><p>\n';
  for (const v of videos) h += '        <DT><A HREF="' + escapeHtml(v.url) + '" ADD_DATE="' + Math.floor((v.likedAt || Date.now()) / 1000) + '">' + escapeHtml(v.title || v.id) + '</A>\n';
  h += '    </DL><p>\n</DL><p>';
  ytDownload('youtube_liked_' + new Date().toISOString().slice(0, 10) + '.html', h, 'text/html');
  setStatus('HTMLを保存しました（' + videos.length + '件）');
}

async function ytClear() {
  if (!confirm('保存済みの高評価データをすべて削除しますか？')) return;
  await chrome.runtime.sendMessage({ type: 'yt-clear' });
  setStatus('削除しました');
  renderYtLiked();
}

/* ═══════════════════════════════════════════════════
   統計タブ
   ═══════════════════════════════════════════════════ */

async function renderStats() {
  const { stats, runHistory } = await chrome.storage.local.get(['stats', 'runHistory']);
  const s = stats || {};
  el('stat-bm-total').textContent = (s.bmTotal || 0).toLocaleString();
  el('stat-hs-total').textContent = (s.hsTotal || 0).toLocaleString();
  el('stat-yt-collected').textContent = (s.ytCollected || 0).toLocaleString();
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
