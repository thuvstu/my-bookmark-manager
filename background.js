// =========================================================================
//  Background Service Worker
//  スケジュール実行・通知・状態管理を担当
// =========================================================================

// ─── 通知ヘルパー ───
async function notify(title, message, type = 'basic') {
    try {
        await chrome.notifications.create({
            type,
            iconUrl: 'icon128.png',
            title,
            message,
            priority: 1
        });
    } catch (e) {
        console.warn('通知失敗:', e);
    }
}

// ─── 定期バックアップアラーム ───
chrome.runtime.onInstalled.addListener(async () => {
    await chrome.storage.local.set({
        installedAt: Date.now(),
        version: chrome.runtime.getManifest().version
    });
});

// ─── アラームハンドラ ───
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'scheduledBackup') {
        const settings = await chrome.storage.local.get(['scheduleEnabled', 'scheduleTargets']);
        if (!settings.scheduleEnabled) return;

        console.log('[Scheduled Backup] 開始');
        await notify('定期バックアップ', 'バックアップを実行します...');
        // 実際のバックアップはpopup経由が必要なので通知のみ
    }
});

// ─── メッセージハンドラ ───
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        switch (msg.type) {
            case 'notify':
                await notify(msg.title, msg.message);
                sendResponse({ ok: true });
                break;
            case 'setSchedule':
                if (msg.enabled) {
                    await chrome.alarms.create('scheduledBackup', {
                        periodInMinutes: msg.intervalMinutes || 10080 // デフォルト週1
                    });
                } else {
                    await chrome.alarms.clear('scheduledBackup');
                }
                sendResponse({ ok: true });
                break;
            case 'getStats':
                const stats = await chrome.storage.local.get('stats');
                sendResponse({ stats: stats.stats || {} });
                break;
            case 'updateStats':
                const cur = await chrome.storage.local.get('stats');
                const newStats = { ...(cur.stats || {}), ...msg.data };
                await chrome.storage.local.set({ stats: newStats });
                sendResponse({ ok: true });
                break;
            default:
                sendResponse({ error: 'unknown message' });
        }
    })();
    return true; // async response
});