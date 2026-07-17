// =========================================================================
//  共通ユーティリティ
// =========================================================================

const statusDiv = document.getElementById('status');
const RUN_STATE = { running: false, paused: false, cancelled: false };

function setStatus(msg, level = 'info') {
  const icons = { info: 'ℹ️', ok: '✅', warn: '⚠️', err: '❌' };
  statusDiv.textContent = `${icons[level] || ''} ${msg}`;
  console.log(`[Popup:${level}]`, msg);
}

const blobUrls = new Set();
function createManagedBlob(content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  blobUrls.add(url);
  return url;
}
function revokeAllBlobs() {
  blobUrls.forEach(url => URL.revokeObjectURL(url));
  blobUrls.clear();
}

function showProgress(containerId, percent, text) {
  const container = document.getElementById(containerId);
  const fill = document.getElementById(`${containerId}-fill`);
  const textEl = document.getElementById(`${containerId}-text`);
  if (container) container.classList.add('visible');
  if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  if (textEl) textEl.textContent = text || '';
}
function hideProgress(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.classList.remove('visible');
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function escapeHtml(s) {
  return s
    ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/>/g, '&gt;')
    : '';
}

function escapeCsv(s) {
  if (s == null) return '';
  const str = String(s);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

async function notify(title, message) {
  const s = await chrome.storage.local.get('cfg-notify');
  if (s['cfg-notify'] === false) return;
  try {
    await chrome.runtime.sendMessage({ type: 'notify', title, message });
  } catch (e) { console.warn(e); }
}

// ─── 統計更新 ───
async function updateStat(key, increment = 1) {
  const cur = await chrome.storage.local.get('stats');
  const stats = cur.stats || {};
  stats[key] = (stats[key] || 0) + increment;
  stats.lastRun = Date.now();
  await chrome.storage.local.set({ stats });
}

async function pushHistory(entry) {
  const cur = await chrome.storage.local.get('history');
  const hist = cur.history || [];
  hist.unshift({ ...entry, at: Date.now() });
  if (hist.length > 50) hist.length = 50;
  await chrome.storage.local.set({ history: hist });
}

// =========================================================================
//  初期化
// =========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupTabs();
  setupAccordions();
  await updateBrowserCounts();
  await updateLastBackupInfo();
  setupControlButtons();
  setupSettingsTab();
});

// ─── タブ切替 ───
function setupTabs() {
  const tabIds = ['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5'];
  const viewIds = ['view-1', 'view-2', 'view-3', 'view-4', 'view-5'];
  tabIds.forEach((tabId, idx) => {
    document.getElementById(tabId).addEventListener('click', async () => {
      tabIds.forEach(t => document.getElementById(t).classList.remove('active'));
      viewIds.forEach(v => document.getElementById(v).classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      document.getElementById(viewIds[idx]).classList.add('active');
      if (idx === 3) await renderStats();
    });
  });
}

// ─── アコーディオン ───
function setupAccordions() {
  ['acc-adv1', 'acc-adv2', 'acc-adv3'].forEach(id => {
    const header = document.getElementById(id);
    if (!header) return;
    header.addEventListener('click', () => {
      const content = document.getElementById(`${id}-content`);
      const icon = document.getElementById(`${id}-icon`);
      content.classList.toggle('open');
      icon.classList.toggle('open');
    });
  });
}

// ─── 設定の読み書き ───
const SETTING_IDS = [
  'chk-bm', 'chk-rl', 'chk-hs', 'chk-lw-hs', 'chk-csv-hs', 'chk-save-as',
  'chk-dry-run', 'chk-diff', 'hs-limit',
  'yt-chk-json', 'yt-chk-lw', 'yt-chk-csv', 'yt-chk-pl', 'yt-chk-del',
  'yt-delay', 'yt-batch', 'yt-parallel', 'yt-scroll-max',
  'yt-restore-delay', 'yt-retry', 'yt-restore-dedup', 'yt-restore-resume',
  'cfg-notify', 'cfg-sound', 'cfg-schedule', 'cfg-schedule-freq',
  'cfg-url-enabled', 'cfg-url-log', 'cfg-url-exclude'
];

async function loadSettings() {
  try {
    const settings = await chrome.storage.local.get(SETTING_IDS);
    SETTING_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el || settings[id] === undefined) return;
      if (el.type === 'checkbox') el.checked = settings[id];
      else el.value = settings[id];
    });
  } catch (e) {
    console.warn('設定読み込み失敗:', e);
  }
}

async function saveSettings() {
  const settings = {};
  SETTING_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') settings[id] = el.checked;
    else settings[id] = el.value;
  });
  try {
    await chrome.storage.local.set(settings);
  } catch (e) { console.warn(e); }
}

// 自動保存
document.querySelectorAll('input, select, textarea').forEach(el => {
  el.addEventListener('change', saveSettings);
});

// ─── 前回バックアップ情報 ───
async function updateLastBackupInfo() {
  const el = document.getElementById('last-backup');
  if (!el) return;
  const { lastBackupAt } = await chrome.storage.local.get('lastBackupAt');
  if (!lastBackupAt) { el.textContent = '未実行'; return; }
  const diff = Date.now() - lastBackupAt;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  el.textContent = days > 0 ? `${days}日前` : `${hours}時間前`;
}

// ─── 制御ボタン ───
function setupControlButtons() {
  const pauseBtn = document.getElementById('btn-yt-pause');
  const cancelBtn = document.getElementById('btn-yt-cancel');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', async () => {
      RUN_STATE.paused = !RUN_STATE.paused;
      pauseBtn.textContent = RUN_STATE.paused ? '▶ 再開' : '⏸ 一時停止';
      await chrome.storage.local.set({ ytPaused: RUN_STATE.paused });
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (!confirm('本当に中止しますか？')) return;
      RUN_STATE.cancelled = true;
      await chrome.storage.local.set({ ytCancelled: true });
    });
  }
}

// =========================================================================
//  Part 1: ブラウザデータ管理
// =========================================================================

