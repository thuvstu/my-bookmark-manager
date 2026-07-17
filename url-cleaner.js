(async () => {
    'use strict';
    let config = { enabled: true, logEnabled: false, excludeDomains: new Set() };
    try {
        const s = await chrome.storage.local.get(['cfg-url-enabled', 'cfg-url-log', 'cfg-url-exclude']);
        config.enabled = s['cfg-url-enabled'] !== false;
        config.logEnabled = s['cfg-url-log'] === true;
        if (s['cfg-url-exclude']) config.excludeDomains = new Set(s['cfg-url-exclude'].split('\n').map(x => x.trim()).filter(Boolean));
    } catch { }
    if (!config.enabled) return;

    const UNIVERSAL = new Set([
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
        'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_ref', 'fb_source',
        'twclid', 'msclkid', '_hsenc', '_hsmi', 'hsCtaTracking', 'mc_cid', 'mc_eid', 'igshid', 'si', '_ga', '_gl', 'srsltid',
        'zanpid', 'affiliate_id', 'aff_id', 'ref_src', 'yclid', 'ncid', 'trk', 'trkCampaign',
        '__s', 'vero_id', 'vero_conv', 'mkt_tok', 'ml_subscriber', 'ml_subscriber_hash',
        'oly_anon_id', 'oly_enc_id', 'wickedid', 'sb_referer_host', 'redirect_log_mongo_id'
    ]);

    const SITE = new Map([
        ['www.google.com', new Set(['ved', 'ei', 'gs_lp', 'gs_ivs', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei', 'biw', 'bih', 'oq', 'source', 'sxsrf'])],
        ['google.com', new Set(['ved', 'ei', 'gs_lp', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei'])],
        ['www.google.co.jp', new Set(['ved', 'ei', 'gs_lp', 'gs_ivs', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei', 'biw', 'bih', 'oq', 'sxsrf'])],
        ['google.co.jp', new Set(['ved', 'ei', 'gs_lp', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei'])],
        ['www.youtube.com', new Set(['feature', 'ab_channel', 'pp'])],
        ['youtube.com', new Set(['feature', 'ab_channel', 'pp'])],
        ['twitter.com', new Set(['src', 's', 'ref_src', 'ref_url'])],
        ['x.com', new Set(['src', 's', 'ref_src', 'ref_url'])],
        ['www.amazon.co.jp', new Set(['ref', 'ref_', 'linkCode', 'tag', 'camp', 'creative', 'creativeASIN', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pf_rd_p', 'pf_rd_r', 'psc', 'spLa', 'th', 'smid', 'qid', 'sr'])],
        ['www.amazon.com', new Set(['ref', 'ref_', 'linkCode', 'tag', 'camp', 'creative', 'creativeASIN', 'pd_rd_r', 'pd_rd_w', 'pf_rd_p', 'pf_rd_r', 'psc', 'spLa', 'qid', 'sr'])],
        ['item.rakuten.co.jp', new Set(['scid', 'sc2id', 'rafcid'])],
        ['search.rakuten.co.jp', new Set(['scid', 'sc2id', 'rafcid'])],
        ['news.yahoo.co.jp', new Set(['source', 'icpg'])],
        ['www.nicovideo.jp', new Set(['ref'])],
        ['bing.com', new Set(['form', 'qs', 'pq', 'sc', 'sp', 'cvid'])],
        ['www.bing.com', new Set(['form', 'qs', 'pq', 'sc', 'sp', 'cvid'])],
        ['duckduckgo.com', new Set(['t', 'ia', 'iax', 'atb'])],
        ['linkedin.com', new Set(['trk', 'trkInfo', 'lipi', 'refId'])],
    ]);

    let cleanedCount = 0;
    const updateStats = async () => {
        if (!cleanedCount) return;
        try {
            const today = new Date().toISOString().slice(0, 10);
            const s = await chrome.storage.local.get(['urlStatsToday', 'stats']);
            const cur = (s.urlStatsToday?.date === today) ? s.urlStatsToday.count : 0;
            await chrome.storage.local.set({
                urlStatsToday: { date: today, count: cur + cleanedCount },
                stats: { ...(s.stats || {}), urlCleaned: (s.stats?.urlCleaned || 0) + cleanedCount }
            });
            cleanedCount = 0;
        } catch { }
    };
    setInterval(updateStats, 30000);
    window.addEventListener('beforeunload', updateStats);

    const cleanUrl = () => {
        try {
            const loc = window.location;
            if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return;
            if (config.excludeDomains.has(loc.hostname)) return;
            const search = loc.search;
            if (!search || search === '?') return;

            const siteParams = SITE.get(loc.hostname);
            const url = new URL(loc.href);
            const toDelete = [];
            for (const key of url.searchParams.keys()) {
                if (UNIVERSAL.has(key) || key.startsWith('utm_') || key.startsWith('fb_') || key.startsWith('_hs') || (siteParams && siteParams.has(key))) {
                    toDelete.push(key);
                }
            }
            if (!toDelete.length) return;
            if (config.logEnabled) console.log(`[URL Cleaner] ${toDelete.join(', ')}`);
            toDelete.forEach(k => url.searchParams.delete(k));
            const newUrl = url.searchParams.size === 0 ? url.origin + url.pathname + url.hash : url.toString();
            if (newUrl !== loc.href) { history.replaceState(null, '', newUrl); cleanedCount += toDelete.length; }
        } catch { }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cleanUrl, { once: true });
    else cleanUrl();

    const _push = history.pushState, _rep = history.replaceState;
    let scheduled = false;
    const schedule = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; cleanUrl(); }); };
    history.pushState = function (...a) { _push.apply(this, a); schedule(); };
    history.replaceState = function (...a) { _rep.apply(this, a); schedule(); };
    window.addEventListener('popstate', cleanUrl);
    window.addEventListener('hashchange', cleanUrl);
    if (window.navigation) window.navigation.addEventListener('navigate', () => setTimeout(cleanUrl, 50));
})();