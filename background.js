// =========================================================================
//  Background Service Worker v4.0
// =========================================================================

// 通知
async function notify(title, message) {
    try {
        await chrome.notifications.create({
            type: 'basic',
            title,
            message,
            priority: 1
        });
    } catch (e) {
        console.warn('通知失敗:', e);
    }
}

// アラーム
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'scheduledBackup') {
        const s = await chrome.storage.local.get('cfg-schedule');
        if (!s['cfg-schedule']) return;
        await notify('定期バックアップ', 'バックアップを実行します');
    }
});

// インストール
chrome.runtime.onInstalled.addListener(async () => {
    await chrome.storage.local.set({
        installedAt: Date.now(),
        version: chrome.runtime.getManifest().version
    });
});

// キーボードショートカット
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'quick-backup') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    // popupを開く代わりにメッセージを送る
                    chrome.runtime.sendMessage({ action: 'quickBackup' });
                }
            }).catch(() => { });
        }
        await notify('クイックバックアップ', 'バックアップを開始します');
    }
    if (command === 'save-tabs') {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const session = {
            name: `タブ_${new Date().toLocaleString('ja')}`,
            savedAt: Date.now(),
            tabs: tabs.map(t => ({ title: t.title, url: t.url }))
        };
        const { tabSessions } = await chrome.storage.local.get('tabSessions');
        const sessions = tabSessions || [];
        sessions.unshift(session);
        if (sessions.length > 30) sessions.length = 30;
        await chrome.storage.local.set({ tabSessions: sessions });
        await notify('タブ保存完了', `${tabs.length}個のタブを保存しました`);
    }
});

// メッセージハンドラ
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        try {
            switch (msg.type) {
                case 'notify':
                    await notify(msg.title, msg.message);
                    sendResponse({ ok: true });
                    break;
                case 'setSchedule':
                    if (msg.enabled) {
                        await chrome.alarms.create('scheduledBackup', { periodInMinutes: msg.intervalMinutes || 10080 });
                    } else {
                        await chrome.alarms.clear('scheduledBackup');
                    }
                    sendResponse({ ok: true });
                    break;
                default:
                    sendResponse({ error: 'unknown' });
            }
        } catch (e) {
            sendResponse({ error: e.message });
        }
    })();
    return true;
});