async function updateBrowserCounts() {
  const bmCount = await new Promise(resolve => {
    chrome.bookmarks.getTree(tree => {
      let count = 0;
      const walk = nodes => {
        for (const n of nodes) {
          if (n.url) count++;
          if (n.children) walk(n.children);
        }
      };
      walk(tree);
      resolve(count);
    });
  });
  document.getElementById('c-bm').textContent = `${bmCount.toLocaleString()} 件`;

  if (chrome.readingList) {
    try {
      const rl = await chrome.readingList.query({});
      document.getElementById('c-rl').textContent = `${rl.length.toLocaleString()} 件`;
    } catch { document.getElementById('c-rl').textContent = 'エラー'; }
  } else {
    document.getElementById('c-rl').textContent = '未対応';
  }

  const hs = await new Promise(resolve => {
    chrome.history.search({ text: '', maxResults: 1000 }, resolve);
  });
  document.getElementById('c-hs').textContent =
    `${hs.length >= 1000 ? '1000+' : hs.length} 件`;
}

// ─── Linkwarden HTML生成 ───
function createLinkwardenHtml(folderName, items) {
  let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>${escapeHtml(folderName)}</H3>
    <DL><p>
`;
  for (const item of items) {
    html += `        <DT><A HREF="${escapeHtml(item.url)}">${escapeHtml(item.title || item.url)}</A>\n`;
  }
  html += `    </DL><p>\n</DL><p>`;
  return createManagedBlob(html, 'text/html');
}

// ─── CSV生成 ───
function createCsv(items, headers) {
  const rows = [headers.join(',')];
  for (const item of items) {
    rows.push(headers.map(h => escapeCsv(item[h])).join(','));
  }
  return createManagedBlob('\uFEFF' + rows.join('\n'), 'text/csv'); // BOM付き
}

// ─── ブックマーク+RL → HTML ───
async function generateHtmlBackup(doBm, doRl) {
  let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;
  let bmCount = 0, rlCount = 0;

  if (doBm) {
    const tree = await chrome.bookmarks.getTree();
    const proc = (n) => {
      let o = '';
      if (n.url) {
        o += `    <DT><A HREF="${escapeHtml(n.url)}">${escapeHtml(n.title)}</A>\n`;
        bmCount++;
      } else if (n.children) {
        o += `    <DT><H3>${escapeHtml(n.title)}</H3>\n    <DL><p>\n`;
        for (const c of n.children) o += proc(c);
        o += `    </DL><p>\n`;
      }
      return o;
    };
    if (tree[0]?.children) {
      for (const c of tree[0].children) html += proc(c);
    }
  }

  if (doRl && chrome.readingList) {
    try {
      const rl = await chrome.readingList.query({});
      if (rl.length > 0) {
        html += `    <DT><H3>Reading List</H3>\n    <DL><p>\n`;
        for (const i of rl) {
          html += `        <DT><A HREF="${escapeHtml(i.url)}">${escapeHtml(i.title)}</A>\n`;
          rlCount++;
        }
        html += `    </DL><p>\n`;
      }
    } catch (e) { console.warn(e); }
  }

  html += `</DL><p>`;
  return { url: createManagedBlob(html, 'text/html'), bmCount, rlCount };
}

// ─── 履歴バックアップ ───
async function generateHistoryBackup(limit) {
  const items = await new Promise(resolve => {
    chrome.history.search({ text: '', startTime: 0, maxResults: limit }, resolve);
  });

  const clean = items.map(i => ({
    title: i.title || i.url,
    url: i.url,
    visitCount: i.visitCount,
    lastVisit: new Date(i.lastVisitTime).toLocaleString(),
    lastVisitTime: i.lastVisitTime
  }));

  const yt = clean.filter(i => i.url.includes('youtube.com/watch'));
  const data = JSON.stringify({
    exportedAt: new Date().toLocaleString(),
    count: clean.length,
    youtubeHistory: yt,
    fullHistory: clean
  }, null, 2);

  return {
    jsonUrl: createManagedBlob(data, 'application/json'),
    items: clean,
    count: clean.length
  };
}

// ─── ダウンロード ───
function downloadFileAndWait(url, name, saveAs = true) {
  return new Promise((resolve, reject) => {
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = name.replace('.', `_${ts}.`);

    chrome.downloads.download(
      { url, filename, saveAs, conflictAction: 'uniquify' },
      (downloadId) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!downloadId) return reject(new Error('保存キャンセル'));

        const timeout = setTimeout(() => {
          chrome.downloads.onChanged.removeListener(listener);
          reject(new Error('タイムアウト'));
        }, 120000);

        const listener = (delta) => {
          if (delta.id !== downloadId || !delta.state) return;
          if (delta.state.current === 'complete') {
            clearTimeout(timeout);
            chrome.downloads.onChanged.removeListener(listener);
            resolve();
          } else if (delta.state.current === 'interrupted') {
            clearTimeout(timeout);
            chrome.downloads.onChanged.removeListener(listener);
            reject(new Error(`失敗: ${delta.error?.current || 'unknown'}`));
          }
        };
        chrome.downloads.onChanged.addListener(listener);
      }
    );
  });
}

// ─── 差分バックアップ用 ───
async function getPrevBackupSnapshot() {
  const { prevSnapshot } = await chrome.storage.local.get('prevSnapshot');
  return prevSnapshot || { bookmarks: [], history: [] };
}

async function saveBackupSnapshot(bookmarks, history) {
  // URLのハッシュのみ保存(容量節約)
  await chrome.storage.local.set({
    prevSnapshot: {
      bookmarks: bookmarks.map(b => b.url),
      history: history.map(h => h.url),
      savedAt: Date.now()
    }
  });
}

// ─── メイン処理: 退避＆削除 ───
async function runBrowserProcess(backupOnly = false) {
  const doBm = document.getElementById('chk-bm').checked;
  const doRl = document.getElementById('chk-rl').checked;
  const doHs = document.getElementById('chk-hs').checked;
  const doLwHs = document.getElementById('chk-lw-hs').checked;
  const doCsvHs = document.getElementById('chk-csv-hs').checked;
  const saveAs = document.getElementById('chk-save-as').checked;
  const dryRun = document.getElementById('chk-dry-run').checked;
  const diffMode = document.getElementById('chk-diff').checked;
  const hsLimit = parseInt(document.getElementById('hs-limit').value, 10) || 100000;

  if (!doBm && !doRl && !doHs) {
    setStatus('対象が選択されていません', 'warn');
    return;
  }

  if (!backupOnly) {
    if (dryRun) {
      const bmCount = document.getElementById('c-bm').textContent;
      const rlCount = document.getElementById('c-rl').textContent;
      const hsCount = document.getElementById('c-hs').textContent;
      alert(`【ドライラン】削除対象:\n\nBM: ${bmCount}\nRL: ${rlCount}\n履歴: ${hsCount}\n\n実際には削除されません。`);
      setStatus('ドライラン完了', 'ok');
      return;
    }
    if (!confirm('選択した項目を【バックアップして完全に削除】します。よろしいですか？')) return;
  }

  const btnMain = document.getElementById('btn-browser-run');
  const btnBackup = document.getElementById('btn-browser-backup-only');
  btnMain.disabled = true;
  btnBackup.disabled = true;

  const startTime = Date.now();
  let stats = { bm: 0, rl: 0, hs: 0 };

  try {
    let totalSteps = 0;
    if (doBm || doRl) totalSteps++;
    if (doHs) totalSteps++;
    if (doHs && doLwHs) totalSteps++;
    if (doHs && doCsvHs) totalSteps++;
    if (!backupOnly) totalSteps += 3;

    let step = 0;

    // BM+RL バックアップ
    if (doBm || doRl) {
      step++;
      showProgress('prog-browser', (step / totalSteps) * 100, 'BM/RL保存中...');
      setStatus('BM/RL保存中...');
      const { url, bmCount, rlCount } = await generateHtmlBackup(doBm, doRl);
      await downloadFileAndWait(url, 'browser_backup.html', saveAs);
      stats.bm = bmCount; stats.rl = rlCount;
    }

    // 履歴バックアップ
    let historyItems = [];
    if (doHs) {
      step++;
      showProgress('prog-browser', (step / totalSteps) * 100, '履歴JSON作成中...');
      setStatus('履歴JSON作成中...');
      const { jsonUrl, items, count } = await generateHistoryBackup(hsLimit);
      historyItems = items;
      stats.hs = count;

      // 差分モード
      let saveItems = items;
      if (diffMode) {
        const prev = await getPrevBackupSnapshot();
        const prevSet = new Set(prev.history);
        saveItems = items.filter(i => !prevSet.has(i.url));
        setStatus(`差分: ${saveItems.length} / ${items.length} 件`);
      }

      const jsonData = JSON.stringify({
        exportedAt: new Date().toLocaleString(),
        mode: diffMode ? 'diff' : 'full',
        count: saveItems.length,
        items: saveItems
      }, null, 2);
      const finalUrl = createManagedBlob(jsonData, 'application/json');
      await downloadFileAndWait(finalUrl, 'history_backup.json', saveAs);

      if (doLwHs) {
        step++;
        showProgress('prog-browser', (step / totalSteps) * 100, '履歴HTML作成中...');
        const lwUrl = createLinkwardenHtml(
          `Browser History (${new Date().toISOString().slice(0, 10)})`,
          saveItems
        );
        await downloadFileAndWait(lwUrl, 'history_linkwarden.html', saveAs);
      }

      if (doCsvHs) {
        step++;
        showProgress('prog-browser', (step / totalSteps) * 100, '履歴CSV作成中...');
        const csvUrl = createCsv(saveItems, ['title', 'url', 'visitCount', 'lastVisit']);
        await downloadFileAndWait(csvUrl, 'history_backup.csv', saveAs);
      }
    }

    // スナップショット保存
    if (diffMode) {
      const bmList = doBm ? await getAllBookmarks() : [];
      await saveBackupSnapshot(bmList, historyItems);
    }

    // ── 削除 ──
    if (!backupOnly) {
      step++;
      showProgress('prog-browser', (step / totalSteps) * 100, '削除中...');
      setStatus('削除中...');

      // BM削除
      if (doBm) {
        const tree = await chrome.bookmarks.getTree();
        if (tree[0]?.children) {
          for (const sys of tree[0].children) {
            if (sys.children) {
              for (const item of sys.children) {
                await new Promise(resolve => {
                  chrome.bookmarks.removeTree(item.id, () => {
                    if (chrome.runtime.lastError) {
                      console.warn(`削除スキップ(${item.title}): ${chrome.runtime.lastError.message}`);
                    }
                    resolve();
                  });
                });
              }
            }
          }
        }
      }

      // RL削除
      if (doRl && chrome.readingList) {
        const rlItems = await chrome.readingList.query({});
        let ok = 0, ng = 0;
        for (let i = 0; i < rlItems.length; i += 10) {
          const batch = rlItems.slice(i, i + 10);
          const results = await Promise.allSettled(
            batch.map(it => chrome.readingList.remove({ url: it.url }))
          );
          results.forEach(r => r.status === 'fulfilled' ? ok++ : ng++);
          await sleep(100);
        }
        if (ng > 0) {
          setStatus(`RL: ${ok}件削除, ${ng}件失敗（Brave同期制限の可能性）`, 'warn');
          await sleep(2000);
        }
      }

      // 履歴削除
      if (doHs) {
        setStatus('履歴を削除中...');
        await new Promise(resolve => chrome.history.deleteAll(resolve));
      }
    }

    showProgress('prog-browser', 100, '完了！');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    setStatus(`完了 (${elapsed}秒) BM:${stats.bm} RL:${stats.rl} HS:${stats.hs}`, 'ok');

    // 統計更新
    await updateStat('bmTotal', stats.bm);
    await updateStat('hsTotal', stats.hs);
    await updateStat('runs', 1);
    await pushHistory({
      type: backupOnly ? 'backup-only' : 'backup-delete',
      stats,
      elapsed
    });
    await chrome.storage.local.set({ lastBackupAt: Date.now() });

    await updateBrowserCounts();
    await updateLastBackupInfo();
    revokeAllBlobs();
    notify('ブラウザ掃除完了', `BM:${stats.bm} RL:${stats.rl} 履歴:${stats.hs}`);

    setTimeout(() => hideProgress('prog-browser'), 3000);

  } catch (e) {
    setStatus(`エラー: ${e.message}`, 'err');
    console.error(e);
  } finally {
    btnMain.disabled = false;
    btnBackup.disabled = false;
  }
}

async function getAllBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const result = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.url) result.push({ url: n.url, title: n.title });
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return result;
}

document.getElementById('btn-browser-run').addEventListener('click', () => runBrowserProcess(false));
document.getElementById('btn-browser-backup-only').addEventListener('click', () => runBrowserProcess(true));

// =========================================================================
//  Part 2: YouTube 退避
// =========================================================================

document.getElementById('btn-yt-run').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab.url.includes('youtube.com/playlist?list=LL')) {
    setStatus('YouTubeの「高く評価した動画」を開いてください', 'warn');
    return;
  }

  const opts = {
    isJson: document.getElementById('yt-chk-json').checked,
    isLw: document.getElementById('yt-chk-lw').checked,
    isCsv: document.getElementById('yt-chk-csv').checked,
    isPl: document.getElementById('yt-chk-pl').checked,
    isDelete: document.getElementById('yt-chk-del').checked,
    delay: parseInt(document.getElementById('yt-delay').value, 10) || 400,
    batchSize: parseInt(document.getElementById('yt-batch').value, 10) || 50,
    parallel: parseInt(document.getElementById('yt-parallel').value, 10) || 1,
    scrollMax: parseInt(document.getElementById('yt-scroll-max').value, 10) || 300
  };

  if (!opts.isJson && !opts.isLw && !opts.isCsv && !opts.isPl && !opts.isDelete) {
    setStatus('処理を1つ以上選んでください', 'warn');
    return;
  }
  if (opts.isDelete && !confirm('【警告】バックアップ後、高評価を取り消します。よろしいですか？')) return;

  await chrome.storage.local.set({ ytPaused: false, ytCancelled: false });
  document.getElementById('yt-controls').classList.add('visible');
  setStatus('YouTubeスクリプト実行中...ページ上のパネルで進捗確認できます');

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: runYoutubeManager,
    args: [opts],
    world: 'MAIN'
  }, async () => {
    if (chrome.runtime.lastError) {
      setStatus('エラー: ' + chrome.runtime.lastError.message, 'err');
    } else {
      await updateStat('ytBackup', 1);
      await pushHistory({ type: 'yt-backup', opts });
    }
    document.getElementById('yt-controls').classList.remove('visible');
  });
});

// =========================================================================
//  Part 3: YouTube 復元
// =========================================================================

let restoreVideoIds = [];

async function checkFailedIds() {
  const { failedIds } = await chrome.storage.local.get('failedIds');
  const info = document.getElementById('failed-info');
  const btn = document.getElementById('btn-retry-failed');
  if (failedIds && failedIds.length > 0) {
    info.textContent = `前回失敗した ${failedIds.length} 件があります`;
    info.style.display = 'block';
    btn.style.display = 'block';
  } else {
    info.style.display = 'none';
    btn.style.display = 'none';
  }
}
checkFailedIds();

document.getElementById('btn-yt-restore').addEventListener('click', async () => {
  const file = document.getElementById('yt-file-restore').files[0];
  if (!file) { setStatus('JSONファイルを選択してください', 'warn'); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab.url.includes('youtube.com/')) {
    setStatus('YouTubeを開いてください', 'warn');
    return;
  }

  try {
    setStatus('ファイル解析中...');
    const text = await file.text();
    const data = JSON.parse(text);
    let videos = data.videos || data.youtubeHistory || data.items || [];
    if (videos.length === 0) throw new Error('動画データなし');

    let ids = videos
      .map(v => v.id || (v.url ? new URL(v.url).searchParams.get('v') : null))
      .filter(Boolean);

    const dedup = document.getElementById('yt-restore-dedup').checked;
    if (dedup) {
      const before = ids.length;
      ids = [...new Set(ids)];
      if (before !== ids.length) {
        setStatus(`重複除去: ${before} → ${ids.length}`);
        await sleep(600);
      }
    }

    const resume = document.getElementById('yt-restore-resume').checked;
    if (resume) {
      const { processedIds } = await chrome.storage.local.get('processedIds');
      if (processedIds && processedIds.length > 0) {
        const processedSet = new Set(processedIds);
        const before = ids.length;
        ids = ids.filter(id => !processedSet.has(id));
        if (before !== ids.length && confirm(`前回処理済み ${before - ids.length} 件をスキップしますか？`)) {
          // OK
        } else {
          ids = videos.map(v => v.id || (v.url ? new URL(v.url).searchParams.get('v') : null)).filter(Boolean);
          if (dedup) ids = [...new Set(ids)];
        }
      }
    }

    if (ids.length === 0) throw new Error('復元対象なし');
    if (!confirm(`${ids.length} 件を再評価しますか？`)) return;

    restoreVideoIds = ids;
    await runRestore(ids, tab.id);
  } catch (e) {
    setStatus('エラー: ' + e.message, 'err');
  }
});

document.getElementById('btn-retry-failed').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab.url.includes('youtube.com/')) {
    setStatus('YouTubeを開いてください', 'warn');
    return;
  }
  const { failedIds } = await chrome.storage.local.get('failedIds');
  if (!failedIds || failedIds.length === 0) { setStatus('失敗IDなし', 'warn'); return; }
  if (!confirm(`失敗した ${failedIds.length} 件を再試行しますか？`)) return;
  await runRestore(failedIds, tab.id);
});

async function runRestore(ids, tabId) {
  const delay = parseInt(document.getElementById('yt-restore-delay').value, 10) || 400;
  const maxRetries = parseInt(document.getElementById('yt-retry').value, 10) || 3;

  await chrome.storage.local.set({ ytPaused: false, ytCancelled: false });
  document.getElementById('yt-controls').classList.add('visible');
  setStatus(`${ids.length} 件の再評価開始...`);

  chrome.scripting.executeScript({
    target: { tabId },
    func: runYoutubeReliker,
    args: [ids, delay, maxRetries],
    world: 'MAIN'
  }, async () => {
    await updateStat('ytRestore', 1);
    await pushHistory({ type: 'yt-restore', count: ids.length });
    document.getElementById('yt-controls').classList.remove('visible');
    setTimeout(checkFailedIds, 2000);
  });
}

// =========================================================================
//  Part 4: 統計タブ
// =========================================================================

async function renderStats() {
  const { stats, history } = await chrome.storage.local.get(['stats', 'history']);
  const s = stats || {};

  document.getElementById('stat-bm-total').textContent = (s.bmTotal || 0).toLocaleString();
  document.getElementById('stat-hs-total').textContent = (s.hsTotal || 0).toLocaleString();
  document.getElementById('stat-yt-backup').textContent = (s.ytBackup || 0).toLocaleString();
  document.getElementById('stat-yt-restore').textContent = (s.ytRestore || 0).toLocaleString();
  document.getElementById('stat-url-cleaned').textContent = (s.urlCleaned || 0).toLocaleString();
  document.getElementById('stat-runs').textContent = (s.runs || 0).toLocaleString();

  const listEl = document.getElementById('history-list');
  if (!history || history.length === 0) {
    listEl.innerHTML = '<p class="note">履歴なし</p>';
    return;
  }
  listEl.innerHTML = history.slice(0, 10).map(h => {
    const time = new Date(h.at).toLocaleString();
    const info = h.stats ? `BM:${h.stats.bm} RL:${h.stats.rl} HS:${h.stats.hs}` :
      h.count ? `${h.count}件` : '';
    return `<div style="padding:4px 0;border-bottom:1px solid var(--border);">
      <div style="font-weight:bold;">${h.type}</div>
      <div style="color:var(--text-sub);font-size:10px;">${time} ${info}</div>
    </div>`;
  }).join('');
}

document.getElementById('btn-stats-reset').addEventListener('click', async () => {
  if (!confirm('統計をリセットしますか？')) return;
  await chrome.storage.local.remove(['stats', 'history']);
  await renderStats();
  setStatus('統計をリセットしました', 'ok');
});

// =========================================================================
//  Part 5: 設定タブ
// =========================================================================

async function setupSettingsTab() {
  // URLクリーナー今日の統計
  const { urlStatsToday } = await chrome.storage.local.get('urlStatsToday');
  const today = new Date().toISOString().slice(0, 10);
  if (urlStatsToday && urlStatsToday.date === today) {
    document.getElementById('url-today').textContent = urlStatsToday.count.toLocaleString();
  } else {
    document.getElementById('url-today').textContent = '0';
  }

  // スケジュール変更
  document.getElementById('cfg-schedule').addEventListener('change', async (e) => {
    const freq = parseInt(document.getElementById('cfg-schedule-freq').value, 10);
    await chrome.runtime.sendMessage({
      type: 'setSchedule',
      enabled: e.target.checked,
      intervalMinutes: freq
    });
  });

  // 設定エクスポート
  document.getElementById('btn-export-settings').addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    const data = JSON.stringify(all, null, 2);
    const url = createManagedBlob(data, 'application/json');
    await downloadFileAndWait(url, 'extension_settings.json', true);
    revokeAllBlobs();
    setStatus('設定をエクスポート', 'ok');
  });

  // 設定インポート
  document.getElementById('btn-import-settings').addEventListener('click', () => {
    document.getElementById('import-settings-file').click();
  });
  document.getElementById('import-settings-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('現在の設定を上書きします。よろしいですか？')) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await chrome.storage.local.set(data);
      await loadSettings();
      setStatus('設定をインポート', 'ok');
    } catch (e) {
      setStatus('インポート失敗: ' + e.message, 'err');
    }
  });
}

// =========================================================================
//  YouTube コンテンツスクリプト
// =========================================================================

async function runYoutubeManager(opts) {
  const { isJson, isLw, isCsv, isPl, isDelete, delay = 400, batchSize = 50, parallel = 1, scrollMax = 300 } = opts;

  // ─── UIパネル ───
  const getPanel = () => {
    let box = document.getElementById('yt-ext-log');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'yt-ext-log';
    box.style.cssText = 'position:fixed;bottom:16px;right:16px;width:400px;max-height:400px;background:rgba(10,10,20,0.97);color:#00ff88;padding:12px;font-size:12px;overflow-y:auto;z-index:99999;border-radius:10px;font-family:monospace;line-height:1.5;box-shadow:0 4px 20px rgba(0,0,0,0.5);border:1px solid #00ff88;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #00ff88;';
    header.innerHTML = `
      <span style="font-weight:bold;">📺 YT Backup</span>
      <span>
        <button id="yt-ext-pause" style="background:#f59e0b;border:none;color:white;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">⏸</button>
        <button id="yt-ext-cancel" style="background:#dc3545;border:none;color:white;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">⏹</button>
        <button id="yt-ext-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:14px;">✕</button>
      </span>
    `;
    box.appendChild(header);

    const progressWrap = document.createElement('div');
    progressWrap.innerHTML = `
      <div style="width:100%;height:6px;background:#222;border-radius:3px;overflow:hidden;">
        <div id="yt-ext-progress" style="height:100%;width:0%;background:linear-gradient(90deg,#00ff88,#00bfff);transition:width 0.3s;"></div>
      </div>
      <div id="yt-ext-progress-text" style="font-size:10px;color:#aaa;text-align:center;margin:4px 0 8px;"></div>
    `;
    box.appendChild(progressWrap);

    const logArea = document.createElement('div');
    logArea.id = 'yt-ext-logarea';
    logArea.style.cssText = 'max-height:250px;overflow-y:auto;';
    box.appendChild(logArea);

    document.body.appendChild(box);

    document.getElementById('yt-ext-close').onclick = () => box.remove();
    document.getElementById('yt-ext-pause').onclick = () => {
      window.__ytPaused = !window.__ytPaused;
      document.getElementById('yt-ext-pause').textContent = window.__ytPaused ? '▶' : '⏸';
    };
    document.getElementById('yt-ext-cancel').onclick = () => {
      if (confirm('中止しますか？')) window.__ytCancelled = true;
    };

    return box;
  };

  const log = (msg, color) => {
    console.log('[YT-Ext]', msg);
    getPanel();
    const area = document.getElementById('yt-ext-logarea');
    if (!area) return;
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (color) line.style.color = color;
    area.appendChild(line);
    area.scrollTop = area.scrollHeight;
    // 古いログ削除(200行制限)
    while (area.children.length > 200) area.removeChild(area.firstChild);
  };

  const setProg = (cur, total, label) => {
    const bar = document.getElementById('yt-ext-progress');
    const text = document.getElementById('yt-ext-progress-text');
    if (bar) bar.style.width = `${(cur / total) * 100}%`;
    if (text) text.textContent = label || `${cur}/${total}`;
  };

  const escapeHtml = s => s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') : '';
  const escapeCsv = s => {
    if (s == null) return '';
    const str = String(s);
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const waitIfPaused = async () => {
    while (window.__ytPaused && !window.__ytCancelled) {
      await new Promise(r => setTimeout(r, 500));
    }
  };

  const checkCancel = () => {
    if (window.__ytCancelled) throw new Error('ユーザー中止');
  };

  const fetchWithRetry = async (url, options, maxRetries = 3) => {
    for (let a = 0; a <= maxRetries; a++) {
      try {
        const res = await fetch(url, options);
        if (res.status === 429) {
          const ra = parseInt(res.headers.get('Retry-After') || '5', 10);
          log(`⏳ レート制限 (${ra}秒待機)`, '#ff9800');
          await new Promise(r => setTimeout(r, ra * 1000));
          continue;
        }
        if (res.status >= 500 && a < maxRetries) {
          const w = 1000 * Math.pow(2, a);
          log(`⏳ サーバーエラー ${res.status} (${w}ms待機)`, '#ff9800');
          await new Promise(r => setTimeout(r, w));
          continue;
        }
        return res;
      } catch (err) {
        if (a >= maxRetries) throw err;
        const w = 1000 * Math.pow(2, a);
        log(`⏳ NW エラー (${w}ms待機): ${err.message}`, '#ff9800');
        await new Promise(r => setTimeout(r, w));
      }
    }
    throw new Error('リトライ上限到達');
  };

  try {
    window.__ytPaused = false;
    window.__ytCancelled = false;
    log('🚀 処理開始', '#00ff88');

    if (!window.ytcfg?.data_) throw new Error('ytcfg なし。リロード必要');
    const cfg = window.ytcfg.data_;
    const apiKey = cfg.INNERTUBE_API_KEY || null;
    const context = cfg.INNERTUBE_CONTEXT;
    const authUser = cfg.SESSION_INDEX || '0';
    const clientVersion = cfg.INNERTUBE_CLIENT_VERSION || '2.20250101.00.00';

    const makeUrl = p => apiKey
      ? `https://www.youtube.com/youtubei/v1/${p}?key=${apiKey}&prettyPrint=false`
      : `https://www.youtube.com/youtubei/v1/${p}?prettyPrint=false`;

    let cachedHeaders = null, headerTS = 0;
    const getHeaders = async (force = false) => {
      const now = Math.floor(Date.now() / 1000);
      if (!force && cachedHeaders && (now - headerTS) < 30) return cachedHeaders;
      const m = document.cookie.match(/SAPISID=([^;]+)/);
      if (!m) throw new Error('SAPISID なし。ログイン必要');
      const sapisid = decodeURIComponent(m[1]);
      const origin = window.location.origin;
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${now} ${sapisid} ${origin}`));
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      cachedHeaders = {
        'Authorization': `SAPISIDHASH ${now}_${hash}`,
        'X-Origin': origin,
        'X-Goog-AuthUser': authUser,
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': clientVersion,
        'Content-Type': 'application/json'
      };
      headerTS = now;
      return cachedHeaders;
    };

    // ─── スクロール収集 ───
    log('🔍 スクロール収集開始');
    const videoMap = new Map();
    let noChange = 0;
    const MAX_NC = 5;

    for (let i = 0; i < scrollMax; i++) {
      await waitIfPaused();
      checkCancel();
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 800));

      if (document.querySelector('ytd-continuation-item-renderer, tp-yt-paper-spinner-lite')) {
        await new Promise(r => setTimeout(r, 1500));
      }

      const links = document.querySelectorAll(
        'ytd-playlist-video-renderer a#video-title[href*="watch"],' +
        'ytd-grid-video-renderer a#video-title[href*="watch"],' +
        'ytd-video-renderer a#video-title[href*="watch"],' +
        'a#video-title[href*="watch?v="]'
      );

      const prev = videoMap.size;
      for (const a of links) {
        try {
          const url = new URL(a.href, location.origin);
          const vid = url.searchParams.get('v');
          if (vid && !videoMap.has(vid)) {
            videoMap.set(vid, {
              id: vid,
              title: (a.title || a.textContent || '').trim() || 'Unknown',
              url: `https://www.youtube.com/watch?v=${vid}`
            });
          }
        } catch { }
      }
      setProg(videoMap.size, 5000, `収集: ${videoMap.size}件`);

      if (videoMap.size === prev) {
        noChange++;
        if (noChange >= MAX_NC) { log('✅ スクロール終端'); break; }
      } else noChange = 0;

      if (videoMap.size >= 5000) { log('ℹ️ 5000件上限'); break; }
    }

    const videos = Array.from(videoMap.values());
    if (videos.length === 0) throw new Error('動画なし');
    log(`📊 合計 ${videos.length} 件`, '#00bfff');

    const headers = await getHeaders();
    const dateStr = new Date().toISOString().slice(0, 10);
    let errorCount = 0;

    // ─── JSON ───
    if (isJson) {
      log('📄 JSON作成中...');
      const data = JSON.stringify({ exportedAt: new Date().toLocaleString(), count: videos.length, videos }, null, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = `liked_videos_${dateStr}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      log('✅ JSON DL完了', '#00ff88');
      await new Promise(r => setTimeout(r, 500));
    }

    // ─── LW HTML ───
    if (isLw) {
      log('📄 LW HTML作成中...');
      let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>YouTube Liked Videos (${dateStr})</H3>
    <DL><p>
`;
      for (const v of videos) {
        html += `        <DT><A HREF="${escapeHtml(v.url)}">${escapeHtml(v.title)}</A>\n`;
      }
      html += `    </DL><p>\n</DL><p>`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      a.download = `liked_videos_lw_${dateStr}.html`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      log('✅ LW HTML DL完了', '#00ff88');
      await new Promise(r => setTimeout(r, 500));
    }

    // ─── CSV ───
    if (isCsv) {
      log('📄 CSV作成中...');
      const csvRows = ['id,title,url'];
      for (const v of videos) {
        csvRows.push([escapeCsv(v.id), escapeCsv(v.title), escapeCsv(v.url)].join(','));
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv' }));
      a.download = `liked_videos_${dateStr}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      log('✅ CSV DL完了', '#00ff88');
      await new Promise(r => setTimeout(r, 500));
    }

    // ─── プレイリスト ───
    if (isPl) {
      const plTitle = `Liked Backup ${dateStr}`;
      log(`📺 プレイリスト作成: ${plTitle}`);
      const createRes = await fetchWithRetry(makeUrl('playlist/create'), {
        method: 'POST', headers,
        body: JSON.stringify({ context, title: plTitle, privacyStatus: 'PRIVATE' })
      });
      const cj = await createRes.json();
      if (!cj.playlistId) throw new Error(`PL作成失敗: ${JSON.stringify(cj).slice(0, 200)}`);
      const plId = cj.playlistId;
      log(`✅ PL作成 (ID: ${plId})`, '#00ff88');

      const chunks = [];
      for (let i = 0; i < videos.length; i += batchSize) {
        chunks.push(videos.slice(i, i + batchSize));
      }

      const runChunk = async (chunk, idx) => {
        await waitIfPaused();
        checkCancel();
        const actions = chunk.map(v => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v.id }));
        try {
          const res = await fetchWithRetry(makeUrl('browse/edit_playlist'), {
            method: 'POST', headers,
            body: JSON.stringify({ context, playlistId: plId, actions })
          });
          if (!res.ok) { log(`⚠️ Chunk ${idx + 1} 失敗`, '#ff5555'); errorCount++; }
        } catch (e) {
          log(`⚠️ Chunk ${idx + 1} err: ${e.message}`, '#ff5555');
          errorCount++;
        }
      };

      // 並列実行
      let processed = 0;
      for (let i = 0; i < chunks.length; i += parallel) {
        const batch = chunks.slice(i, i + parallel);
        await Promise.all(batch.map((c, j) => runChunk(c, i + j)));
        processed += batch.reduce((s, c) => s + c.length, 0);
        setProg(processed, videos.length, `PL追加: ${processed}/${videos.length}`);
        await new Promise(r => setTimeout(r, delay));
      }
      log(`✅ PL追加完了 (エラー:${errorCount})`, '#00ff88');
    }

    // ─── 削除 ───
    if (isDelete) {
      if (errorCount > 0 && !confirm(`エラー ${errorCount} 件ありましたが削除しますか？`)) {
        log('⛔ 中止', '#ff5555'); return;
      }
      log('🗑️ 高評価取り消し開始', '#ff9800');
      let ok = 0, ng = 0;
      const failedList = [];
      for (let i = 0; i < videos.length; i++) {
        await waitIfPaused();
        checkCancel();
        if (i % 50 === 0 && i > 0) {
          try { await getHeaders(true); } catch (e) { log(`⚠️ header refresh err`, '#ff5555'); }
        }
        try {
          const res = await fetchWithRetry(makeUrl('like/removelike'), {
            method: 'POST', headers,
            body: JSON.stringify({ context, target: { videoId: videos[i].id } })
          });
          if (res.ok) ok++;
          else { ng++; failedList.push(videos[i].id); }
        } catch (e) {
          ng++; failedList.push(videos[i].id);
        }
        if ((i + 1) % 20 === 0 || i === videos.length - 1) {
          setProg(i + 1, videos.length, `削除: ${i + 1}/${videos.length} ✓${ok}`);
        }
        await new Promise(r => setTimeout(r, delay));
      }
      log(`🎉 完了 成功=${ok} 失敗=${ng}`, '#00ff88');
      // 失敗IDを保存
      if (failedList.length > 0) {
        chrome.storage?.local?.set({ failedIds: failedList }).catch(() => { });
      }
      alert(`完了!\n成功: ${ok}\n失敗: ${ng}\nリロードすると隠れていた動画が出現します。`);
    } else {
      log('🎉 全処理完了', '#00ff88');
    }

  } catch (e) {
    log(`❌ ${e.message}`, '#ff5555');
    console.error(e);
  }
}

async function runYoutubeReliker(videoIds, delay = 400, maxRetries = 3) {
  const getPanel = () => {
    let box = document.getElementById('yt-ext-log');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'yt-ext-log';
    box.style.cssText = 'position:fixed;bottom:16px;right:16px;width:400px;max-height:400px;background:rgba(0,30,10,0.97);color:#aaff88;padding:12px;font-size:12px;overflow-y:auto;z-index:99999;border-radius:10px;font-family:monospace;line-height:1.5;box-shadow:0 4px 20px rgba(0,0,0,0.5);border:1px solid #aaff88;';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #aaff88;';
    header.innerHTML = `
      <span style="font-weight:bold;">❤️ YT Restore</span>
      <span>
        <button id="yt-ext-pause" style="background:#f59e0b;border:none;color:white;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">⏸</button>
        <button id="yt-ext-cancel" style="background:#dc3545;border:none;color:white;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">⏹</button>
        <button id="yt-ext-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:14px;">✕</button>
      </span>
    `;
    box.appendChild(header);
    box.innerHTML += `
      <div style="width:100%;height:6px;background:#222;border-radius:3px;overflow:hidden;">
        <div id="yt-ext-progress" style="height:100%;width:0%;background:linear-gradient(90deg,#aaff88,#88ffcc);transition:width 0.3s;"></div>
      </div>
      <div id="yt-ext-progress-text" style="font-size:10px;color:#aaa;text-align:center;margin:4px 0 8px;"></div>
      <div id="yt-ext-logarea" style="max-height:250px;overflow-y:auto;"></div>
    `;
    document.body.appendChild(box);
    document.getElementById('yt-ext-close').onclick = () => box.remove();
    document.getElementById('yt-ext-pause').onclick = () => {
      window.__ytPaused = !window.__ytPaused;
      document.getElementById('yt-ext-pause').textContent = window.__ytPaused ? '▶' : '⏸';
    };
    document.getElementById('yt-ext-cancel').onclick = () => {
      if (confirm('中止しますか？')) window.__ytCancelled = true;
    };
    return box;
  };

  const log = (msg, color) => {
    console.log('[YT-Reliker]', msg);
    getPanel();
    const area = document.getElementById('yt-ext-logarea');
    if (!area) return;
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (color) line.style.color = color;
    area.appendChild(line);
    area.scrollTop = area.scrollHeight;
    while (area.children.length > 200) area.removeChild(area.firstChild);
  };

  const setProg = (c, t, l) => {
    const bar = document.getElementById('yt-ext-progress');
    const txt = document.getElementById('yt-ext-progress-text');
    if (bar) bar.style.width = `${(c / t) * 100}%`;
    if (txt) txt.textContent = l || `${c}/${t}`;
  };

  const waitIfPaused = async () => {
    while (window.__ytPaused && !window.__ytCancelled) await new Promise(r => setTimeout(r, 500));
  };
  const checkCancel = () => { if (window.__ytCancelled) throw new Error('ユーザー中止'); };

  const fetchWithRetry = async (url, options, retries = maxRetries) => {
    for (let a = 0; a <= retries; a++) {
      try {
        const res = await fetch(url, options);
        if (res.status === 429) {
          const w = parseInt(res.headers.get('Retry-After') || '10', 10) * 1000;
          log(`⏳ レート制限 ${w / 1000}s`, '#ff9800');
          await new Promise(r => setTimeout(r, w));
          continue;
        }
        if (res.status >= 500 && a < retries) {
          const w = 1000 * Math.pow(2, a);
          log(`⏳ ${res.status} ${w}ms`, '#ff9800');
          await new Promise(r => setTimeout(r, w));
          continue;
        }
        return res;
      } catch (e) {
        if (a >= retries) throw e;
        const w = 1000 * Math.pow(2, a);
        log(`⏳ NW err ${w}ms`, '#ff9800');
        await new Promise(r => setTimeout(r, w));
      }
    }
    throw new Error('リトライ上限');
  };

  try {
    window.__ytPaused = false;
    window.__ytCancelled = false;
    log(`🚀 復元開始 ${videoIds.length} 件`, '#aaff88');
    if (!window.ytcfg?.data_) throw new Error('ytcfg なし');
    const cfg = window.ytcfg.data_;
    const apiKey = cfg.INNERTUBE_API_KEY || null;
    const context = cfg.INNERTUBE_CONTEXT;
    const authUser = cfg.SESSION_INDEX || '0';
    const clientVersion = cfg.INNERTUBE_CLIENT_VERSION || '2.20250101.00.00';
    const makeUrl = p => apiKey
      ? `https://www.youtube.com/youtubei/v1/${p}?key=${apiKey}&prettyPrint=false`
      : `https://www.youtube.com/youtubei/v1/${p}?prettyPrint=false`;

    let cached = null, ts = 0;
    const getHeaders = async (force = false) => {
      const now = Math.floor(Date.now() / 1000);
      if (!force && cached && (now - ts) < 30) return cached;
      const m = document.cookie.match(/SAPISID=([^;]+)/);
      if (!m) throw new Error('SAPISID なし');
      const sap = decodeURIComponent(m[1]);
      const origin = window.location.origin;
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${now} ${sap} ${origin}`));
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      cached = {
        'Authorization': `SAPISIDHASH ${now}_${hash}`,
        'X-Origin': origin,
        'X-Goog-AuthUser': authUser,
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': clientVersion,
        'Content-Type': 'application/json'
      };
      ts = now;
      return cached;
    };

    let headers = await getHeaders();
    let ok = 0, ng = 0;
    const failed = [];
    const processed = [];

    for (let i = 0; i < videoIds.length; i++) {
      await waitIfPaused();
      checkCancel();
      if (i % 30 === 0 && i > 0) { headers = await getHeaders(true); log('🔑 header refresh'); }
      try {
        const res = await fetchWithRetry(makeUrl('like/like'), {
          method: 'POST', headers,
          body: JSON.stringify({ context, target: { videoId: videoIds[i] } })
        });
        if (res.ok) { ok++; processed.push(videoIds[i]); }
        else { ng++; failed.push(videoIds[i]); if (ng <= 10) log(`⚠️ HTTP ${res.status}: ${videoIds[i]}`, '#ff5555'); }
      } catch (e) {
        ng++; failed.push(videoIds[i]);
        log(`⚠️ ${videoIds[i]}: ${e.message}`, '#ff5555');
      }
      if ((i + 1) % 10 === 0 || i === videoIds.length - 1) {
        setProg(i + 1, videoIds.length, `${i + 1}/${videoIds.length} ✓${ok} ✗${ng}`);
      }
      await new Promise(r => setTimeout(r, delay));
    }
    log(`🎉 完了 成功:${ok} 失敗:${ng}`, '#aaff88');
    if (failed.length > 0) {
      log(`失敗ID: ${failed.slice(0, 5).join(', ')}...`, '#ff9800');
      chrome.storage?.local?.set({ failedIds: failed }).catch(() => { });
    } else {
      chrome.storage?.local?.remove('failedIds').catch(() => { });
    }
    chrome.storage?.local?.set({ processedIds: processed }).catch(() => { });
    alert(`完了!\n成功: ${ok}\n失敗: ${ng}`);
  } catch (e) {
    log(`❌ ${e.message}`, '#ff5555');
    console.error(e);
  }
}