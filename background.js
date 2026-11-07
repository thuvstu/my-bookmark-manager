'use strict';

// ================================================================
// Bookmark Suite – service worker
// ================================================================

const netscapeHead =
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
    '<TITLE>Bookmarks</TITLE>\n' +
    '<H1>Bookmarks</H1>\n' +
    '<DL><p>\n';

const escapeText = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const notify = async (title, message) => {
    try {
        await chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title,
            message,
            priority: 1
        });
    } catch (error) {
        console.warn('notify failed:', error);
    }
};

// ── quick backup (bookmarks + reading list → Netscape HTML) ────

async function quickBackup() {
    try {
        const tree = await chrome.bookmarks.getTree();

        let html = netscapeHead;
        let count = 0;

        const walk = node => {
            if (node.url) {
                html +=
                    `        <DT><A HREF="${escapeText(node.url)}" ` +
                    `ADD_DATE="${Math.floor((node.dateAdded || 0) / 1000)}">` +
                    `${escapeText(node.title)}</A>\n`;

                count += 1;
                return;
            }

            html +=
                `    <DT><H3>${escapeText(node.title || 'Folder')}</H3>\n` +
                '    <DL><p>\n';

            for (const child of node.children || []) {
                walk(child);
            }

            html += '    </DL><p>\n';
        };

        for (const child of tree[0]?.children || []) {
            walk(child);
        }

        try {
            const items = await chrome.readingList.query({});

            if (items.length) {
                html += '    <DT><H3>Reading List</H3>\n    <DL><p>\n';

                for (const item of items) {
                    html +=
                        `        <DT><A HREF="${escapeText(item.url)}" ` +
                        `ADD_DATE="${Math.floor((item.creationTime || 0) / 1000)}">` +
                        `${escapeText(item.title)}</A>\n`;

                    count += 1;
                }

                html += '    </DL><p>\n';
            }
        } catch (e) {
            // readingList unavailable – log so failures aren't silent
            console.warn('RL quickBackup query failed:', e?.message || e);
        }

        html += '</DL><p>\n';

        const blobUrl = URL.createObjectURL(
            new Blob([html], { type: 'text/html;charset=utf-8' })
        );

        const stamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, '-');

        await chrome.downloads.download({
            url: blobUrl,
            filename: `bookmark_suite_quick_backup_${stamp}.html`,
            saveAs: false,
            conflictAction: 'uniquify'
        });

        setTimeout(() => URL.revokeObjectURL(blobUrl), 20000);

        const settings = await chrome.storage.local.get('cfg-notify');

        if (settings['cfg-notify'] !== false) {
            await notify('Bookmark Suite', `クイックバックアップ完了（${count}件）`);
        }

        await updateStats('bmTotal', count);
    } catch (error) {
        console.error('quickBackup failed:', error);
        await notify('Bookmark Suite', `バックアップ失敗: ${error.message}`);
    }
}

// ── save open tabs into a bookmarks folder ─────────────────────

async function saveOpenTabs() {
    try {
        const tabs = await chrome.tabs.query({ currentWindow: true });

        const targets = tabs.filter(
            tab => tab.url && /^https?:/i.test(tab.url)
        );

        if (!targets.length) {
            await notify('Bookmark Suite', '保存できるタブがありません');
            return;
        }

        const folder = await chrome.bookmarks.create({
            parentId: '2',
            title: `保存したタブ ${new Date().toLocaleString('ja-JP')}`
        });

        let created = 0;

        for (const tab of targets) {
            try {
                await chrome.bookmarks.create({
                    parentId: folder.id,
                    title:
                        (tab.title || tab.url).slice(0, 250),
                    url: tab.url
                });

                created += 1;
            } catch {
                // skip duplicates/errors per tab.
            }
        }

        await notify('Bookmark Suite', `${created}件のタブをブックマークしました`);
        await updateStats('runs', 1);
    } catch (error) {
        console.error('saveOpenTabs failed:', error);
        await notify('Bookmark Suite', `タブ保存失敗: ${error.message}`);
    }
}

const openEditor = () => {
    chrome.tabs.create({
        url: chrome.runtime.getURL('index.html')
    });
};

// ── stats helper ───────────────────────────────────────────────

async function updateStat(key, inc) {
    try {
        const { stats } = await chrome.storage.local.get('stats');
        const next = { ...(stats || {}) };

        next[key] = (next[key] || 0) + (inc || 1);
        next.lastRun = Date.now();

        await chrome.storage.local.set({ stats: next });
    } catch {
        // stats are best-effort.
    }
}
const updateStats = updateStat;

// ── keyboard commands ──────────────────────────────────────────

