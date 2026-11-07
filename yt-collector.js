// YouTube / YouTube Music 高評価コレクター
// 動画に「いいね」を付けたら、動画情報（id/タイトル/チャンネル/URL/日時）を
// background に送り、chrome.storage.local へ追記保存させる。
// いいねを外したら解除も送るので、保存データは現在の高評価と一致する。
// 既存の高評価リストページ（list=LL 等）では、ポップアップの
// 「📥 既存リストを取り込む」から現在のページ分を一括取り込みできる。
(() => {
  'use strict';

  const getVideoId = () => {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('v') || '';
    } catch {
      return '';
    }
  };

  const getTitle = () => {
    const h1 = document.querySelector(
      'h1.ytd-watch-metadata, h1.ytd-video-info, #video-title, .ytmusic-player-bar .title, h1'
    );
    const t = (h1?.textContent || '').trim();
    if (t) return t;
    const og = document.querySelector('meta[property="og:title"]')?.content || '';
    return og.replace(/\s*-\s*(YouTube|YouTube Music)\s*$/, '').trim()
      || document.title.replace(/\s*-\s*(YouTube|YouTube Music)\s*$/, '').trim() || '';
  };

  const getChannel = () => {
    const ch = document.querySelector(
      '#channel-name a, ytd-channel-name a, .ytmusic-player-bar .channel-name, tp-yt-paper-item a'
    );
    return (ch?.textContent || '').trim();
  };

  // クリック直後の状態で「現在いいねされているか」を判定する
  // YouTube 本家: ボタンに aria-pressed="true"（Return YouTube Dislike もこれを正とする）
  // YouTube Music: ytmusic-like-button-renderer の like-status 属性が "LIKE"
  const isLiked = (button) => {
    if (!button) return false;
    const inner = button.querySelector?.('button[aria-pressed]') || button;
    if (inner.getAttribute?.('aria-pressed') === 'true') return true;
    if (button.classList?.contains('style-default-active')) return true;
    const renderer = button.closest(
      'ytd-segmented-like-dislike-button-renderer, ytd-like-button-renderer, ytmusic-like-button-renderer'
    );
    if (renderer) {
      if (renderer.getAttribute?.('like-status') === 'LIKE') return true;
      if (renderer.querySelector?.('[aria-pressed="true"]')) return true;
      if (renderer.classList?.contains('liked')) return true;
    }
    return false;
  };

  const send = (type, liked) => {
    const id = getVideoId();
    if (!id) return;
    chrome.runtime.sendMessage({
      type,
      video: {
        id,
        title: getTitle(),
        channel: getChannel(),
        url: `https://www.youtube.com/watch?v=${id}`,
        likedAt: liked ? Date.now() : null,
      },
    }).catch(() => { /* background 未起動等は無視 */ });
  };

  // いいねボタンのクリックを捕捉（イベント委譲で SPA 遷移後も追随）
  // YouTube 本家は #segmented-like-button、Shorts は #like-button、
  // Music は ytmusic-like-button-renderer / #like-button / #like-button-view 等に分散する。
  const LIKE_SELECTOR =
    '#segmented-like-button button, #like-button button, #like-button, like-button-view-model button, ytmusic-like-button-renderer button, ytmusic-like-button-renderer, #like-button-view button, [role="button"][aria-label*="いいね"], [aria-label*="いいね"]';
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.(LIKE_SELECTOR);
    if (!button) return;
    // Music は状態反映が遅いので最大2秒ポーリングし、最後の状態で確定する
    const started = Date.now();
    const tick = () => {
      try {
        if (isLiked(button)) { send('yt-liked', true); return; }
        if (Date.now() - started > 2000) { send('yt-unliked', false); return; }
        setTimeout(tick, 300);
      } catch { /* ignore */ }
    };
    setTimeout(tick, 350);
  }, true);

  // 既存リストページの一括取り込み（ポップアップから要求される）
  // 目的: YouTube の高評価は5000件までしか残らないため、見えている分を
  // ローカル台帳へ逃がす。ページを自動スクロールしながら収集する。
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const collectVisibleVideos = () => {
    const found = [];
    for (const a of document.querySelectorAll('a[href*="watch?v="], a#video-title[href]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/[?&]v=([\w-]{6,20})/);
      if (!m) continue;
      found.push({
        id: m[1],
        title: (a.textContent || a.getAttribute('title') || '').trim() || m[1],
        channel: '',
        url: `https://www.youtube.com/watch?v=${m[1]}`,
        likedAt: Date.now(),
      });
    }
    return found;
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'yt-collect-page') return false;
    (async () => {
      try {
        const byId = new Map();
        const merge = () => {
          for (const v of collectVisibleVideos()) {
            if (!byId.has(v.id)) byId.set(v.id, v);
          }
        };
        merge();

        // 自動スクロールで読み込み（最大約2分。新規が止まったら終了）
        let noNewStreak = 0;
        for (let step = 0; step < 150 && noNewStreak < 6; step++) {
          const prev = byId.size;
          window.scrollTo(0, document.documentElement.scrollHeight);
          await sleep(800);
          merge();
          noNewStreak = byId.size === prev ? noNewStreak + 1 : 0;
        }
        window.scrollTo(0, 0);

        const videos = [...byId.values()];
        if (!videos.length) {
          sendResponse({ ok: false, error: 'このページに動画が見つかりませんでした' });
          return;
        }
        const r = await chrome.runtime.sendMessage({ type: 'yt-import', videos });
        sendResponse({ ok: true, imported: videos.length, total: r?.count ?? 0 });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });
})();
