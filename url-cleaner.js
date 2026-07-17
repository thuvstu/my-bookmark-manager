// =========================================================================
//  URL Parameter Cleaner v3.0
//  除外リスト対応、統計機能、動的パラメータ検出
// =========================================================================

(async () => {
    'use strict';

    // ─── 設定読み込み ───
    let config = {
        enabled: true,
        logEnabled: false,
        excludeDomains: new Set()
    };

    try {
        const s = await chrome.storage.local.get(['cfg-url-enabled', 'cfg-url-log', 'cfg-url-exclude']);
        config.enabled = s['cfg-url-enabled'] !== false;
        config.logEnabled = s['cfg-url-log'] === true;
        if (s['cfg-url-exclude']) {
            config.excludeDomains = new Set(
                s['cfg-url-exclude'].split('\n').map(x => x.trim()).filter(Boolean)
            );
        }
    } catch { }

    if (!config.enabled) return;

    // ─── 削除対象定義 ───
    const UNIVERSAL = new Set([
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
        'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
        'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_ref', 'fb_source',
        'twclid', 'msclkid',
        '_hsenc', '_hsmi', 'hsCtaTracking',
        'mc_cid', 'mc_eid', 'igshid', 'si',
        '_ga', '_gl', 'srsltid',
        'zanpid', 'affiliate_id', 'aff_id', 'ref_src',
        'yclid', 'ncid', 'trk', 'trkCampaign',
        '__s', 'vero_id', 'vero_conv',
        'mkt_tok', 'ml_subscriber', 'ml_subscriber_hash',
        'oly_anon_id', 'oly_enc_id',
        'wickedid', 'redirect_log_mongo_id', 'redirect_mongo_id',
        'sb_referer_host'
    ]);

    const UTM_PREFIX = /^utm_/;
    const FBP_PREFIX = /^fb_/;
    const HS_PREFIX = /^_hs/;

    const SITE = new Map([
        ['www.google.com', ['ved', 'ei', 'gs_lp', 'gs_ivs', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei', 'biw', 'bih', 'oq', 'source', 'source_hp', 'sxsrf', 'oq']],
        ['google.com', ['ved', 'ei', 'gs_lp', 'gs_ivs', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei']],
        ['www.google.co.jp', ['ved', 'ei', 'gs_lp', 'gs_ivs', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei', 'biw', 'bih', 'oq', 'source', 'source_hp', 'sxsrf']],
        ['google.co.jp', ['ved', 'ei', 'gs_lp', 'gs_ivs', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei']],
        ['www.youtube.com', ['feature', 'ab_channel', 'pp']],
        ['youtube.com', ['feature', 'ab_channel', 'pp']],
        ['twitter.com', ['src', 's', 'ref_src', 'ref_url']],
        ['x.com', ['src', 's', 'ref_src', 'ref_url']],
        ['www.amazon.co.jp', ['ref', 'ref_', 'linkCode', 'tag', 'camp', 'creative', 'creativeASIN', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pf_rd_p', 'pf_rd_r', 'psc', 'spLa', 'th', 'smid', 'qid', 'sr', '_encoding']],
        ['www.amazon.com', ['ref', 'ref_', 'linkCode', 'tag', 'camp', 'creative', 'creativeASIN', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pf_rd_p', 'pf_rd_r', 'psc', 'spLa', 'qid', 'sr']],
        ['item.rakuten.co.jp', ['scid', 'sc2id', 'rafcid', 's-id', 'l-id']],
        ['search.rakuten.co.jp', ['scid', 'sc2id', 'rafcid']],
        ['www.rakuten.co.jp', ['scid', 'sc2id']],
        ['news.yahoo.co.jp', ['source', 'icpg']],
        ['www.nicovideo.jp', ['ref']],
        ['bing.com', ['form', 'qs', 'pq', 'sc', 'sp', 'cvid']],
        ['www.bing.com', ['form', 'qs', 'pq', 'sc', 'sp', 'cvid']],
        ['duckduckgo.com', ['t', 'ia', 'iax', 'iaxm', 'atb']],
        ['linkedin.com', ['trk', 'trkInfo', 'lipi', 'refId']],
        ['www.linkedin.com', ['trk', 'trkInfo', 'lipi', 'refId']]
    ]);

    const siteCache = new Map();
    for (const [host, keys] of SITE) {
        siteCache.set(host, new Set(keys));
    }

    const getSiteParams = (h) => siteCache.get(h);
    const isExcluded = (h) => {
        if (config.excludeDomains.has(h)) return true;
        // 部分一致
        for (const d of config.excludeDomains) {
            if (h.endsWith('.' + d) || h === d) return true;
        }
        return false;
    };

    // ─── 統計 ───
    let cleanedCount = 0;
    const updateStats = async () => {
        if (cleanedCount === 0) return;
        try {
            const today = new Date().toISOString().slice(0, 10);
            const { urlStatsToday, stats } = await chrome.storage.local.get(['urlStatsToday', 'stats']);
            const cur = (urlStatsToday && urlStatsToday.date === today)
                ? urlStatsToday.count : 0;
            await chrome.storage.local.set({
                urlStatsToday: { date: today, count: cur + cleanedCount },
                stats: { ...(stats || {}), urlCleaned: (stats?.urlCleaned || 0) + cleanedCount }
            });
            cleanedCount = 0;
        } catch { }
    };

    // 定期的に統計送信
    setInterval(updateStats, 30000);
    window.addEventListener('beforeunload', updateStats);

    // ─── メイン処理 ───
    const cleanUrl = () => {
        try {
            const loc = window.location;
            if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return;
            if (isExcluded(loc.hostname)) return;
            const search = loc.search;
            if (!search || search === '?') return;

            const siteParams = getSiteParams(loc.hostname);
            const url = new URL(loc.href);
            const toDelete = [];

            for (const key of url.searchParams.keys()) {
                if (UNIVERSAL.has(key)
                    || UTM_PREFIX.test(key)
                    || FBP_PREFIX.test(key)
                    || HS_PREFIX.test(key)
                    || (siteParams && siteParams.has(key))) {
                    toDelete.push(key);
                }
            }

            if (toDelete.length === 0) return;

            if (config.logEnabled) {
                console.log(`[URL Cleaner] Removed: ${toDelete.join(', ')}`);
            }

            for (const k of toDelete) url.searchParams.delete(k);
            const newUrl = url.searchParams.size === 0
                ? url.origin + url.pathname + url.hash
                : url.toString();

            if (newUrl !== loc.href) {
                history.replaceState(null, '', newUrl);
                cleanedCount += toDelete.length;
            }
        } catch { }
    };

    // 初回
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cleanUrl, { once: true });
    } else {
        cleanUrl();
    }

    // SPA対応
    const _push = history.pushState;
    const _rep = history.replaceState;
    let scheduled = false;
    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; cleanUrl(); });
    };
    history.pushState = function (...a) { _push.apply(this, a); schedule(); };
    history.replaceState = function (...a) { _rep.apply(this, a); schedule(); };
    window.addEventListener('popstate', cleanUrl);
    window.addEventListener('hashchange', cleanUrl);
    if (window.navigation) {
        window.navigation.addEventListener('navigate', () => setTimeout(cleanUrl, 50));
    }
})();