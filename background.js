chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'scheduledBackup') {
        const s = await chrome.storage.local.get('cfg-schedule');
        if (!s['cfg-schedule']) return;
        try {
            await chrome.notifications.create({
                type: 'basic', title: '定期バックアップ',
                message: 'ポップアップを開いてバックアップを実行してください', priority: 1
            });
        } catch (e) { console.warn(e); }
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        try {
            if (msg.type === 'notify') {
                await chrome.notifications.create({ type: 'basic', title: msg.title, message: msg.message, priority: 1 });
                sendResponse({ ok: true });
            } else if (msg.type === 'setSchedule') {
                if (msg.enabled) {
                    await chrome.alarms.create('scheduledBackup', { periodInMinutes: msg.intervalMinutes || 10080 });
                } else {
                    await chrome.alarms.clear('scheduledBackup');
                }
                sendResponse({ ok: true });
            } else {
                sendResponse({});
            }
        } catch (e) { sendResponse({ error: e.message }); }
    })();
    return true;
});