chrome.commands?.onCommand.addListener(command => {
    if (command === 'quick-backup') {
        quickBackup();
    } else if (command === 'save-tabs') {
        saveOpenTabs();
    } else if (command === 'open-editor') {
        openEditor();
    }
});

// ── scheduled backup reminder ──────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {
    if (alarm.name !== 'scheduledBackup') return;

    const settings = await chrome.storage.local.get('cfg-schedule');

    if (!settings['cfg-schedule']) return;

    await notify(
        '定期バックアップ',
        'Bookmark Suite ポップアップからバックアップを実行してください'
    );
});

// ── YouTube 高評価コレクター ──────────────────────────────────
// yt-collector.js から届く「いいね付け/解除」を chrome.storage.local へ追記保存する。
// 「ファイルとして保存」は storage 内データを JSON/HTML でエクスポートする形で実現する。
const YT_LIKED_KEY = 'ytLiked';
const YT_LIKED_LIMIT = 5000;

async function getYtLiked() {
    const { [YT_LIKED_KEY]: list } = await chrome.storage.local.get(YT_LIKED_KEY);
    return Array.isArray(list) ? list : [];
}

async function saveYtLiked(list) {
    // 上限超過時は古いものから切り捨てる
    const capped = list.length > YT_LIKED_LIMIT
        ? list.slice(list.length - YT_LIKED_LIMIT)
        : list;
    await chrome.storage.local.set({ [YT_LIKED_KEY]: capped });
}

async function ytAddLiked(video) {
    if (!video?.id) return { ok: false };
    const list = await getYtLiked();
    const existing = list.find(v => v.id === video.id);
    if (existing) {
        existing.title = video.title || existing.title;
        existing.channel = video.channel || existing.channel;
        existing.url = video.url || existing.url;
        existing.likedAt = video.likedAt || Date.now();
    } else {
        list.push({
            id: video.id,
            title: video.title || 'Untitled',
            channel: video.channel || '',
            url: video.url || `https://www.youtube.com/watch?v=${video.id}`,
            likedAt: video.likedAt || Date.now()
        });
    }
    await saveYtLiked(list);
    await updateStat('ytCollected', 0);
    return { ok: true, count: list.length };
}

async function ytRemoveLiked(video) {
    if (!video?.id) return { ok: false };
    const next = (await getYtLiked()).filter(v => v.id !== video.id);
    await saveYtLiked(next);
    return { ok: true, count: next.length };
}

// 既存の高評価リスト等から複数件をまとめて取り込む（重複は統合）
async function ytImportLiked(videos) {
    if (!Array.isArray(videos) || !videos.length) return { ok: false, error: '動画がありません' };
    const list = await getYtLiked();
    const byId = new Map(list.map(v => [v.id, v]));
    let added = 0;
    for (const video of videos) {
        if (!video?.id) continue;
        if (byId.has(video.id)) {
            const e = byId.get(video.id);
            e.title = video.title || e.title;
            e.channel = video.channel || e.channel;
            e.url = video.url || e.url;
        } else {
            byId.set(video.id, {
                id: video.id,
                title: video.title || 'Untitled',
                channel: video.channel || '',
                url: video.url || `https://www.youtube.com/watch?v=${video.id}`,
                likedAt: video.likedAt || Date.now()
            });
            added += 1;
        }
    }
    const next = [...byId.values()];
    await saveYtLiked(next);
    await updateStat('ytCollected', 0);
    return { ok: true, added, count: next.length };
}

// ── messages from popup / pages ────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        try {
            switch (message?.type) {
                case 'notify':
                    await notify(message.title, message.message);
                    sendResponse({ ok: true });
                    break;

                case 'setSchedule':
                    if (message.enabled) {
                        await chrome.alarms.create('scheduledBackup', {
                            periodInMinutes: message.intervalMinutes || 10080
                        });
                    } else {
                        await chrome.alarms.clear('scheduledBackup');
                    }

                    sendResponse({ ok: true });
                    break;

                case 'quick-backup':
                    await quickBackup();
                    sendResponse({ ok: true });
                    break;

                case 'yt-liked':
                    sendResponse(await ytAddLiked(message.video));
                    break;

                case 'yt-unliked':
                    sendResponse(await ytRemoveLiked(message.video));
                    break;

                case 'yt-import':
                    sendResponse(await ytImportLiked(message.videos));
                    break;

                case 'yt-list':
                    sendResponse({ ok: true, videos: await getYtLiked() });
                    break;

                case 'yt-clear':
                    await saveYtLiked([]);
                    sendResponse({ ok: true });
                    break;

                default:
                    sendResponse({});
                    break;
            }
        } catch (error) {
            sendResponse({ error: error.message });
        }
    })();

    return true;
});

// ── first install → open the editor ────────────────────────────

chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install') {
        openEditor();
    }
});
