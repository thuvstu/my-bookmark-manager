'use strict';

/* ================================================================
   Bookmark Suite – shared bookmark parser worker
   Parses Netscape bookmark HTML / JSON trees off the main thread.
================================================================ */

const decodeEntities = source => String(source ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code) =>
        String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
        String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getAttribute = (attributes, name) => {
    const pattern = new RegExp(
        `${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
        'i'
    );

    const match = String(attributes ?? '').match(pattern);

    return decodeEntities(
        match?.[1] ??
        match?.[2] ??
        match?.[3] ??
        ''
    );
};

const parseHtml = html => {
    const root = [];
    const stack = [root];

    let pendingFolder = null;

    const tokenPattern =
        /<DL\b[^>]*>|<\/DL\s*>|<H3\b([^>]*)>([\s\S]*?)<\/H3\s*>|<A\b([^>]*)>([\s\S]*?)<\/A\s*>/gi;

    let match;

    while ((match = tokenPattern.exec(html)) !== null) {
        const token = match[0];

        if (/^<DL\b/i.test(token)) {
            if (pendingFolder) {
                stack.push(pendingFolder.children);
                pendingFolder = null;
            }

            continue;
        }

        if (/^<\/DL/i.test(token)) {
            if (stack.length > 1) stack.pop();
            continue;
        }

        if (match[2] !== undefined) {
            const folder = {
                type: 'folder',
                title: decodeEntities(match[2]) || 'Folder',
                addDate: Number(
                    getAttribute(match[1], 'add_date')
                ) || Math.floor(Date.now() / 1000),
                children: []
            };

            stack.at(-1).push(folder);
            pendingFolder = folder;
            continue;
        }

        if (match[4] !== undefined) {
            const url = getAttribute(match[3], 'href');

            stack.at(-1).push({
                type: 'link',
                title: decodeEntities(match[4]) || url || 'Untitled',
                url,
                addDate: Number(
                    getAttribute(match[3], 'add_date')
                ) || Math.floor(Date.now() / 1000)
            });

            pendingFolder = null;
        }
    }

    return root;
};

self.onmessage = event => {
    try {
        const { text, type } = event.data;

        if (type === 'json') {
            const parsed = JSON.parse(text);
            const tree = Array.isArray(parsed) ? parsed : parsed.tree;

            if (!Array.isArray(tree)) {
                throw new Error('JSON内にtree配列がありません');
            }

            self.postMessage({ ok: true, tree });
            return;
        }

        self.postMessage({ ok: true, tree: parseHtml(text) });
    } catch (error) {
        self.postMessage({ ok: false, error: error.message });
    }
};
