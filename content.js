// ── URL Parameter Cleaner ─────────────────────────────────────
// ナビゲーション時にトラッキング・不要URLパラメータをサイレントに削除する。
// history.replaceState を使うためページリロードは発生しない。

const UNIVERSAL = new Set([
    // UTM (全サイト共通)
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
    // Google Ads
    'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
    // Meta / Facebook
    'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_ref', 'fb_source',
    // Twitter / X
    'twclid',
    // Microsoft Ads
    'msclkid',
    // HubSpot
    '_hsenc', '_hsmi', 'hsCtaTracking',
    // Mailchimp
    'mc_cid', 'mc_eid',
    // Instagram
    'igshid',
    // Spotify
    'si',
    // Google Analytics クロスドメイン
    '_ga', '_gl',
    // Google Shopping
    'srsltid',
    // アフィリエイト汎用
    'zanpid', 'affiliate_id', 'aff_id', 'ref_src',
]);

// サイト別: 該当ホスト名でのみ削除するパラメータ
const SITE = new Map([
    ['www.google.com', new Set(['ved', 'ei', 'gs_lp', 'gs_ivs', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei', 'biw', 'bih', 'oq'])],
    ['google.com', new Set(['ved', 'ei', 'gs_lp', 'gs_ivs', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei'])],
    ['www.google.co.jp', new Set(['ved', 'ei', 'gs_lp', 'gs_ivs', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei', 'biw', 'bih', 'oq'])],
    ['google.co.jp', new Set(['ved', 'ei', 'gs_lp', 'gs_ivs', 'gs_lcrp', 'uact', 'sa', 'rlz', 'gbv', 'sei'])],
    ['www.youtube.com', new Set(['feature', 'ab_channel', 'pp'])],
    ['youtube.com', new Set(['feature', 'ab_channel', 'pp'])],
    ['twitter.com', new Set(['src', 's'])],
    ['x.com', new Set(['src', 's'])],
    ['www.amazon.co.jp', new Set(['ref', 'ref_', 'linkCode', 'tag', 'camp', 'creative', 'creativeASIN', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pf_rd_p', 'pf_rd_r', 'psc', 'spLa', 'th', 'smid'])],
    ['www.amazon.com', new Set(['ref', 'ref_', 'linkCode', 'tag', 'camp', 'creative', 'creativeASIN', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pf_rd_p', 'pf_rd_r', 'psc', 'spLa'])],
    ['item.rakuten.co.jp', new Set(['scid', 'sc2id'])],
    ['search.rakuten.co.jp', new Set(['scid', 'sc2id'])],
    ['www.rakuten.co.jp', new Set(['scid', 'sc2id'])],
    ['news.yahoo.co.jp', new Set(['source', 'icpg'])],
    ['www.nicovideo.jp', new Set(['ref'])],
]);

function cleanUrl() {
    try {
        const url = new URL(location.href);
        if (!['http:', 'https:'].includes(url.protocol)) return;

        const siteParams = SITE.get(url.hostname) || new Set();
        const toDelete = [];

        for (const key of url.searchParams.keys()) {
            if (UNIVERSAL.has(key) || siteParams.has(key) || key.startsWith('utm_')) {
                toDelete.push(key);
            }
        }
        if (!toDelete.length) return;

        toDelete.forEach(k => url.searchParams.delete(k));

        const newUrl = url.searchParams.size === 0
            ? url.origin + url.pathname + url.hash
            : url.toString();

        if (newUrl !== location.href) history.replaceState(null, '', newUrl);
    } catch (e) { /* parse error などは無視 */ }
}

// ── 初回実行 ─────────────────────────────────────────────────
cleanUrl();

// ── SPA対応: pushState をフック ──────────────────────────────
const _push = history.pushState.bind(history);
history.pushState = function (...args) { _push(...args); setTimeout(cleanUrl, 0); };

// ── 戻る/進む ────────────────────────────────────────────────
window.addEventListener('popstate', cleanUrl);