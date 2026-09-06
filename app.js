(() => {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // Utilities
    // ═══════════════════════════════════════════════════════════════

    const $ = selector => document.querySelector(selector);
    const $$ = selector => Array.from(document.querySelectorAll(selector));

    const escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const escapeRegExp = value =>
        String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const debounce = (fn, wait = 100) => {
        let timer = null;

        function debounced(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), wait);
        }

        debounced.cancel = () => {
            clearTimeout(timer);
            timer = null;
        };

        return debounced;
    };

    const nextFrame = () =>
        new Promise(resolve => requestAnimationFrame(resolve));

    function toast(message, type = '') {
        const element = $('#toast');
        if (!element) return;

        element.className = type;
        element.textContent = message;
        element.classList.add('show');

        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => {
            element.classList.remove('show');
        }, 2300);
    }

    function downloadBlob(content, filename, type) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = filename;
        anchor.hidden = true;

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function readFileText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = event => resolve(String(event.target.result ?? ''));
            reader.onerror = () => reject(reader.error || new Error('ファイルを読み込めませんでした'));
            reader.readAsText(file);
        });
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const textarea = document.createElement('textarea');

            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';

            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
    }

    function safeJsonParse(value, fallback = null) {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Suite dialogs (async confirm / prompt)
    // ═══════════════════════════════════════════════════════════════

    function buildSuiteDialog({
        title,
        bodyHtml,
        okLabel,
        cancelLabel,
        danger = false,
        withInput = false,
        initialValue = '',
        placeholder = ''
    }) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');

            overlay.className = 'modal-ov show';
            overlay.dataset.suite = '1';

            overlay.innerHTML =
                '<div class="modal-box dlg-box" role="dialog" aria-modal="true" aria-label="' +
                `${escapeHtml(title)}">` +
                `<h3>${escapeHtml(title)}</h3>` +
                bodyHtml +
                (withInput
                    ? `<input type="text" class="dlg-input" maxlength="2000" autocomplete="off" ` +
                    `placeholder="${escapeHtml(placeholder)}">`
                    : '') +
                '<div class="m-acts">' +
                `<button type="button" class="m-cancel">${escapeHtml(cancelLabel)}</button>` +
                `<button type="button" class="m-save${danger ? ' m-danger' : ''}">` +
                `${escapeHtml(okLabel)}</button>` +
                '</div></div>';

            const input = overlay.querySelector('.dlg-input');

            if (input) {
                input.value = initialValue;
            }

            const okButton = overlay.querySelector('.m-save');
            const cancelButton = overlay.querySelector('.m-cancel');
            const resultValue = () => (withInput ? input.value : true);

            const finish = value => {
                document.removeEventListener('keydown', onKeyDown, true);
                overlay.remove();
                resolve(value);
            };

            const submit = () => {
                if (withInput && !input.value.trim()) {
                    input.focus();
                    return;
                }

                finish(resultValue());
            };

            const dismiss = () => finish(withInput ? null : false);

            okButton.addEventListener('click', submit);
            cancelButton.addEventListener('click', dismiss);

            overlay.addEventListener('mousedown', event => {
                if (event.target === overlay) dismiss();
            });

            function onKeyDown(event) {
                if (event.isComposing || event.keyCode === 229) return;

                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    dismiss();

                    return;
                }

                if (
                    event.key === 'Enter' &&
                    event.target !== okButton &&
                    event.target !== cancelButton
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    submit();
                }
            }

            document.addEventListener('keydown', onKeyDown, true);
            document.body.appendChild(overlay);

            if (withInput) {
                input.focus();
                input.select();
            } else {
                okButton.focus();
            }
        });
    }

    function uiConfirm(message, options = {}) {
        const {
            title = '確認',
            okLabel = 'OK',
            cancelLabel = 'キャンセル',
            danger = false
        } = options;

        return buildSuiteDialog({
            title,
            bodyHtml: `<p class="dlg-msg">${escapeHtml(message)}</p>`,
            okLabel,
            cancelLabel,
            danger
        });
    }

    function uiPrompt(title, message, initialValue = '', placeholder = '') {
        return buildSuiteDialog({
            title,
            bodyHtml: message
                ? `<p class="dlg-msg">${escapeHtml(message)}</p>`
                : '',
            okLabel: '保存',
            cancelLabel: 'キャンセル',
            withInput: true,
            initialValue,
            placeholder
        }).then(value =>
            value === null ? null : String(value).trim()
        );
    }

    function normalizeTimestamp(value) {
        const number = Number(value);

        if (!Number.isFinite(number) || number <= 0) {
            return Math.floor(Date.now() / 1000);
        }

        return number > 1e12
            ? Math.floor(number / 1000)
            : Math.floor(number);
    }

    // ═══════════════════════════════════════════════════════════════
    // URL safety / normalization
    // ═══════════════════════════════════════════════════════════════

    const TRACKING_PARAMS = new Set([
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'utm_id',
        'fbclid',
        'gclid',
        'gclsrc',
        'dclid',
        'gbraid',
        'wbraid',
        'msclkid',
        'twclid',
        '_hsenc',
        '_hsmi',
        'mc_cid',
        'mc_eid',
        'igshid',
        'si',
        'srsltid',
        'feature'
    ]);

    function getSafeHttpUrl(rawUrl) {
        try {
            const url = new URL(String(rawUrl ?? '').trim());

            if (!['http:', 'https:'].includes(url.protocol)) {
                return '';
            }

            return url.href;
        } catch {
            return '';
        }
    }

    function isSafeHttpUrl(rawUrl) {
        return Boolean(getSafeHttpUrl(rawUrl));
    }

    function cleanUrl(rawUrl) {
        const input = String(rawUrl ?? '').trim();
        if (!input) return '';

        try {
            const url = new URL(input);

            if (!['http:', 'https:'].includes(url.protocol)) {
                return input;
            }

            const params = url.searchParams;

            for (const key of [...params.keys()]) {
                if (
                    TRACKING_PARAMS.has(key) ||
                    /^utm_/i.test(key) ||
                    /clid$/i.test(key) ||
                    /^_hs/i.test(key)
                ) {
                    params.delete(key);
                }
            }

            const hostname = url.hostname.replace(/^www\./i, '');

            if (/google\./i.test(hostname) && url.pathname.includes('/search')) {
                const allowed = new Set([
                    'q',
                    'tbm',
                    'tbs',
                    'start',
                    'num',
                    'hl',
                    'gl'
                ]);

                for (const key of [...params.keys()]) {
                    if (!allowed.has(key)) params.delete(key);
                }
            }

            if (/amazon\./i.test(hostname)) {
                const match = url.pathname.match(/\/dp\/([A-Z0-9]{10})/i);

                if (match) {
                    return `${url.origin}/dp/${match[1].toUpperCase()}`;
                }
            }

            if (/youtube\.com$/i.test(hostname) && url.pathname === '/watch') {
                const videoId = params.get('v');
                const listId = params.get('list');
                const time = params.get('t');

                if (videoId) {
                    let result = `${url.origin}/watch?v=${encodeURIComponent(videoId)}`;

                    if (listId) result += `&list=${encodeURIComponent(listId)}`;
                    if (time) result += `&t=${encodeURIComponent(time)}`;

                    return result;
                }
            }

            if (/^(twitter\.com|x\.com)$/i.test(hostname)) {
                const match = url.pathname.match(/\/status\/\d+/);

                if (match) {
                    return `${url.origin}${match[0]}`;
                }
            }

            if (/reddit\.com$/i.test(hostname)) {
                return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
            }

            return url.toString().replace(/\?$/, '');
        } catch {
            return input;
        }
    }

    function canonicalUrlKey(rawUrl) {
        const safe = getSafeHttpUrl(cleanUrl(rawUrl));
        if (!safe) return '';

        try {
            const url = new URL(safe);

            url.hash = '';
            url.hostname = url.hostname.toLowerCase();

            if (
                (url.protocol === 'https:' && url.port === '443') ||
                (url.protocol === 'http:' && url.port === '80')
            ) {
                url.port = '';
            }

            return url.href.replace(/\?$/, '');
        } catch {
            return '';
        }
    }

    function getDomain(rawUrl) {
        try {
            return new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase();
        } catch {
            return '';
        }
    }

    function safeOpenUrl(rawUrl) {
        const url = getSafeHttpUrl(rawUrl);

        if (!url) {
            toast('安全でない、または無効なURLです', 'err');
            return;
        }

        const opened = window.open(url, '_blank', 'noopener,noreferrer');

        if (opened) {
            opened.opener = null;
        }
    }

    function hasUrlParameters(rawUrl) {
        try {
            return [...new URL(rawUrl).searchParams.keys()].length > 0;
        } catch {
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Legacy title metadata / normalized data model
    // ═══════════════════════════════════════════════════════════════

    const legacyMetaCache = new Map();

    function parseLegacyTitle(fullTitle) {
        const raw = String(fullTitle ?? '');

        if (legacyMetaCache.has(raw)) {
            return legacyMetaCache.get(raw);
        }

        const tags = [];
        const tagPattern = /#([^\s#]+|[⭐★]+)/gu;
        let match;

        while ((match = tagPattern.exec(raw)) !== null) {
            tags.push(match[1]);
        }

        const ratingToken = tags.find(tag => /^[⭐★]+$/u.test(tag));
        const rating = ratingToken
            ? Math.min(5, [...ratingToken].length)
            : 0;

        const normalTags = tags.filter(tag => tag !== ratingToken);
        const title = raw
            .replace(tagPattern, '')
            .replace(/\s+/g, ' ')
            .trim();

        const result = {
            title,
            tags: normalTags,
            rating
        };

        if (legacyMetaCache.size > 8000) {
            legacyMetaCache.clear();
        }

        legacyMetaCache.set(raw, result);
        return result;
    }

    function normalizeTag(tag) {
        return String(tag ?? '')
            .normalize('NFKC')
            .replace(/^#+/, '')
            .replace(/\s+/g, '_')
            .trim()
            .slice(0, 64);
    }

    function normalizeTags(tags) {
        const result = [];
        const seen = new Set();

        for (const source of Array.isArray(tags) ? tags : []) {
            const tag = normalizeTag(source);
            const key = tag.toLocaleLowerCase('ja');

            if (!tag || seen.has(key)) continue;

            seen.add(key);
            result.push(tag);

            if (result.length >= 100) break;
        }

        return result;
    }

    function buildLegacyTitle(title, tags, rating) {
        const parts = [String(title ?? '').trim()];
        const normalizedTags = normalizeTags(tags);

        for (const tag of normalizedTags) {
            parts.push(`#${tag}`);
        }

        const normalizedRating = Math.max(
            0,
            Math.min(5, Number(rating) || 0)
        );

        if (normalizedRating > 0) {
            parts.push(`#${'⭐'.repeat(normalizedRating)}`);
        }

        return parts.filter(Boolean).join(' ');
    }

    function getNodeMeta(node) {
        return {
            title: String(node?.title ?? ''),
            tags: normalizeTags(node?.tags),
            rating: Math.max(0, Math.min(5, Number(node?.rating) || 0))
        };
    }

    function renderBadges(tags, rating) {
        let html = '';

        if (rating > 0) {
            html += `<span class="star-bd">${'⭐'.repeat(rating)}</span>`;
        }

        for (const tag of tags) {
            html += `<span class="tag-bd" title="#${escapeHtml(tag)}">${escapeHtml(tag)}</span>`;
        }

        return html;
    }

    // ═══════════════════════════════════════════════════════════════
    // Application settings
    // ═══════════════════════════════════════════════════════════════

    const settings = {
        faviconEnabled: localStorage.getItem('bmt_favicon') !== 'off',
        autoPreview: localStorage.getItem('bmt_auto_preview') !== 'off',
        previewScripts: localStorage.getItem('bmt_preview_scripts') === 'on'
    };

    function persistSetting(key) {
        const storageMap = {
            faviconEnabled: ['bmt_favicon', 'on', 'off'],
            autoPreview: ['bmt_auto_preview', 'on', 'off'],
            previewScripts: ['bmt_preview_scripts', 'on', 'off']
        };

        const [storageKey, onValue, offValue] = storageMap[key];

        localStorage.setItem(
            storageKey,
            settings[key] ? onValue : offValue
        );
    }

    function setupSettingsMenu() {
        const menu = $('#settings-menu');
        const toggleButton = $('#settings-toggle');

        if (!menu || !toggleButton) return;

        const setOpen = open => {
            menu.hidden = !open;
            toggleButton.setAttribute('aria-expanded', String(open));
        };

        toggleButton.addEventListener('click', event => {
            event.stopPropagation();
            setOpen(menu.hidden);
        });

        document.addEventListener('click', event => {
            if (
                !menu.hidden &&
                !menu.contains(event.target) &&
                event.target !== toggleButton
            ) {
                setOpen(false);
            }
        });

        const bindings = [
            ['#set-favicons', 'faviconEnabled', () => renderEditorContent()],
            ['#set-autopreview', 'autoPreview', null],
            [
                '#set-preview-scripts',
                'previewScripts',
                () => {
                    configurePreviewSandbox();

                    if (editorActivePreviewId) {
                        previewEditorLink(editorActivePreviewId);
                    }
                }
            ]
        ];

        for (const [selector, key, onChange] of bindings) {
            const checkbox = $(selector);
            if (!checkbox) continue;

            checkbox.checked = settings[key];

            checkbox.addEventListener('change', () => {
                settings[key] = checkbox.checked;
                persistSetting(key);
                onChange?.();
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Theme / main tabs
    // ═══════════════════════════════════════════════════════════════

    function resolveInitialDark() {
        const savedTheme = localStorage.getItem('bmt_theme');

        if (savedTheme === 'dark') return true;
        if (savedTheme === 'light') return false;

        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    }

    function applyTheme(dark) {
        document.body.classList.toggle('dark', dark);

        const toggle = $('#theme-toggle');

        if (toggle) {
            toggle.textContent = dark ? '☀️ Light' : '🌙 Dark';
        }
    }

    function initializeTheme() {
        applyTheme(resolveInitialDark());
    }

    $('#theme-toggle').addEventListener('click', () => {
        const dark = !document.body.classList.contains('dark');

        applyTheme(dark);
        localStorage.setItem('bmt_theme', dark ? 'dark' : 'light');
    });

    window.matchMedia?.('(prefers-color-scheme: dark)')
        ?.addEventListener?.('change', event => {
            if (localStorage.getItem('bmt_theme')) return;

            applyTheme(event.matches);
        });

    $$('.tab-btn').forEach(button => {
        button.addEventListener('click', () => {
            $$('.tab-btn').forEach(item => item.classList.remove('active'));
            $$('.tab-content').forEach(item => item.classList.remove('active'));

            button.classList.add('active');
            $(`#tab-${button.dataset.tab}`)?.classList.add('active');
        });
    });

    function activateEditorTab() {
        $$('.tab-btn').forEach(item => item.classList.remove('active'));
        $$('.tab-content').forEach(item => item.classList.remove('active'));

        $('[data-tab="editor"]')?.classList.add('active');
        $('#tab-editor')?.classList.add('active');
    }

    // ═══════════════════════════════════════════════════════════════
    // Merger
    // ═══════════════════════════════════════════════════════════════

    let mergerMap = new Map();
    let mergerFiles = [];

    const mergerDropZone = $('#m-drop');
    const mergerFileInput = $('#m-file-input');

    mergerDropZone.addEventListener('click', () => mergerFileInput.click());

    mergerDropZone.addEventListener('dragover', event => {
        event.preventDefault();
        event.stopPropagation();
        mergerDropZone.classList.add('dragover');
    });

    mergerDropZone.addEventListener('dragleave', () => {
        mergerDropZone.classList.remove('dragover');
    });

    mergerDropZone.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();

        mergerDropZone.classList.remove('dragover');
        loadMergerFiles(event.dataTransfer.files);
    });

    mergerFileInput.addEventListener('change', event => {
        loadMergerFiles(event.target.files);
        event.target.value = '';
    });

    async function loadMergerFiles(fileList) {
        const incoming = [...fileList].filter(file =>
            /\.(html?|htm)$/i.test(file.name)
        );

        if (!incoming.length) {
            toast('HTMLファイルを選択してください', 'err');
            return;
        }

        for (const file of incoming) {
            const duplicate = mergerFiles.some(
                existing =>
                    existing.name === file.name &&
                    existing.size === file.size
            );

            if (!duplicate) mergerFiles.push(file);
        }

        await analyzeMergerFiles();
    }

    function renderMergerChips() {
        $('#m-chips').innerHTML =
            mergerFiles.map((file, index) =>
                `<span class="file-chip">📄 ${escapeHtml(file.name)}` +
                `<button type="button" class="chip-x" data-index="${index}" ` +
                `title="このファイルを外す" aria-label="${escapeHtml(file.name)} を外す">×</button>` +
                '</span>'
            ).join('') +
            (mergerFiles.length
                ? '<button type="button" class="file-chip chip-clear" id="m-clear">🧹 クリア</button>'
                : '');
    }

    async function analyzeMergerFiles() {
        mergerMap.clear();

        renderMergerChips();

        const resultCard = $('#m-result');
        const logBox = $('#m-log');

        if (!mergerFiles.length) {
            resultCard.style.display = 'none';
            return;
        }

        resultCard.style.display = 'block';
        logBox.textContent = '📂 読み込み中...\n';

        try {
            const contents = await Promise.all(
                mergerFiles.map(readFileText)
            );
            const parser = new DOMParser();

            let total = 0;

            contents.forEach((html, fileIndex) => {
                const documentNode = parser.parseFromString(html, 'text/html');
                const anchors = documentNode.querySelectorAll('a[href]');

                total += anchors.length;
                logBox.textContent +=
                    `ファイル ${fileIndex + 1} (${mergerFiles[fileIndex].name}): ${anchors.length.toLocaleString()}件\n`;

                anchors.forEach(anchor => {
                    const cleaned = cleanUrl(anchor.getAttribute('href'));
                    const safeUrl = getSafeHttpUrl(cleaned);

                    if (!safeUrl) return;

                    const key = canonicalUrlKey(safeUrl);
                    if (!key) return;

                    let hostname = 'Others';

                    try {
                        hostname = new URL(safeUrl).hostname;
                    } catch {
                        // Ignore.
                    }

                    if (!mergerMap.has(key)) {
                        mergerMap.set(key, {
                            title: anchor.textContent.trim() || safeUrl,
                            url: safeUrl,
                            addDate: normalizeTimestamp(
                                anchor.getAttribute('add_date') ||
                                anchor.getAttribute('ADD_DATE')
                            ),
                            hostname,
                            files: new Set()
                        });
                    }

                    mergerMap.get(key).files.add(fileIndex);
                });
            });

            const all = [...mergerMap.values()];
            const different = all.filter(item => item.files.size === 1);

            logBox.textContent +=
                `──────\n総: ${total.toLocaleString()} / ` +
                `ユニーク: ${all.length.toLocaleString()} / ` +
                `差分: ${different.length.toLocaleString()}\n`;

            $('#m-s-total').textContent = total.toLocaleString();
            $('#m-s-merged').textContent = all.length.toLocaleString();
            $('#m-s-diff').textContent = different.length.toLocaleString();

            $('#m-dl-merge').disabled = false;
            $('#m-dl-diff').disabled =
                mergerFiles.length < 2 || different.length === 0;
            $('#m-to-editor').disabled = false;
        } catch (error) {
            logBox.textContent += `❌ ${error.message}\n`;
            toast(`読み込みエラー: ${error.message}`, 'err');
        }
    }

    $('#m-chips').addEventListener('click', async event => {
        const removeButton = event.target.closest('.chip-x');
        const clearButton = event.target.closest('.chip-clear');

        if (removeButton) {
            mergerFiles.splice(Number(removeButton.dataset.index), 1);
            await analyzeMergerFiles();
            return;
        }

        if (clearButton) {
            mergerFiles = [];
            await analyzeMergerFiles();
        }
    });

    function buildMergerHtml(bookmarks) {
        const groups = new Map();

        for (const bookmark of bookmarks) {
            if (!groups.has(bookmark.hostname)) {
                groups.set(bookmark.hostname, []);
            }

            groups.get(bookmark.hostname).push(bookmark);
        }

        let html =
            '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
            '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
            '<TITLE>Bookmarks</TITLE>\n' +
            '<H1>Bookmarks</H1>\n' +
            '<DL><p>\n';

        for (const [hostname, items] of groups) {
            html +=
                `    <DT><H3 ADD_DATE="${Math.floor(Date.now() / 1000)}">` +
                `${escapeHtml(hostname)}</H3>\n` +
                '    <DL><p>\n';

            for (const item of items) {
                html +=
                    `        <DT><A HREF="${escapeHtml(item.url)}" ` +
                    `ADD_DATE="${item.addDate}">${escapeHtml(item.title)}</A>\n`;
            }

            html += '    </DL><p>\n';
        }

        return `${html}</DL><p>\n`;
    }

    function downloadMergerHtml(bookmarks, prefix) {
        const html = buildMergerHtml(bookmarks);

        downloadBlob(
            html,
            `bookmarks_${prefix}_${new Date().toISOString().slice(0, 10)}.html`,
            'text/html;charset=utf-8'
        );

        $('#m-log').textContent +=
            `💾 DL完了 (${bookmarks.length.toLocaleString()}件)\n`;
    }

    $('#m-dl-merge').addEventListener('click', () => {
        const bookmarks = [...mergerMap.values()]
            .sort((a, b) => a.hostname.localeCompare(b.hostname));

        downloadMergerHtml(bookmarks, 'merged');
    });

    $('#m-dl-diff').addEventListener('click', () => {
        const bookmarks = [...mergerMap.values()]
            .filter(item => item.files.size === 1)
            .sort((a, b) => a.hostname.localeCompare(b.hostname));

        downloadMergerHtml(bookmarks, 'diff');
    });

    $('#m-to-editor').addEventListener('click', () => {
        const bookmarks = [...mergerMap.values()]
            .sort((a, b) => a.hostname.localeCompare(b.hostname));

        loadEditorHtml(buildMergerHtml(bookmarks));
        activateEditorTab();
        toast('エディタで開きました', 'ok');
    });

    // ═══════════════════════════════════════════════════════════════
    // Editor state
    // ═══════════════════════════════════════════════════════════════

    let editorTree = [];
    let editorPath = [];
    let editorExpanded = new Set();
    let editorSelection = new Set();

    let editorIdCounter = 0;
    let editorEditingId = null;
    let editorModalRating = 0;
    let editorLastSelectedId = null;
    let editorActivePreviewId = null;

    let editorSearch = '';
    let editorSearchDeep = true;
    let editorSearchError = '';

    let editorFilterType = 'all';
    let editorFilterRating = 0;
    let editorFilterTag = '';
    let editorFilterDomain = '';
    let editorFilterTagUnset = false;
    let editorSort = 'default';

    let editorDirty = false;
    let editorShowDuplicates = false;
    let editorPreviewEnabled = true;

    let editorDuplicateIds = new Set();

    let editorUndoStack = [];
    let editorRedoStack = [];
    let editorUndoBytes = 0;
    let editorRedoBytes = 0;

    const EDITOR_UNDO_LIMIT = 30;
    const EDITOR_UNDO_BYTE_LIMIT = 24 * 1024 * 1024;

    let editorRenderRaf = null;
    let editorDragPosition = null;
    let editorDraggingId = null;

    let editorVisibleRecords = [];
    let editorVisibleIds = [];

    const editorSearchOptions = {
        fields: {
            title: true,
            url: true,
            tags: true
        },
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        mode: 'and'
    };

    let editorSearchHistory = safeJsonParse(
        localStorage.getItem('bmt_search_history'),
        []
    );

    if (!Array.isArray(editorSearchHistory)) {
        editorSearchHistory = [];
    }

    let editorSearchHistoryIndex = -1;
    let editorSearchMatchIndex = -1;

    let editorTabs = [{
        path: [],
        selection: new Set(),
        scroll: 0,
        search: '',
        label: '🏠 Root',
        pinned: false
    }];

    let editorActiveTab = 0;

    const editorNodeById = new Map();
    const editorParentArrayById = new Map();
    const editorParentIdById = new Map();
    const editorLinkCountById = new Map();

    function setStatus(message) {
        $('#ed-sb-msg').textContent = message;
    }

    function generateEditorId() {
        editorIdCounter += 1;

        return `bm_${Date.now().toString(36)}_${editorIdCounter.toString(36)}`;
    }

    function editorFind(id) {
        return editorNodeById.get(id);
    }

    function editorFindParentArray(id) {
        return editorParentArrayById.get(id);
    }

    function rebuildEditorIndex() {
        editorNodeById.clear();
        editorParentArrayById.clear();
        editorParentIdById.clear();
        editorLinkCountById.clear();

        const seenIds = new Set();

        function walk(nodes, parentId = null) {
            let links = 0;

            for (const node of nodes) {
                if (!node.id || seenIds.has(node.id)) {
                    node.id = generateEditorId();
                }

                seenIds.add(node.id);

                editorNodeById.set(node.id, node);
                editorParentArrayById.set(node.id, nodes);
                editorParentIdById.set(node.id, parentId);

                if (node.type === 'folder') {
                    if (!Array.isArray(node.children)) {
                        node.children = [];
                    }

                    const childLinks = walk(node.children, node.id);
                    editorLinkCountById.set(node.id, childLinks);
                    links += childLinks;
                } else {
                    editorLinkCountById.set(node.id, 1);
                    links += 1;
                }
            }

            return links;
        }

        walk(editorTree);
        repairEditorNavigation();
    }

    function countEditorLinks(node) {
        return editorLinkCountById.get(node?.id) ?? 0;
    }

    function countEditorTree(nodes = editorTree) {
        let links = 0;
        let folders = 0;

        function walk(items) {
            for (const item of items) {
                if (item.type === 'link') {
                    links += 1;
                } else {
                    folders += 1;
                    walk(item.children || []);
                }
            }
        }

        walk(nodes);

        return { links, folders };
    }

    function getCurrentEditorItems() {
        if (!editorPath.length) return editorTree;

        const folder = editorFind(editorPath.at(-1).id);

        return folder?.type === 'folder'
            ? folder.children
            : editorTree;
    }

    function getFolderPath(folderId) {
        const path = [];
        let currentId = folderId;

        while (currentId) {
            const node = editorFind(currentId);

            if (!node || node.type !== 'folder') break;

            path.unshift({
                id: node.id,
                title: node.title
            });

            currentId = editorParentIdById.get(currentId);
        }

        return path;
    }

    function getNodeContext(node) {
        const path = [];
        let parentId = editorParentIdById.get(node.id);

        while (parentId) {
            const parent = editorFind(parentId);

            if (!parent) break;

            path.unshift(parent.title);
            parentId = editorParentIdById.get(parentId);
        }

        return {
            path,
            depth: path.length
        };
    }

    function repairEditorNavigation() {
        if (!editorPath.length) return;

        const lastFolder = [...editorPath]
            .reverse()
            .find(segment => editorFind(segment.id)?.type === 'folder');

        editorPath = lastFolder
            ? getFolderPath(lastFolder.id)
            : [];
    }

    // ═══════════════════════════════════════════════════════════════
    // Imported data normalization
    // ═══════════════════════════════════════════════════════════════

    function normalizeImportedTree(rawTree, preserveIds = false) {
        const source = Array.isArray(rawTree) ? rawTree : [];
        const seenIds = new Set();

        let nodeCount = 0;

        function normalizeNode(rawNode, depth = 0) {
            if (
                !rawNode ||
                typeof rawNode !== 'object' ||
                depth > 100 ||
                nodeCount >= 100000
            ) {
                return null;
            }

            nodeCount += 1;

            const type = rawNode.type === 'folder'
                ? 'folder'
                : 'link';

            let title = String(rawNode.title ?? '').slice(0, 4000);
            let tags;
            let rating;

            if (
                Array.isArray(rawNode.tags) ||
                Number.isFinite(Number(rawNode.rating))
            ) {
                tags = normalizeTags(rawNode.tags);
                rating = Math.max(
                    0,
                    Math.min(5, Number(rawNode.rating) || 0)
                );
            } else {
                const legacy = parseLegacyTitle(title);

                title = legacy.title;
                tags = normalizeTags(legacy.tags);
                rating = legacy.rating;
            }

            if (!title.trim()) {
                title = type === 'folder'
                    ? 'Folder'
                    : String(rawNode.url ?? '').trim() || 'Untitled';
            }

            let id = preserveIds
                ? String(rawNode.id ?? '')
                : '';

            if (!id || seenIds.has(id) || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
                id = generateEditorId();
            }

            seenIds.add(id);

            const node = {
                id,
                type,
                title: title.trim(),
                tags,
                rating,
                addDate: normalizeTimestamp(rawNode.addDate)
            };

            if (rawNode.bid) {
                node.bid = String(rawNode.bid);
            }

            if (type === 'folder') {
                node.children = [];

                for (const child of Array.isArray(rawNode.children)
                    ? rawNode.children
                    : []) {
                    const normalizedChild = normalizeNode(child, depth + 1);

                    if (normalizedChild) {
                        node.children.push(normalizedChild);
                    }
                }
            } else {
                node.url = String(rawNode.url ?? '').trim().slice(0, 20000);
            }

            return node;
        }

        const result = [];

        for (const rawNode of source) {
            const node = normalizeNode(rawNode);

            if (node) result.push(node);
        }

        return result;
    }

    // ═══════════════════════════════════════════════════════════════
    // Undo / redo transaction
    // ═══════════════════════════════════════════════════════════════

    function stackByteLength(snapshot) {
        return snapshot.length * 2;
    }

    function pushUndoSnapshot(snapshot) {
        editorUndoStack.push(snapshot);
        editorUndoBytes += stackByteLength(snapshot);

        while (
            editorUndoStack.length > EDITOR_UNDO_LIMIT ||
            editorUndoBytes > EDITOR_UNDO_BYTE_LIMIT
        ) {
            const removed = editorUndoStack.shift();
            editorUndoBytes -= stackByteLength(removed);
        }
    }

    function pushRedoSnapshot(snapshot) {
        editorRedoStack.push(snapshot);
        editorRedoBytes += stackByteLength(snapshot);

        while (
            editorRedoStack.length > EDITOR_UNDO_LIMIT ||
            editorRedoBytes > EDITOR_UNDO_BYTE_LIMIT
        ) {
            const removed = editorRedoStack.shift();
            editorRedoBytes -= stackByteLength(removed);
        }
    }

    function clearRedoStack() {
        editorRedoStack = [];
        editorRedoBytes = 0;
    }

    function updateUndoButtons() {
        $('#tb-undo').disabled = editorUndoStack.length === 0;
        $('#tb-redo').disabled = editorRedoStack.length === 0;
        $('#sb-dirty').style.display = editorDirty
            ? 'inline-block'
            : 'none';
    }

    function editorMutate(mutator, options = {}) {
        const before = JSON.stringify(editorTree);

        try {
            const result = mutator();

            if (result === false) {
                editorTree = JSON.parse(before);
                rebuildEditorIndex();
                return false;
            }

            pushUndoSnapshot(before);
            clearRedoStack();

            editorDirty = true;

            rebuildEditorIndex();
            updateUndoButtons();
            scheduleAutosave();

            if (options.render !== false) {
                renderEditorAll();
            }

            return true;
        } catch (error) {
            editorTree = JSON.parse(before);
            rebuildEditorIndex();
            renderEditorAll();

            console.error(error);
            toast(`操作エラー: ${error.message}`, 'err');

            return false;
        }
    }

    function editorUndo() {
        if (!editorUndoStack.length) return;

        const current = JSON.stringify(editorTree);
        const previous = editorUndoStack.pop();

        editorUndoBytes -= stackByteLength(previous);
        pushRedoSnapshot(current);

        editorTree = JSON.parse(previous);
        editorSelection.clear();
        editorDirty = true;

        rebuildEditorIndex();
        renderEditorAll();
        updateUndoButtons();
        scheduleAutosave();

        toast('元に戻しました');
    }

    function editorRedo() {
        if (!editorRedoStack.length) return;

        const current = JSON.stringify(editorTree);
        const next = editorRedoStack.pop();

        editorRedoBytes -= stackByteLength(next);
        pushUndoSnapshot(current);

        editorTree = JSON.parse(next);
        editorSelection.clear();
        editorDirty = true;

        rebuildEditorIndex();
        renderEditorAll();
        updateUndoButtons();
        scheduleAutosave();

        toast('やり直しました');
    }

    // ═══════════════════════════════════════════════════════════════
    // IndexedDB autosave
    // ═══════════════════════════════════════════════════════════════

    const DATABASE_NAME = 'bookmark_tools_pro';
    const DATABASE_VERSION = 1;
    const SNAPSHOT_STORE = 'snapshots';
    const SNAPSHOT_KEEP_COUNT = 5;

    let databasePromise = null;

    function openDatabase() {
        if (databasePromise) return databasePromise;

        databasePromise = new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) {
                reject(new Error('IndexedDB is not supported'));
                return;
            }

            const request = indexedDB.open(
                DATABASE_NAME,
                DATABASE_VERSION
            );

            request.onupgradeneeded = () => {
                const database = request.result;

                if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
                    const store = database.createObjectStore(
                        SNAPSHOT_STORE,
                        {
                            keyPath: 'id',
                            autoIncrement: true
                        }
                    );

                    store.createIndex('saved', 'saved');
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        return databasePromise;
    }

    async function saveIndexedDbSnapshot() {
        const database = await openDatabase();

        await new Promise((resolve, reject) => {
            const transaction = database.transaction(
                SNAPSHOT_STORE,
                'readwrite'
            );

            transaction.objectStore(SNAPSHOT_STORE).add({
                saved: Date.now(),
                tree: editorTree
            });

            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });

        await pruneIndexedDbSnapshots(database);
    }

    async function pruneIndexedDbSnapshots(database) {
        const records = await new Promise((resolve, reject) => {
            const transaction = database.transaction(
                SNAPSHOT_STORE,
                'readonly'
            );

            const request = transaction
                .objectStore(SNAPSHOT_STORE)
                .getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });

        records.sort((a, b) => b.saved - a.saved);

        const oldRecords = records.slice(SNAPSHOT_KEEP_COUNT);
        if (!oldRecords.length) return;

        await new Promise((resolve, reject) => {
            const transaction = database.transaction(
                SNAPSHOT_STORE,
                'readwrite'
            );

            const store = transaction.objectStore(SNAPSHOT_STORE);

            for (const record of oldRecords) {
                store.delete(record.id);
            }

            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async function loadLatestIndexedDbSnapshot() {
        const database = await openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = database.transaction(
                SNAPSHOT_STORE,
                'readonly'
            );

            const index = transaction
                .objectStore(SNAPSHOT_STORE)
                .index('saved');

            const request = index.openCursor(null, 'prev');

            request.onsuccess = () => {
                resolve(request.result?.value ?? null);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async function saveAutosave() {
        if (!editorTree.length) return;

        try {
            await saveIndexedDbSnapshot();
        } catch (error) {
            const serialized = JSON.stringify({
                tree: editorTree,
                saved: Date.now()
            });

            if (serialized.length < 4_000_000) {
                localStorage.setItem('bmt_data', serialized);
            } else {
                console.warn('Autosave failed:', error);
            }
        }

        $('#sb-autosave').style.display = 'inline-block';

        setTimeout(() => {
            $('#sb-autosave').style.display = 'none';
        }, 1500);
    }

    const scheduleAutosave = debounce(saveAutosave, 1000);

    async function restoreAutosave() {
        let snapshot = null;

        try {
            snapshot = await loadLatestIndexedDbSnapshot();
        } catch {
            snapshot = safeJsonParse(
                localStorage.getItem('bmt_data'),
                null
            );
        }

        if (!snapshot?.tree || !Array.isArray(snapshot.tree)) {
            return false;
        }

        const date = new Date(snapshot.saved || Date.now());

        const restore = await uiConfirm(
            `前回の作業データが見つかりました（${date.toLocaleString()}）。復元しますか？`,
            { title: '🔄 復元', danger: false, okLabel: '復元する' }
        );

        if (!restore) return false;

        resetEditorTree(snapshot.tree, {
            preserveIds: true,
            dirty: false
        });

        toast('前回の作業データを復元しました', 'ok');
        return true;
    }

    // ═══════════════════════════════════════════════════════════════
    // Duplicate detection
    // ═══════════════════════════════════════════════════════════════

    function computeDuplicateIds() {
        editorDuplicateIds.clear();

        const seen = new Map();

        function walk(nodes) {
            for (const node of nodes) {
                if (node.type === 'link') {
                    const key = canonicalUrlKey(node.url);

                    if (key) {
                        if (seen.has(key)) {
                            editorDuplicateIds.add(seen.get(key));
                            editorDuplicateIds.add(node.id);
                        } else {
                            seen.set(key, node.id);
                        }
                    }
                } else {
                    walk(node.children || []);
                }
            }
        }

        walk(editorTree);
        return editorDuplicateIds.size;
    }

    function removeDuplicateLinks(nodes, seen = new Map()) {
        let removed = 0;

        for (let index = 0; index < nodes.length;) {
            const node = nodes[index];

            if (node.type === 'link') {
                const key = canonicalUrlKey(node.url);

                if (key && seen.has(key)) {
                    const original = seen.get(key);

                    original.tags = normalizeTags([
                        ...(original.tags || []),
                        ...(node.tags || [])
                    ]);

                    original.rating = Math.max(
                        Number(original.rating) || 0,
                        Number(node.rating) || 0
                    );

                    if (
                        (!original.title || original.title === original.url) &&
                        node.title
                    ) {
                        original.title = node.title;
                    }

                    nodes.splice(index, 1);
                    removed += 1;
                    continue;
                }

                if (key) seen.set(key, node);
            } else {
                removed += removeDuplicateLinks(
                    node.children || [],
                    seen
                );
            }

            index += 1;
        }

        return removed;
    }

    async function deduplicateAll() {
        computeDuplicateIds();

        if (!editorDuplicateIds.size) {
            toast('重複はありません', 'ok');
            return;
        }

        const confirmed = await uiConfirm(
            '最初に見つかったリンクを残し、タグと評価を統合して重複を削除しますか？',
            { title: '🔀 重複整理', danger: true, okLabel: '整理する' }
        );

        if (!confirmed) return;

        let removed = 0;

        editorMutate(() => {
            removed = removeDuplicateLinks(editorTree);
            editorDuplicateIds.clear();
            editorSelection.clear();

            return removed > 0;
        });

        if (removed > 0) {
            toast(
                `${removed.toLocaleString()}件の重複を削除しました`,
                'ok'
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // HTML parser
    // ═══════════════════════════════════════════════════════════════

    function parseBookmarkHtml(html) {
        const documentNode = new DOMParser()
            .parseFromString(html, 'text/html');

        function directChild(element, tagName) {
            return [...element.children]
                .find(child => child.tagName === tagName);
        }

        function parseDefinitionList(dl) {
            if (!dl) return [];

            const result = [];

            for (const element of [...dl.children]) {
                if (!['DT', 'DD'].includes(element.tagName)) continue;

                const anchor = directChild(element, 'A');
                const heading = directChild(element, 'H3');

                if (anchor) {
                    const rawTitle =
                        anchor.textContent.trim() ||
                        anchor.getAttribute('href') ||
                        'Untitled';

                    const legacy = parseLegacyTitle(rawTitle);

                    result.push({
                        type: 'link',
                        title: legacy.title || rawTitle,
                        tags: legacy.tags,
                        rating: legacy.rating,
                        url: cleanUrl(anchor.getAttribute('href') || ''),
                        addDate: normalizeTimestamp(
                            anchor.getAttribute('add_date') ||
                            anchor.getAttribute('ADD_DATE')
                        )
                    });

                    continue;
                }

                if (heading) {
                    const rawTitle =
                        heading.textContent.trim() ||
                        'Folder';

                    const legacy = parseLegacyTitle(rawTitle);

                    let childDl = directChild(element, 'DL');

                    if (!childDl) {
                        let sibling = element.nextElementSibling;

                        while (sibling && sibling.tagName === 'P') {
                            sibling = sibling.nextElementSibling;
                        }

                        if (sibling?.tagName === 'DL') {
                            childDl = sibling;
                        }
                    }

                    result.push({
                        type: 'folder',
                        title: legacy.title || rawTitle,
                        tags: legacy.tags,
                        rating: legacy.rating,
                        addDate: normalizeTimestamp(
                            heading.getAttribute('add_date') ||
                            heading.getAttribute('ADD_DATE')
                        ),
                        children: parseDefinitionList(childDl)
                    });
                }
            }

            return result;
        }

        const rootDl = documentNode.querySelector('dl');

        if (rootDl) {
            const parsed = parseDefinitionList(rootDl);

            if (parsed.length) return parsed;
        }

        return [...documentNode.querySelectorAll('a[href]')].map(anchor => {
            const rawTitle =
                anchor.textContent.trim() ||
                anchor.getAttribute('href') ||
                'Untitled';

            const legacy = parseLegacyTitle(rawTitle);

            return {
                type: 'link',
                title: legacy.title || rawTitle,
                tags: legacy.tags,
                rating: legacy.rating,
                url: cleanUrl(anchor.getAttribute('href') || ''),
                addDate: normalizeTimestamp(
                    anchor.getAttribute('add_date') ||
                    anchor.getAttribute('ADD_DATE')
                )
            };
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // Large-file parser worker (external file: parser-worker.js)
    // ═══════════════════════════════════════════════════════════════

    function parseInWorker(text, type) {
        return new Promise((resolve, reject) => {
            if (!('Worker' in window)) {
                reject(new Error('Worker is not supported'));
                return;
            }

            let worker;

            try {
                worker = new Worker('parser-worker.js');
            } catch (error) {
                reject(error);
                return;
            }

            const cleanup = () => worker.terminate();

            worker.onmessage = event => {
                cleanup();

                if (event.data?.ok) {
                    resolve(event.data.tree);
                } else {
                    reject(
                        new Error(
                            event.data?.error ||
                            'Worker parse failed'
                        )
                    );
                }
            };

            worker.onerror = event => {
                cleanup();
                reject(new Error(event.message || 'Worker error'));
            };

            worker.postMessage({ text, type });
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // Load / serialize / import / export
    // ═══════════════════════════════════════════════════════════════

    function resetEditorTree(rawTree, options = {}) {
        editorTree = normalizeImportedTree(
            rawTree,
            Boolean(options.preserveIds)
        );

        editorPath = [];
        editorExpanded.clear();
        editorSelection.clear();

        editorSearch = '';
        editorLastSelectedId = null;
        editorActivePreviewId = null;

        $('#ed-search-input').value = '';

        for (const node of editorTree) {
            if (node.type === 'folder') {
                editorExpanded.add(node.id);
            }
        }

        editorTabs = [{
            path: [],
            selection: new Set(),
            scroll: 0,
            search: '',
            label: '🏠 Root',
            pinned: false
        }];

        editorActiveTab = 0;

        editorUndoStack = [];
        editorRedoStack = [];
        editorUndoBytes = 0;
        editorRedoBytes = 0;

        editorDirty = Boolean(options.dirty);

        rebuildEditorIndex();
        updateUndoButtons();
        renderEditorAll();
        renderEditorTabs();
    }

    function loadEditorHtml(html) {
        resetEditorTree(parseBookmarkHtml(html), {
            preserveIds: false,
            dirty: false
        });
    }

    function serializeEditorHtml() {
        function serializeNodes(nodes, depth) {
            const indent = '    '.repeat(depth);
            let html = `${indent}<DL><p>\n`;

            for (const node of nodes) {
                const fullTitle = buildLegacyTitle(
                    node.title,
                    node.tags,
                    node.rating
                );

                if (node.type === 'link') {
                    html +=
                        `${indent}    <DT><A HREF="${escapeHtml(node.url)}" ` +
                        `ADD_DATE="${node.addDate}">${escapeHtml(fullTitle)}</A>\n`;
                } else {
                    html +=
                        `${indent}    <DT><H3 ADD_DATE="${node.addDate}">` +
                        `${escapeHtml(fullTitle)}</H3>\n`;

                    html += serializeNodes(
                        node.children || [],
                        depth + 1
                    );
                }
            }

            return `${html}${indent}</DL><p>\n`;
        }

        return (
            '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
            '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
            '<TITLE>Bookmarks</TITLE>\n' +
            '<H1>Bookmarks</H1>\n' +
            serializeNodes(editorTree, 0)
        );
    }

    async function importEditorFile(file) {
        if (!file) return;

        if (file.size > 100 * 1024 * 1024) {
            toast('100MBを超えるファイルは読み込めません', 'err');
            return;
        }

        setStatus('📂 ファイルを読み込み中...');

        try {
            const text = await readFileText(file);
            const isJson = /\.json$/i.test(file.name);

            let rawTree;

            if (text.length > 1_500_000) {
                setStatus('⚙️ 大きなファイルをバックグラウンド解析中...');

                try {
                    rawTree = await parseInWorker(
                        text,
                        isJson ? 'json' : 'html'
                    );
                } catch (workerError) {
                    console.warn(workerError);

                    rawTree = isJson
                        ? (() => {
                            const parsed = JSON.parse(text);

                            return Array.isArray(parsed)
                                ? parsed
                                : parsed.tree;
                        })()
                        : parseBookmarkHtml(text);
                }
            } else if (isJson) {
                const parsed = JSON.parse(text);

                rawTree = Array.isArray(parsed)
                    ? parsed
                    : parsed.tree;
            } else {
                rawTree = parseBookmarkHtml(text);
            }

            if (!Array.isArray(rawTree)) {
                throw new Error('有効なブックマークデータではありません');
            }

            resetEditorTree(rawTree, {
                preserveIds: isJson,
                dirty: false
            });

            toast(`「${file.name}」を読み込みました`, 'ok');
            setStatus('✅ 読み込み完了');
        } catch (error) {
            console.error(error);
            toast(`読み込みエラー: ${error.message}`, 'err');
            setStatus('❌ 読み込みに失敗しました');
        }
    }

    function exportEditorHtml() {
        if (!editorTree.length) return;

        downloadBlob(
            serializeEditorHtml(),
            `bookmarks_${new Date().toISOString().slice(0, 10)}.html`,
            'text/html;charset=utf-8'
        );

        editorDirty = false;
        updateUndoButtons();

        toast('HTMLエクスポート完了', 'ok');
    }

    function exportEditorJson() {
        if (!editorTree.length) return;

        const json = JSON.stringify({
            version: 2,
            exported: Date.now(),
            tree: editorTree
        }, null, 2);

        downloadBlob(
            json,
            `bookmarks_${new Date().toISOString().slice(0, 10)}.json`,
            'application/json;charset=utf-8'
        );

        toast('JSONエクスポート完了', 'ok');
    }

    // ═══════════════════════════════════════════════════════════════
    // Search normalization / query parser
    // ═══════════════════════════════════════════════════════════════

    function katakanaToHiragana(value) {
        return String(value).replace(
            /[\u30a1-\u30f6]/g,
            character => String.fromCharCode(
                character.charCodeAt(0) - 0x60
            )
        );
    }

    function normalizeSearchValue(value) {
        let normalized = String(value ?? '')
            .normalize('NFKC');

        normalized = katakanaToHiragana(normalized);

        return editorSearchOptions.caseSensitive
            ? normalized
            : normalized.toLocaleLowerCase('ja');
    }

    function tokenizeSearchQuery(query) {
        const tokens = [];
        let current = '';
        let quoted = false;
        let escaped = false;

        for (const character of String(query ?? '')) {
            if (escaped) {
                current += character;
                escaped = false;
                continue;
            }

            if (character === '\\' && quoted) {
                escaped = true;
                continue;
            }

            if (character === '"') {
                quoted = !quoted;
                continue;
            }

            if (/\s/.test(character) && !quoted) {
                if (current) {
                    tokens.push(current);
                    current = '';
                }

                continue;
            }

            current += character;
        }

        if (current) tokens.push(current);
        return tokens;
    }

    function parseComparison(value) {
        const match = String(value ?? '').match(
            /^(>=|<=|>|<|=)?(.+)$/
        );

        if (!match) return null;

        return {
            operator: match[1] || '=',
            value: match[2]
        };
    }

    function compareNumber(actual, comparison) {
        if (!comparison) return true;

        const expected = Number(comparison.value);

        if (!Number.isFinite(expected)) return false;

        switch (comparison.operator) {
            case '>=':
                return actual >= expected;
            case '<=':
                return actual <= expected;
            case '>':
                return actual > expected;
            case '<':
                return actual < expected;
            default:
                return actual === expected;
        }
    }

    function parseSearchDate(value, endOfDay = false) {
        if (!value) return null;

        const suffix = endOfDay
            ? 'T23:59:59.999'
            : 'T00:00:00.000';

        const time = Date.parse(`${value}${suffix}`);

        return Number.isFinite(time)
            ? Math.floor(time / 1000)
            : null;
    }

    function parseSearchQuery(query) {
        const parsed = {
            free: [],
            notFree: [],
            title: [],
            notTitle: [],
            url: [],
            notUrl: [],
            tags: [],
            notTags: [],
            domains: [],
            notDomains: [],
            rating: [],
            type: null,
            after: null,
            before: null,
            paths: [],
            notPaths: [],
            protocol: null,
            depth: null,
            states: new Set()
        };

        for (let token of tokenizeSearchQuery(query)) {
            let negative = false;

            if (token.startsWith('-') && token.length > 1) {
                negative = true;
                token = token.slice(1);
            }

            const separator = token.indexOf(':');

            if (separator <= 0) {
                const target = negative
                    ? parsed.notFree
                    : parsed.free;

                target.push(token);
                continue;
            }

            const key = token
                .slice(0, separator)
                .toLocaleLowerCase('ja');

            const value = token.slice(separator + 1);

            if (!value) {
                const target = negative
                    ? parsed.notFree
                    : parsed.free;

                target.push(token);
                continue;
            }

            switch (key) {
                case 'title':
                    (negative ? parsed.notTitle : parsed.title).push(value);
                    break;

                case 'url':
                    (negative ? parsed.notUrl : parsed.url).push(value);
                    break;

                case 'domain':
                    (negative ? parsed.notDomains : parsed.domains).push(value);
                    break;

                case 'tag':
                    (negative ? parsed.notTags : parsed.tags).push(value);
                    break;

                case 'rating':
                    parsed.rating.push(parseComparison(value));
                    break;

                case 'type':
                    if (['link', 'folder'].includes(value)) {
                        parsed.type = value;
                    }
                    break;

                case 'after':
                    parsed.after = parseSearchDate(value, false);
                    break;

                case 'before':
                    parsed.before = parseSearchDate(value, true);
                    break;

                case 'path':
                    (negative ? parsed.notPaths : parsed.paths).push(value);
                    break;

                case 'protocol':
                    parsed.protocol = value.replace(/:$/, '').toLowerCase();
                    break;

                case 'depth':
                    parsed.depth = parseComparison(value);
                    break;

                case 'is':
                    if (!negative) {
                        parsed.states.add(value.toLowerCase());
                    }
                    break;

                default:
                    (negative ? parsed.notFree : parsed.free).push(token);
                    break;
            }
        }

        return parsed;
    }

    function compileSearchRegex(
        source,
        flags = '',
        caseSensitive = false
    ) {
        const sanitizedFlags = [...new Set(
            String(flags)
                .replace(/[gy]/g, '')
                .split('')
        )].join('');

        const finalFlags =
            !caseSensitive && !sanitizedFlags.includes('i')
                ? `${sanitizedFlags}i`
                : sanitizedFlags;

        return new RegExp(source, finalFlags);
    }

    function parseRegexLiteral(query) {
        const match = String(query).match(
            /^\/([\s\S]*)\/([a-z]*)$/i
        );

        return match
            ? {
                source: match[1],
                flags: match[2]
            }
            : {
                source: String(query),
                flags: ''
            };
    }

    function boundedLevenshtein(a, b, maxDistance = 2) {
        if (Math.abs(a.length - b.length) > maxDistance) {
            return maxDistance + 1;
        }

        let previous = Array.from(
            { length: b.length + 1 },
            (_, index) => index
        );

        for (let i = 1; i <= a.length; i += 1) {
            const current = [i];
            let rowMinimum = current[0];

            for (let j = 1; j <= b.length; j += 1) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;

                current[j] = Math.min(
                    current[j - 1] + 1,
                    previous[j] + 1,
                    previous[j - 1] + cost
                );

                rowMinimum = Math.min(rowMinimum, current[j]);
            }

            if (rowMinimum > maxDistance) {
                return maxDistance + 1;
            }

            previous = current;
        }

        return previous[b.length];
    }

    function fieldMatchesTerm(field, rawTerm) {
        const fuzzy = rawTerm.startsWith('~') && rawTerm.length > 1;
        const sourceTerm = fuzzy
            ? rawTerm.slice(1)
            : rawTerm;

        const fieldValue = normalizeSearchValue(field);
        const term = normalizeSearchValue(sourceTerm);

        if (!term) return true;

        if (fuzzy) {
            const words = fieldValue
                .split(/[^\p{L}\p{N}_-]+/u)
                .filter(Boolean);

            const maximumDistance = term.length >= 8 ? 2 : 1;

            return words.some(word =>
                boundedLevenshtein(
                    word,
                    term,
                    maximumDistance
                ) <= maximumDistance
            );
        }

        if (!editorSearchOptions.wholeWord) {
            return fieldValue.includes(term);
        }

        if (/^[\p{L}\p{N}_-]+$/u.test(term)) {
            const regex = new RegExp(
                `(?:^|[^\\p{L}\\p{N}_])` +
                `${escapeRegExp(term)}` +
                `(?:$|[^\\p{L}\\p{N}_])`,
                'u'
            );

            return regex.test(fieldValue);
        }

        return fieldValue.includes(term);
    }

    function allTermsMatch(fields, terms) {
        return terms.every(term =>
            fields.some(field => fieldMatchesTerm(field, term))
        );
    }

    function anyTermMatches(fields, terms) {
        return terms.some(term =>
            fields.some(field => fieldMatchesTerm(field, term))
        );
    }

    function buildNodeMatcher(query) {
        editorSearchError = '';

        if (!query.trim()) {
            return () => true;
        }

        if (editorSearchOptions.regex) {
            try {
                const literal = parseRegexLiteral(query);
                const regex = compileSearchRegex(
                    literal.source,
                    literal.flags,
                    editorSearchOptions.caseSensitive
                );

                return node => {
                    const meta = getNodeMeta(node);
                    const fields = [];

                    if (editorSearchOptions.fields.title) {
                        fields.push(meta.title);
                    }

                    if (
                        editorSearchOptions.fields.url &&
                        node.type === 'link'
                    ) {
                        fields.push(node.url || '');
                    }

                    if (editorSearchOptions.fields.tags) {
                        fields.push(...meta.tags);
                    }

                    return fields.some(field =>
                        regex.test(String(field ?? ''))
                    );
                };
            } catch (error) {
                editorSearchError = error.message;

                return () => false;
            }
        }

        const parsed = parseSearchQuery(query);

        if (parsed.states.has('duplicate')) {
            computeDuplicateIds();
        }

        return (node, context = getNodeContext(node)) => {
            const meta = getNodeMeta(node);
            const url = node.type === 'link'
                ? node.url || ''
                : '';

            const domain = getDomain(url);

            const generalFields = [];

            if (editorSearchOptions.fields.title) {
                generalFields.push(meta.title);
            }

            if (
                editorSearchOptions.fields.url &&
                node.type === 'link'
            ) {
                generalFields.push(url);
            }

            if (editorSearchOptions.fields.tags) {
                generalFields.push(...meta.tags);
            }

            if (parsed.type && node.type !== parsed.type) {
                return false;
            }

            if (
                parsed.protocol &&
                !url.toLowerCase().startsWith(`${parsed.protocol}:`)
            ) {
                return false;
            }

            for (const comparison of parsed.rating) {
                if (!compareNumber(meta.rating, comparison)) {
                    return false;
                }
            }

            if (
                parsed.after !== null &&
                node.addDate < parsed.after
            ) {
                return false;
            }

            if (
                parsed.before !== null &&
                node.addDate > parsed.before
            ) {
                return false;
            }

            if (
                parsed.depth &&
                !compareNumber(context.depth, parsed.depth)
            ) {
                return false;
            }

            const pathText = normalizeSearchValue(
                [
                    ...(context.path || []),
                    node.type === 'folder' ? node.title : ''
                ]
                    .filter(Boolean)
                    .join('/')
            );

            if (
                parsed.paths.some(path =>
                    !pathText.includes(normalizeSearchValue(path))
                )
            ) {
                return false;
            }

            if (
                parsed.notPaths.some(path =>
                    pathText.includes(normalizeSearchValue(path))
                )
            ) {
                return false;
            }

            if (
                parsed.domains.some(item =>
                    !domain.includes(normalizeSearchValue(item))
                )
            ) {
                return false;
            }

            if (
                parsed.notDomains.some(item =>
                    domain.includes(normalizeSearchValue(item))
                )
            ) {
                return false;
            }

            if (!allTermsMatch([meta.title], parsed.title)) {
                return false;
            }

            if (anyTermMatches([meta.title], parsed.notTitle)) {
                return false;
            }

            if (!allTermsMatch([url], parsed.url)) {
                return false;
            }

            if (anyTermMatches([url], parsed.notUrl)) {
                return false;
            }

            if (!allTermsMatch(meta.tags, parsed.tags)) {
                return false;
            }

            if (anyTermMatches(meta.tags, parsed.notTags)) {
                return false;
            }

            if (parsed.states.has('untagged') && meta.tags.length) {
                return false;
            }

            if (
                parsed.states.has('duplicate') &&
                !editorDuplicateIds.has(node.id)
            ) {
                return false;
            }

            if (
                parsed.states.has('invalid') &&
                (
                    node.type !== 'link' ||
                    isSafeHttpUrl(node.url)
                )
            ) {
                return false;
            }

            if (
                parsed.states.has('untitled') &&
                meta.title.trim()
            ) {
                return false;
            }

            if (
                parsed.states.has('params') &&
                (
                    node.type !== 'link' ||
                    !hasUrlParameters(node.url)
                )
            ) {
                return false;
            }

            if (anyTermMatches(generalFields, parsed.notFree)) {
                return false;
            }

            if (!parsed.free.length) {
                return true;
            }

            return editorSearchOptions.mode === 'or'
                ? anyTermMatches(generalFields, parsed.free)
                : allTermsMatch(generalFields, parsed.free);
        };
    }

    function searchAllEditorNodes(query) {
        const matchNode = buildNodeMatcher(query);
        const result = [];

        function walk(nodes, path = [], depth = 0) {
            for (const node of nodes) {
                const context = { path, depth };

                if (matchNode(node, context)) {
                    result.push({
                        node,
                        path: [...path],
                        depth
                    });
                }

                if (node.type === 'folder') {
                    walk(
                        node.children || [],
                        [...path, node.title],
                        depth + 1
                    );
                }
            }
        }

        walk(editorTree);

        return result;
    }

    // ═══════════════════════════════════════════════════════════════
    // Highlighting
    // ═══════════════════════════════════════════════════════════════

    function getHighlightTerms(query, fieldType) {
        if (!query) return [];

        if (editorSearchOptions.regex) {
            return [];
        }

        const parsed = parseSearchQuery(query);
        const result = [...parsed.free];

        if (fieldType === 'title') {
            result.push(...parsed.title);
        }

        if (fieldType === 'url') {
            result.push(
                ...parsed.url,
                ...parsed.domains
            );
        }

        if (fieldType === 'tag') {
            result.push(...parsed.tags);
        }

        return [...new Set(
            result
                .filter(Boolean)
                .filter(term => !term.startsWith('~'))
        )].sort((a, b) => b.length - a.length);
    }

    function highlightWithRegex(text, regex) {
        const source = String(text ?? '');
        let output = '';
        let lastIndex = 0;
        let match;

        const flags = [...new Set(
            `${regex.flags.replace(/[gy]/g, '')}g`.split('')
        )].join('');

        const globalRegex = new RegExp(regex.source, flags);

        while ((match = globalRegex.exec(source)) !== null) {
            output += escapeHtml(
                source.slice(lastIndex, match.index)
            );

            output += `<mark>${escapeHtml(match[0])}</mark>`;
            lastIndex = match.index + match[0].length;

            if (match[0].length === 0) {
                globalRegex.lastIndex += 1;
            }
        }

        output += escapeHtml(source.slice(lastIndex));
        return output;
    }

    function highlightText(text, fieldType) {
        const source = String(text ?? '');

        if (!editorSearch) {
            return escapeHtml(source);
        }

        try {
            if (editorSearchOptions.regex) {
                const literal = parseRegexLiteral(editorSearch);
                const regex = compileSearchRegex(
                    literal.source,
                    literal.flags,
                    editorSearchOptions.caseSensitive
                );

                return highlightWithRegex(source, regex);
            }

            const terms = getHighlightTerms(
                editorSearch,
                fieldType
            );

            if (!terms.length) {
                return escapeHtml(source);
            }

            const regex = new RegExp(
                terms.map(escapeRegExp).join('|'),
                editorSearchOptions.caseSensitive
                    ? 'gu'
                    : 'giu'
            );

            return highlightWithRegex(source, regex);
        } catch {
            return escapeHtml(source);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Filter / sort
    // ═══════════════════════════════════════════════════════════════

    function applyEditorFilters(items) {
        let result = [...items];

        if (editorFilterType === 'link') {
            result = result.filter(item => item.type === 'link');
        } else if (editorFilterType === 'folder') {
            result = result.filter(item => item.type === 'folder');
        }

        if (editorFilterRating > 0) {
            result = result.filter(item =>
                Number(item.rating) >= editorFilterRating
            );
        }

        if (editorFilterTag) {
            const query = normalizeSearchValue(editorFilterTag);

            result = result.filter(item =>
                (item.tags || []).some(tag =>
                    normalizeSearchValue(tag).includes(query)
                )
            );
        }

        if (editorFilterDomain) {
            const query = normalizeSearchValue(editorFilterDomain);

            result = result.filter(item =>
                item.type === 'link' &&
                normalizeSearchValue(
                    getDomain(item.url)
                ).includes(query)
            );
        }

        if (editorFilterTagUnset) {
            result = result.filter(item =>
                !(item.tags || []).length
            );
        }

        if (editorSort !== 'default') {
            result.sort((a, b) => {
                switch (editorSort) {
                    case 'name':
                        return a.title.localeCompare(
                            b.title,
                            'ja',
                            { sensitivity: 'base' }
                        );

                    case 'name-d':
                        return b.title.localeCompare(
                            a.title,
                            'ja',
                            { sensitivity: 'base' }
                        );

                    case 'rating':
                        return (b.rating || 0) - (a.rating || 0);

                    case 'rating-d':
                        return (a.rating || 0) - (b.rating || 0);

                    case 'url':
                        return (a.url || '').localeCompare(b.url || '');

                    case 'date':
                        return (b.addDate || 0) - (a.addDate || 0);

                    case 'date-d':
                        return (a.addDate || 0) - (b.addDate || 0);

                    default:
                        return 0;
                }
            });
        }

        return result;
    }

    function canManuallyReorder() {
        return (
            !editorSearch &&
            editorSort === 'default' &&
            editorFilterType === 'all' &&
            editorFilterRating === 0 &&
            !editorFilterTag &&
            !editorFilterDomain &&
            !editorFilterTagUnset
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // Favicon lazy loading
    // ═══════════════════════════════════════════════════════════════

    const faviconCache = new Map();

    function getFaviconUrl(rawUrl) {
        if (!settings.faviconEnabled) return '';

        try {
            const hostname = new URL(rawUrl).hostname;

            if (faviconCache.has(hostname)) {
                return faviconCache.get(hostname);
            }

            const url =
                'https://www.google.com/s2/favicons' +
                `?sz=32&domain=${encodeURIComponent(hostname)}`;

            faviconCache.set(hostname, url);
            return url;
        } catch {
            return '';
        }
    }

    const faviconObserver =
        'IntersectionObserver' in window
            ? new IntersectionObserver(entries => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;

                    const image = entry.target;
                    const source = image.dataset.src;

                    if (source) {
                        image.src = source;
                        image.removeAttribute('data-src');
                    }

                    faviconObserver.unobserve(image);
                }
            }, {
                root: $('#ed-content-list'),
                rootMargin: '200px'
            })
            : null;

    function observeFavicons() {
        const images = $$('#ed-content-list img[data-src]');

        for (const image of images) {
            if (faviconObserver) {
                faviconObserver.observe(image);
            } else {
                image.src = image.dataset.src;
                image.removeAttribute('data-src');
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Virtual list
    // ═══════════════════════════════════════════════════════════════

    const virtualList = {
        enabled: false,
        threshold: 500,
        rowHeight: 52,
        buffer: 12,
        records: [],
        start: -1,
        end: -1,
        raf: null
    };

    function resetVirtualList() {
        virtualList.enabled = false;
        virtualList.records = [];
        virtualList.start = -1;
        virtualList.end = -1;

        $('#ed-content-list').classList.remove('virtual');
    }

    function renderVirtualList(force = false) {
        if (!virtualList.enabled) return;

        const list = $('#ed-content-list');
        const total = virtualList.records.length;
        const viewportHeight = list.clientHeight || 500;
        const scrollTop = list.scrollTop;

        const start = Math.max(
            0,
            Math.floor(scrollTop / virtualList.rowHeight) -
            virtualList.buffer
        );

        const end = Math.min(
            total,
            Math.ceil(
                (scrollTop + viewportHeight) /
                virtualList.rowHeight
            ) + virtualList.buffer
        );

        if (
            !force &&
            start === virtualList.start &&
            end === virtualList.end
        ) {
            return;
        }

        virtualList.start = start;
        virtualList.end = end;

        const topHeight = start * virtualList.rowHeight;
        const bottomHeight =
            (total - end) * virtualList.rowHeight;

        const rows = virtualList.records
            .slice(start, end)
            .map(record => renderContentItem(record, false))
            .join('');

        list.innerHTML =
            `<div class="virtual-spacer" style="height:${topHeight}px;flex:none"></div>` +
            rows +
            `<div class="virtual-spacer" style="height:${bottomHeight}px;flex:none"></div>`;

        updateSelectionUi();
        observeFavicons();
    }

    $('#ed-content-list').addEventListener('scroll', () => {
        if (!virtualList.enabled) return;
        if (virtualList.raf) return;

        virtualList.raf = requestAnimationFrame(() => {
            virtualList.raf = null;
            renderVirtualList();
        });
    }, { passive: true });

    // ═══════════════════════════════════════════════════════════════
    // Rendering
    // ═══════════════════════════════════════════════════════════════

    function renderEditorAll() {
        if (editorRenderRaf) return;

        editorRenderRaf = requestAnimationFrame(() => {
            editorRenderRaf = null;

            renderEditorTree();
            renderEditorBreadcrumb();
            renderEditorContent();
            updateEditorStats();
            renderEditorTabs();
            updateEditorToolbar();
        });
    }

    function updateEditorStats() {
        const counts = countEditorTree();

        $('#ed-stats').textContent =
            `${counts.links.toLocaleString()} L · ` +
            `${counts.folders.toLocaleString()} F`;

        $('#ed-sb-counts').textContent =
            `${counts.links.toLocaleString()} リンク / ` +
            `${counts.folders.toLocaleString()} フォルダ`;

        const empty = editorTree.length === 0;

        $('#tb-export').disabled = empty;
        $('#tb-export-json').disabled = empty;
        $('#tb-dedup').disabled = empty;
        $('#tb-find-dup').disabled = empty;
        $('#tb-add-link').disabled = empty;
        $('#tb-add-folder').disabled = empty;
    }

    function updateEditorToolbar() {
        const selectedCount = editorSelection.size;
        const single = selectedCount === 1;

        $('#tb-sel-group').classList.toggle(
            'disabled',
            selectedCount === 0
        );

        $('#tb-edit').disabled = !single;

        $('#tb-copy-url').disabled = ![...editorSelection]
            .some(id => editorFind(id)?.type === 'link');
    }

    function renderEditorTree() {
        const container = $('#ed-tree-scroll');
        const folders = editorTree.filter(
            node => node.type === 'folder'
        );

        if (!editorTree.length) {
            container.innerHTML =
                '<div class="tree-empty">ファイルを開いて<br>開始してください</div>';
            return;
        }

        if (!folders.length) {
            container.innerHTML =
                '<div class="tree-empty">フォルダなし<br>Root直下にリンクがあります</div>';
            return;
        }

        const selectedFolderId = editorPath.at(-1)?.id ?? null;

        function renderFolder(node, depth) {
            const expanded = editorExpanded.has(node.id);
            const selected = node.id === selectedFolderId;
            const childFolders = (node.children || [])
                .filter(child => child.type === 'folder');

            let html =
                `<div class="tn${selected ? ' selected' : ''}" ` +
                `data-id="${escapeHtml(node.id)}">` +
                `<span class="tn-ind" style="width:${depth * 14}px"></span>`;

            if (childFolders.length) {
                html +=
                    `<span class="tn-tog" data-action="tree-toggle">` +
                    `${expanded ? '▼' : '▶'}</span>`;
            } else {
                html += '<span class="tn-tog-ph"></span>';
            }

            html +=
                '<div class="tn-body" data-action="tree-open">' +
                '<span class="tn-ico">📁</span>' +
                `<span class="tn-lbl">${escapeHtml(node.title)}</span>` +
                `<span class="tn-cnt">${countEditorLinks(node).toLocaleString()}</span>` +
                '</div></div>';

            if (expanded) {
                for (const child of childFolders) {
                    html += renderFolder(child, depth + 1);
                }
            }

            return html;
        }

        container.innerHTML = folders
            .map(folder => renderFolder(folder, 0))
            .join('');
    }

    function renderEditorBreadcrumb() {
        let html =
            '<span class="bc-item" data-action="nav-root">🏠 Root</span>';

        editorPath.forEach((segment, index) => {
            html += '<span class="bc-sep">›</span>';

            if (index === editorPath.length - 1) {
                html +=
                    `<span class="bc-cur">📁 ${escapeHtml(segment.title)}</span>`;
            } else {
                html +=
                    `<span class="bc-item" data-action="nav-path" ` +
                    `data-index="${index}">📁 ${escapeHtml(segment.title)}</span>`;
            }
        });

        $('#ed-breadcrumb').innerHTML = html;
    }

    function buildVisibleRecords() {
        if (editorShowDuplicates) {
            computeDuplicateIds();
        }

        if (editorSearch && editorSearchDeep) {
            const results = searchAllEditorNodes(editorSearch);
            const filteredNodes = applyEditorFilters(
                results.map(record => record.node)
            );

            const recordById = new Map(
                results.map(record => [record.node.id, record])
            );

            return filteredNodes.map((node, index) => {
                const source = recordById.get(node.id);

                return {
                    node,
                    index,
                    total: filteredNodes.length,
                    searchPath: source?.path?.join(' › ') || 'Root'
                };
            });
        }

        let items = getCurrentEditorItems();

        if (editorSearch) {
            const matcher = buildNodeMatcher(editorSearch);
            const currentContext = {
                path: editorPath.map(segment => segment.title),
                depth: editorPath.length
            };

            items = items.filter(item =>
                matcher(item, currentContext)
            );
        } else {
            editorSearchError = '';
        }

        items = applyEditorFilters(items);

        return items.map((node, index) => ({
            node,
            index,
            total: items.length,
            searchPath: null
        }));
    }

    function renderEditorContent() {
        const list = $('#ed-content-list');
        const records = buildVisibleRecords();

        editorVisibleRecords = records;
        editorVisibleIds = records.map(record => record.node.id);

        if (editorSearchError) {
            $('#ed-search-input').setAttribute('aria-invalid', 'true');
            $('#ed-search-input').title =
                `正規表現エラー: ${editorSearchError}`;

            setStatus(`❌ 正規表現エラー: ${editorSearchError}`);
        } else {
            $('#ed-search-input').removeAttribute('aria-invalid');
            $('#ed-search-input').title = '';
        }

        editorSearchMatchIndex = editorVisibleIds.indexOf(
            [...editorSelection][0]
        );

        updateSearchNavigationCount();

        if (!records.length) {
            resetVirtualList();

            const filtered = Boolean(
                editorSearch ||
                editorFilterType !== 'all' ||
                editorFilterRating ||
                editorFilterTag ||
                editorFilterDomain ||
                editorFilterTagUnset
            );

            list.innerHTML =
                '<div class="ed-empty">' +
                `<span class="big-ico">${filtered ? '🔍' : '📭'}</span>` +
                `<span>${filtered ? '結果なし' : 'このフォルダは空です'}</span>` +
                '</div>';

            return;
        }

        const useVirtual =
            records.length > virtualList.threshold;

        if (useVirtual) {
            virtualList.enabled = true;
            virtualList.records = records;
            virtualList.start = -1;
            virtualList.end = -1;

            list.classList.add('virtual');
            renderVirtualList(true);
        } else {
            resetVirtualList();

            const allowDrag = canManuallyReorder();

            list.innerHTML = records
                .map(record =>
                    renderContentItem(record, allowDrag)
                )
                .join('');

            updateSelectionUi();
            observeFavicons();
        }
    }

    function renderContentItem(record, allowDrag) {
        const item = record.node;
        const selected = editorSelection.has(item.id);
        const active = editorActivePreviewId === item.id;
        const duplicate =
            editorShowDuplicates &&
            editorDuplicateIds.has(item.id);

        const classes = ['ci'];

        if (selected) classes.push('selected');
        if (active) classes.push('active');
        if (duplicate) classes.push('dup-url');

        const draggable =
            allowDrag &&
            !record.searchPath &&
            !virtualList.enabled;

        const badges = renderBadges(
            item.tags || [],
            item.rating || 0
        );

        const displayTitle = highlightText(
            item.title,
            'title'
        );

        const canMove = canManuallyReorder();

        if (item.type === 'link') {
            const favicon = getFaviconUrl(item.url);

            const icon = favicon
                ? (
                    `<img data-src="${escapeHtml(favicon)}" alt="" ` +
                    'onerror="this.hidden=true;this.nextElementSibling.hidden=false">' +
                    '<span hidden>🔗</span>'
                )
                : '🔗';

            const displayUrl = highlightText(
                item.url || '',
                'url'
            );

            return (
                `<div class="${classes.join(' ')}" ` +
                `data-id="${escapeHtml(item.id)}" ` +
                `role="listitem" aria-selected="${selected}" ` +
                `${draggable ? 'draggable="true"' : ''}>` +

                '<div class="ci-chk-col">' +
                `<input type="checkbox" class="ci-chk" ${selected ? 'checked' : ''} ` +
                `aria-label="${selected ? '選択解除' : '選択'}">` +
                '</div>' +

                '<div class="ci-sel" data-action="select">' +
                `<span class="ci-ico">${icon}</span>` +
                '<div class="ci-info">' +
                `<div class="ci-ttl">${displayTitle}` +
                `${badges ? `<span class="ci-badges">${badges}</span>` : ''}` +
                '</div>' +
                '<div class="ci-meta-row">' +

                (record.searchPath
                    ? `<span class="ci-path">📁 ${escapeHtml(record.searchPath)}</span>`
                    : `<span class="ci-url" data-action="open">${displayUrl}</span>`) +

                '</div></div></div>' +

                '<div class="ci-acts">' +

                (record.searchPath
                    ? '<button class="ia-btn" data-action="goto-folder" title="フォルダを開く">📂</button>'
                    : '') +

                `<button class="ia-btn" data-action="open" title="新しいタブで開く" ` +
                `${isSafeHttpUrl(item.url) ? '' : 'disabled'}>↗</button>` +

                '<button class="ia-btn" data-action="edit" title="編集">✏️</button>' +

                (!record.searchPath
                    ? (
                        `<button class="ia-btn" data-action="move-up" ` +
                        `${!canMove || record.index === 0 ? 'disabled' : ''}>↑</button>` +
                        `<button class="ia-btn" data-action="move-down" ` +
                        `${!canMove || record.index === record.total - 1 ? 'disabled' : ''}>↓</button>`
                    )
                    : '') +

                '<button class="ia-btn ia-del" data-action="delete" title="削除">🗑️</button>' +
                '</div></div>'
            );
        }

        const directFolders = (item.children || [])
            .filter(child => child.type === 'folder')
            .length;

        return (
            `<div class="${classes.join(' ')}" ` +
            `data-id="${escapeHtml(item.id)}" ` +
            `role="listitem" aria-selected="${selected}" ` +
            `${draggable ? 'draggable="true"' : ''}>` +

            '<div class="ci-chk-col">' +
            `<input type="checkbox" class="ci-chk" ${selected ? 'checked' : ''}>` +
            '</div>' +

            '<div class="ci-nav" data-action="folder-open">' +
            '<span class="ci-ico">📁</span>' +
            '<div class="ci-info">' +
            `<div class="ci-ttl">${displayTitle}` +
            `${badges ? `<span class="ci-badges">${badges}</span>` : ''}` +
            '</div>' +
            '<div class="ci-meta-row">' +

            (record.searchPath
                ? `<span class="ci-path">📁 ${escapeHtml(record.searchPath)} • ` +
                `${countEditorLinks(item).toLocaleString()} リンク</span>`
                : `<span class="ci-sub">` +
                `${countEditorLinks(item).toLocaleString()} リンク · ` +
                `${directFolders.toLocaleString()} フォルダ</span>`) +

            '</div></div>' +
            '<span class="ci-nav-hint">↵ 開く</span>' +
            '</div>' +

            '<div class="ci-acts">' +
            '<button class="ia-btn" data-action="folder-open" title="開く">📂</button>' +
            '<button class="ia-btn" data-action="folder-new-tab" title="新しいタブ">➕</button>' +

            (!record.searchPath
                ? (
                    `<button class="ia-btn" data-action="move-up" ` +
                    `${!canMove || record.index === 0 ? 'disabled' : ''}>↑</button>` +
                    `<button class="ia-btn" data-action="move-down" ` +
                    `${!canMove || record.index === record.total - 1 ? 'disabled' : ''}>↓</button>`
                )
                : '') +

            '<button class="ia-btn ia-del" data-action="delete" title="削除">🗑️</button>' +
            '</div></div>'
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // Search navigation
    // ═══════════════════════════════════════════════════════════════

    function updateSearchNavigationCount() {
        const count = $('#ed-search-count');

        if (!editorSearch) {
            count.textContent = '';
            return;
        }

        const total = editorVisibleIds.length;

        count.textContent = total
            ? `${Math.max(0, editorSearchMatchIndex + 1)}/${total}`
            : '0件';
    }

    function goToSearchMatch(direction) {
        if (!editorSearch || !editorVisibleIds.length) return;

        editorSearchMatchIndex =
            (
                editorSearchMatchIndex +
                direction +
                editorVisibleIds.length
            ) % editorVisibleIds.length;

        const id = editorVisibleIds[editorSearchMatchIndex];

        editorSelection.clear();
        editorSelection.add(id);
        editorLastSelectedId = id;

        if (virtualList.enabled) {
            $('#ed-content-list').scrollTop =
                editorSearchMatchIndex *
                virtualList.rowHeight;

            renderVirtualList(true);
        }

        requestAnimationFrame(() => {
            const row = document.querySelector(
                `#ed-content-list .ci[data-id="${CSS.escape(id)}"]`
            );

            row?.scrollIntoView({
                block: 'center',
                behavior: 'smooth'
            });

            updateSelectionUi();
        });

        const node = editorFind(id);

        if (
            node?.type === 'link' &&
            settings.autoPreview &&
            editorPreviewEnabled
        ) {
            previewEditorLink(id);
        }

        updateSearchNavigationCount();
    }

    // ═══════════════════════════════════════════════════════════════
    // Navigation / selection
    // ═══════════════════════════════════════════════════════════════

    function navigateEditorRoot() {
        editorPath = [];
        editorSearch = '';
        editorSelection.clear();

        $('#ed-search-input').value = '';

        renderEditorAll();
        syncActiveEditorTab();
    }

    function navigateEditorPath(index) {
        editorPath = editorPath.slice(0, index + 1);
        editorSearch = '';
        editorSelection.clear();

        $('#ed-search-input').value = '';

        renderEditorAll();
        syncActiveEditorTab();
    }

    function navigateEditorUp() {
        if (!editorPath.length) return;

        editorPath.pop();
        editorSearch = '';
        editorSelection.clear();

        $('#ed-search-input').value = '';

        renderEditorAll();
        syncActiveEditorTab();
    }

    function openEditorFolder(id) {
        const folder = editorFind(id);

        if (!folder || folder.type !== 'folder') return;

        editorPath = getFolderPath(id);
        editorExpanded.add(id);

        editorSearch = '';
        editorSelection.clear();

        $('#ed-search-input').value = '';

        renderEditorAll();
        syncActiveEditorTab();
    }

    function goToEditorNodeFolder(itemId) {
        const node = editorFind(itemId);
        if (!node) return;

        const parentId = editorParentIdById.get(itemId);

        editorPath = parentId
            ? getFolderPath(parentId)
            : [];

        editorSearch = '';
        $('#ed-search-input').value = '';

        renderEditorAll();
        syncActiveEditorTab();

        setTimeout(() => {
            const row = document.querySelector(
                `#ed-content-list .ci[data-id="${CSS.escape(itemId)}"]`
            );

            row?.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }, 100);
    }

    function selectEditorItem(id, event = {}) {
        if (
            event.shiftKey &&
            editorLastSelectedId &&
            editorVisibleIds.includes(editorLastSelectedId)
        ) {
            const first = editorVisibleIds.indexOf(
                editorLastSelectedId
            );

            const second = editorVisibleIds.indexOf(id);

            if (first !== -1 && second !== -1) {
                const start = Math.min(first, second);
                const end = Math.max(first, second);

                if (!event.ctrlKey && !event.metaKey) {
                    editorSelection.clear();
                }

                for (let index = start; index <= end; index += 1) {
                    editorSelection.add(editorVisibleIds[index]);
                }
            }
        } else if (event.ctrlKey || event.metaKey) {
            if (editorSelection.has(id)) {
                editorSelection.delete(id);
            } else {
                editorSelection.add(id);
            }

            editorLastSelectedId = id;
        } else {
            editorSelection.clear();
            editorSelection.add(id);
            editorLastSelectedId = id;
        }

        updateSelectionUi();

        if (editorSelection.size === 1) {
            const node = editorFind(id);

            if (
                node?.type === 'link' &&
                settings.autoPreview &&
                editorPreviewEnabled
            ) {
                previewEditorLink(id);
            }
        }
    }

    function toggleEditorCheckbox(id) {
        if (editorSelection.has(id)) {
            editorSelection.delete(id);
        } else {
            editorSelection.add(id);
        }

        editorLastSelectedId = id;
        updateSelectionUi();
    }

    function updateSelectionUi() {
        $$('#ed-content-list .ci[data-id]').forEach(row => {
            const selected = editorSelection.has(row.dataset.id);

            row.classList.toggle('selected', selected);
            row.classList.toggle(
                'active',
                editorActivePreviewId === row.dataset.id
            );

            row.setAttribute(
                'aria-selected',
                String(selected)
            );

            const checkbox = row.querySelector('.ci-chk');

            if (checkbox) {
                checkbox.checked = selected;
            }
        });

        $('#ed-content-list').classList.toggle(
            'has-sel',
            editorSelection.size > 0
        );

        updateEditorToolbar();
    }

    // ═══════════════════════════════════════════════════════════════
    // CRUD
    // ═══════════════════════════════════════════════════════════════

    function addEditorLink() {
        let createdId = null;

        editorMutate(() => {
            const node = {
                id: generateEditorId(),
                type: 'link',
                title: '新しいリンク',
                url: '',
                tags: [],
                rating: 0,
                addDate: Math.floor(Date.now() / 1000)
            };

            getCurrentEditorItems().push(node);

            editorSelection.clear();
            editorSelection.add(node.id);

            createdId = node.id;
            return true;
        });

        if (createdId) {
            setStatus('✅ リンクを追加しました');
            setTimeout(() => openEditorModal(createdId), 60);
        }
    }

    function addEditorFolder(root = false) {
        let createdId = null;

        editorMutate(() => {
            const node = {
                id: generateEditorId(),
                type: 'folder',
                title: '新しいフォルダ',
                tags: [],
                rating: 0,
                addDate: Math.floor(Date.now() / 1000),
                children: []
            };

            if (root) {
                editorTree.push(node);
                editorExpanded.add(node.id);
            } else {
                getCurrentEditorItems().push(node);
            }

            editorSelection.clear();
            editorSelection.add(node.id);

            createdId = node.id;
            return true;
        });

        if (createdId) {
            setStatus('✅ フォルダを追加しました');
            setTimeout(() => openEditorModal(createdId), 60);
        }
    }

    function getTopLevelSelectedIds() {
        const selected = new Set(editorSelection);

        return [...selected].filter(id => {
            let parentId = editorParentIdById.get(id);

            while (parentId) {
                if (selected.has(parentId)) return false;
                parentId = editorParentIdById.get(parentId);
            }

            return true;
        });
    }

    async function deleteEditorItem(id) {
        const node = editorFind(id);
        if (!node) return;

        const linkCount = node.type === 'folder'
            ? countEditorLinks(node)
            : 0;

        const confirmed = await uiConfirm(
            node.type === 'folder' && linkCount
                ? `「${node.title}」と中の${linkCount.toLocaleString()}件を削除しますか？`
                : `「${node.title}」を削除しますか？`,
            { title: '🗑️ 削除', danger: true, okLabel: '削除' }
        );

        if (!confirmed) return;

        editorMutate(() => {
            const parentArray = editorFindParentArray(id);
            if (!parentArray) return false;

            const index = parentArray.findIndex(
                item => item.id === id
            );

            if (index < 0) return false;

            parentArray.splice(index, 1);
            editorSelection.delete(id);

            if (editorPath.some(segment => segment.id === id)) {
                editorPath = [];
            }

            return true;
        });

        setStatus('🗑️ 削除しました');
    }

    async function deleteSelectedEditorItems() {
        if (!editorSelection.size) return;

        const ids = getTopLevelSelectedIds();

        const confirmed = await uiConfirm(
            `${ids.length.toLocaleString()}件を削除しますか？`,
            { title: '🗑️ 削除', danger: true, okLabel: '削除' }
        );

        if (!confirmed) return;

        editorMutate(() => {
            let removed = 0;

            for (const id of ids) {
                const parentArray = editorFindParentArray(id);

                if (!parentArray) continue;

                const index = parentArray.findIndex(
                    node => node.id === id
                );

                if (index >= 0) {
                    parentArray.splice(index, 1);
                    removed += 1;
                }
            }

            editorSelection.clear();
            editorPath = editorPath.filter(
                segment => !ids.includes(segment.id)
            );

            return removed > 0;
        });

        setStatus('🗑️ 削除しました');
    }

    function moveEditorItem(id, direction) {
        if (!canManuallyReorder()) {
            toast('検索・フィルタ・ソート中は手動移動できません', 'err');
            return;
        }

        const parentArray = editorFindParentArray(id);
        if (!parentArray) return;

        const index = parentArray.findIndex(
            node => node.id === id
        );

        const targetIndex = index + direction;

        if (
            index < 0 ||
            targetIndex < 0 ||
            targetIndex >= parentArray.length
        ) {
            return;
        }

        editorMutate(() => {
            [
                parentArray[index],
                parentArray[targetIndex]
            ] = [
                    parentArray[targetIndex],
                    parentArray[index]
                ];

            return true;
        });

        setStatus('✅ 移動しました');
    }

    function collectDescendantIds(node, result) {
        if (node.type !== 'folder') return;

        for (const child of node.children || []) {
            result.add(child.id);
            collectDescendantIds(child, result);
        }
    }

    function openBulkMoveModal() {
        if (!editorSelection.size) return;

        const forbidden = new Set(editorSelection);

        for (const id of editorSelection) {
            const node = editorFind(id);
            if (node) collectDescendantIds(node, forbidden);
        }

        const folders = [];

        function walk(nodes, depth = 0) {
            for (const node of nodes) {
                if (
                    node.type === 'folder' &&
                    !forbidden.has(node.id)
                ) {
                    folders.push({
                        id: node.id,
                        title: node.title,
                        depth
                    });

                    walk(node.children || [], depth + 1);
                }
            }
        }

        walk(editorTree);

        $('#ed-move-list').innerHTML =
            '<div class="move-item" data-destination="__root__">🏠 Root（ルート直下）</div>' +
            folders.map(folder =>
                `<div class="move-item" ` +
                `data-destination="${escapeHtml(folder.id)}" ` +
                `style="padding-left:${12 + folder.depth * 14}px">` +
                `📁 ${escapeHtml(folder.title)}</div>`
            ).join('');

        $('#ed-move-modal').classList.add('show');
    }

    function moveSelectionToFolder(destinationId) {
        const ids = getTopLevelSelectedIds();
        if (!ids.length) return;

        editorMutate(() => {
            const destination = destinationId === null
                ? editorTree
                : editorFind(destinationId)?.children;

            if (!destination) return false;

            const movedNodes = [];

            for (const id of ids) {
                const source = editorFindParentArray(id);

                if (!source || source === destination) continue;

                const index = source.findIndex(
                    node => node.id === id
                );

                if (index < 0) continue;

                const [node] = source.splice(index, 1);
                movedNodes.push(node);
            }

            destination.push(...movedNodes);
            editorSelection.clear();

            return movedNodes.length > 0;
        });

        $('#ed-move-modal').classList.remove('show');
        setStatus('📁 移動しました');
    }

    async function copySelectedUrls() {
        const urls = [...editorSelection]
            .map(id => editorFind(id))
            .filter(node => node?.type === 'link' && node.url)
            .map(node => node.url);

        if (!urls.length) {
            toast('URLがありません', 'err');
            return;
        }

        await copyText(urls.join('\n'));
        toast(`${urls.length.toLocaleString()}件のURLをコピーしました`, 'ok');
    }

    async function copySelectedTitles() {
        const titles = [...editorSelection]
            .map(id => editorFind(id)?.title)
            .filter(Boolean);

        if (!titles.length) return;

        await copyText(titles.join('\n'));
        toast(`${titles.length.toLocaleString()}件のタイトルをコピーしました`, 'ok');
    }

    const OPEN_TABS_LIMIT = 15;

    async function openSelectedLinksInTabs() {
        const urls = [...editorSelection]
            .map(id => editorFind(id))
            .filter(node => node?.type === 'link')
            .map(node => getSafeHttpUrl(node.url))
            .filter(Boolean);

        if (!urls.length) {
            toast('開けるリンクがありません', 'err');
            return;
        }

        const truncated = urls.length > OPEN_TABS_LIMIT;

        const confirmed = await uiConfirm(
            truncated
                ? `${urls.length.toLocaleString()}件ありますが、最初の${OPEN_TABS_LIMIT}件のみ開きます。よろしいですか？`
                : `${urls.length.toLocaleString()}件のリンクを新しいタブで開きます。よろしいですか？`,
            { title: '🌐 一括オープン', danger: false, okLabel: '開く' }
        );

        if (!confirmed) return;

        urls.slice(0, OPEN_TABS_LIMIT).forEach((url, index) => {
            setTimeout(() => {
                const opened = window.open(url, '_blank', 'noopener,noreferrer');

                if (opened) opened.opener = null;
            }, index * 180);
        });

        toast('タブを開いています（ポップアップブロックに注意）', 'ok');
    }

    async function editSelectedTags() {
        const ids = [...editorSelection];
        if (!ids.length) return;

        const first = editorFind(ids[0]);

        const initial = ids.length === 1
            ? (first?.tags || []).join(' ')
            : '';

        const input = await uiPrompt(
            '🏷️ タグ編集',
            `選択中${ids.length}件のタグを入力してください（スペースまたはカンマ区切り）`,
            initial,
            '例: javascript tutorial'
        );

        if (input === null) return;

        const tags = normalizeTags(
            input.split(/[\s,]+/)
        );

        editorMutate(() => {
            let changed = false;

            for (const id of ids) {
                const node = editorFind(id);
                if (!node) continue;

                node.tags = [...tags];
                changed = true;
            }

            return changed;
        });

        toast('タグを更新しました', 'ok');
    }

    async function editSelectedRating() {
        const ids = [...editorSelection];
        if (!ids.length) return;

        const first = editorFind(ids[0]);

        const input = await uiPrompt(
            '⭐ レーティング',
            `選択中${ids.length}件に設定する値を 0〜5 で入力してください`,
            ids.length === 1
                ? String(first?.rating || 0)
                : '0',
            '0〜5'
        );

        if (input === null) return;

        const rating = Number(input);

        if (
            !Number.isInteger(rating) ||
            rating < 0 ||
            rating > 5
        ) {
            toast('0〜5の整数を入力してください', 'err');
            return;
        }

        editorMutate(() => {
            let changed = false;

            for (const id of ids) {
                const node = editorFind(id);
                if (!node) continue;

                node.rating = rating;
                changed = true;
            }

            return changed;
        });

        toast('レーティングを更新しました', 'ok');
    }

    // ═══════════════════════════════════════════════════════════════
    // Edit modal
    // ═══════════════════════════════════════════════════════════════

    function openEditorModal(id) {
        const node = editorFind(id);
        if (!node) return;

        editorEditingId = id;
        editorModalRating = Number(node.rating) || 0;

        $('#ed-modal-title').textContent =
            node.type === 'link'
                ? '🔗 リンクを編集'
                : '📁 フォルダを編集';

        $('#ed-m-name').value = node.title;
        $('#ed-m-tags').value = (node.tags || []).join(' ');

        $('#ed-m-url-f').style.display =
            node.type === 'link'
                ? 'block'
                : 'none';

        if (node.type === 'link') {
            $('#ed-m-url').value = node.url || '';
        }

        updateStarPicker();

        const allTags = new Set();

        function collectTags(nodes) {
            for (const item of nodes) {
                for (const tag of item.tags || []) {
                    allTags.add(tag);
                }

                if (item.type === 'folder') {
                    collectTags(item.children || []);
                }
            }
        }

        collectTags(editorTree);

        $('#ed-m-tag-sug').innerHTML = [...allTags]
            .slice(0, 30)
            .map(tag =>
                `<button type="button" class="tag-bd tag-suggestion" ` +
                `data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
            )
            .join('');

        $('#ed-modal').classList.add('show');
        $('#ed-m-name').focus();
        $('#ed-m-name').select();
    }

    function closeEditorModal() {
        editorEditingId = null;
        $('#ed-modal').classList.remove('show');
    }

    function updateStarPicker() {
        $$('#ed-m-stars .star-pick').forEach(button => {
            button.classList.toggle(
                'on',
                Number(button.dataset.v) <= editorModalRating
            );

            button.style.color = '';
        });
    }

    function saveEditorModal() {
        const node = editorFind(editorEditingId);
        if (!node) return;

        const title = $('#ed-m-name').value.trim();

        if (!title) {
            toast('タイトルを入力してください', 'err');
            return;
        }

        let url = node.url || '';

        if (node.type === 'link') {
            const inputUrl = $('#ed-m-url').value.trim();

            if (inputUrl && !isSafeHttpUrl(inputUrl)) {
                toast('http または https のURLを入力してください', 'err');
                return;
            }

            url = inputUrl
                ? cleanUrl(inputUrl)
                : '';
        }

        const tags = normalizeTags(
            $('#ed-m-tags').value.split(/[\s,]+/)
        );

        editorMutate(() => {
            node.title = title;
            node.tags = tags;
            node.rating = editorModalRating;

            if (node.type === 'link') {
                node.url = url;
            }

            for (const segment of editorPath) {
                if (segment.id === node.id) {
                    segment.title = title;
                }
            }

            return true;
        });

        closeEditorModal();
        toast('保存しました', 'ok');
    }

    $$('#ed-m-stars .star-pick').forEach(button => {
        button.addEventListener('click', () => {
            const value = Number(button.dataset.v);

            editorModalRating =
                editorModalRating === value
                    ? 0
                    : value;

            updateStarPicker();
        });

        button.addEventListener('mouseenter', () => {
            const value = Number(button.dataset.v);

            $$('#ed-m-stars .star-pick').forEach(star => {
                star.style.color =
                    Number(star.dataset.v) <= value
                        ? 'var(--warn)'
                        : 'var(--border-hover)';
            });
        });

        button.addEventListener('mouseleave', updateStarPicker);
    });

    $('#ed-m-tag-sug').addEventListener('click', event => {
        const suggestion = event.target.closest('[data-tag]');
        if (!suggestion) return;

        const input = $('#ed-m-tags');
        const current = normalizeTags(
            input.value.split(/[\s,]+/)
        );

        if (!current.includes(suggestion.dataset.tag)) {
            current.push(suggestion.dataset.tag);
        }

        input.value = current.join(' ');
    });

    // ═══════════════════════════════════════════════════════════════
    // Preview
    // ═══════════════════════════════════════════════════════════════

    let previewTimer = null;

    function configurePreviewSandbox() {
        const iframe = $('#ed-preview-iframe');

        iframe.setAttribute(
            'sandbox',
            settings.previewScripts
                ? 'allow-scripts allow-forms allow-popups'
                : 'allow-forms allow-popups'
        );
    }

    function previewEditorLink(id) {
        const node = editorFind(id);

        const iframe = $('#ed-preview-iframe');
        const fallback = $('#ed-preview-fallback');
        const loading = $('#ed-preview-loading');

        editorActivePreviewId = id;

        if (
            !node ||
            node.type !== 'link' ||
            !isSafeHttpUrl(node.url)
        ) {
            iframe.src = 'about:blank';
            fallback.classList.remove('show');
            loading.classList.remove('show');

            $('#ed-preview-title').textContent = 'プレビュー';
            $('#preview-open').style.display = 'none';
            $('#preview-reload').style.display = 'none';

            updateSelectionUi();
            return;
        }

        const safeUrl = getSafeHttpUrl(node.url);

        $('#ed-preview-title').textContent =
            node.title || safeUrl;

        $('#preview-open').style.display = 'inline-block';
        $('#preview-reload').style.display = 'inline-block';

        $('#fb-url').textContent = safeUrl;
        $('#fb-link').dataset.url = safeUrl;

        fallback.classList.remove('show');
        loading.classList.add('show');

        clearTimeout(previewTimer);

        iframe.onload = () => {
            loading.classList.remove('show');
        };

        iframe.onerror = () => {
            loading.classList.remove('show');
            fallback.classList.add('show');
        };

        iframe.src = safeUrl;

        previewTimer = setTimeout(() => {
            loading.classList.remove('show');
        }, 6000);

        updateSelectionUi();
    }

    $('#preview-open').addEventListener('click', () => {
        const node = editorFind(editorActivePreviewId);

        if (node?.type === 'link') {
            safeOpenUrl(node.url);
        }
    });

    $('#preview-reload').addEventListener('click', () => {
        const node = editorFind(editorActivePreviewId);

        if (node?.type === 'link') {
            previewEditorLink(node.id);
        }
    });

    $('#fb-link').addEventListener('click', event => {
        event.preventDefault();
        safeOpenUrl(event.currentTarget.dataset.url);
    });

    // ═══════════════════════════════════════════════════════════════
    // Content-list event delegation
    // ═══════════════════════════════════════════════════════════════

    $('#ed-content-list').addEventListener('click', event => {
        const row = event.target.closest('.ci[data-id]');
        if (!row) return;

        const id = row.dataset.id;
        const actionElement = event.target.closest('[data-action]');

        if (event.target.closest('.ci-chk')) {
            event.stopPropagation();
            toggleEditorCheckbox(id);
            return;
        }

        if (actionElement) {
            event.stopPropagation();

            const action = actionElement.dataset.action;
            const node = editorFind(id);

            switch (action) {
                case 'select':
                    selectEditorItem(id, event);
                    break;

                case 'open':
                    if (node?.type === 'link') {
                        safeOpenUrl(node.url);
                    }
                    break;

                case 'edit':
                    openEditorModal(id);
                    break;

                case 'delete':
                    deleteEditorItem(id);
                    break;

                case 'move-up':
                    moveEditorItem(id, -1);
                    break;

                case 'move-down':
                    moveEditorItem(id, 1);
                    break;

                case 'folder-open':
                    if (event.ctrlKey || event.metaKey) {
                        selectEditorItem(id, event);
                    } else {
                        openEditorFolder(id);
                    }
                    break;

                case 'folder-new-tab':
                    openFolderInNewTab(id);
                    break;

                case 'goto-folder':
                    goToEditorNodeFolder(id);
                    break;

                default:
                    break;
            }
        }
    });

    $('#ed-content-list').addEventListener('dblclick', event => {
        const row = event.target.closest('.ci[data-id]');
        if (!row) return;

        const node = editorFind(row.dataset.id);

        if (node?.type === 'folder') {
            openEditorFolder(node.id);
        } else if (node?.type === 'link') {
            safeOpenUrl(node.url);
        }
    });

    $('#ed-content-list').addEventListener('contextmenu', event => {
        const row = event.target.closest('.ci[data-id]');
        if (!row) return;

        openEditorContextMenu(event, row.dataset.id);
    });

    // ═══════════════════════════════════════════════════════════════
    // Tree / breadcrumb event delegation
    // ═══════════════════════════════════════════════════════════════

    $('#ed-tree-scroll').addEventListener('click', event => {
        const row = event.target.closest('.tn[data-id]');
        if (!row) return;

        const id = row.dataset.id;
        const action = event.target.closest('[data-action]')
            ?.dataset.action;

        if (action === 'tree-toggle') {
            event.stopPropagation();

            if (editorExpanded.has(id)) {
                editorExpanded.delete(id);
            } else {
                editorExpanded.add(id);
            }

            renderEditorTree();
            return;
        }

        if (action === 'tree-open') {
            if (event.ctrlKey || event.metaKey) {
                selectEditorItem(id, event);
            } else {
                openEditorFolder(id);
            }
        }
    });

    $('#ed-tree-scroll').addEventListener('contextmenu', event => {
        const row = event.target.closest('.tn[data-id]');
        if (!row) return;

        openEditorContextMenu(event, row.dataset.id);
    });

    $('#ed-breadcrumb').addEventListener('click', event => {
        const action = event.target.closest('[data-action]');
        if (!action) return;

        if (action.dataset.action === 'nav-root') {
            navigateEditorRoot();
        }

        if (action.dataset.action === 'nav-path') {
            navigateEditorPath(Number(action.dataset.index));
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // Drag and drop
    // ═══════════════════════════════════════════════════════════════

    function clearDragClasses() {
        $$('.dnd-before,.dnd-after,.dnd-into').forEach(element => {
            element.classList.remove(
                'dnd-before',
                'dnd-after',
                'dnd-into'
            );
        });
    }

    function isDescendantOf(folder, targetId) {
        for (const child of folder.children || []) {
            if (child.id === targetId) return true;

            if (
                child.type === 'folder' &&
                isDescendantOf(child, targetId)
            ) {
                return true;
            }
        }

        return false;
    }

    $('#ed-content-list').addEventListener('dragstart', event => {
        const row = event.target.closest('.ci[data-id]');
        if (!row || virtualList.enabled || !canManuallyReorder()) {
            event.preventDefault();
            return;
        }

        editorDraggingId = row.dataset.id;
        editorDragPosition = null;

        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(
            'application/x-bookmark-id',
            editorDraggingId
        );

        row.style.opacity = '.4';
    });

    $('#ed-content-list').addEventListener('dragover', event => {
        if (!editorDraggingId) return;

        event.preventDefault();

        const row = event.target.closest('.ci[data-id]');
        if (!row) return;

        clearDragClasses();

        const targetNode = editorFind(row.dataset.id);
        const rectangle = row.getBoundingClientRect();
        const relative =
            (event.clientY - rectangle.top) /
            rectangle.height;

        if (
            targetNode?.type === 'folder' &&
            relative > 0.25 &&
            relative < 0.75
        ) {
            editorDragPosition = 'into';
            row.classList.add('dnd-into');
        } else {
            editorDragPosition =
                relative < 0.5
                    ? 'before'
                    : 'after';

            row.classList.add(
                `dnd-${editorDragPosition}`
            );
        }
    });

    $('#ed-content-list').addEventListener('drop', event => {
        if (event.dataTransfer.files?.length) {
            return;
        }

        if (!editorDraggingId) return;

        event.preventDefault();
        event.stopPropagation();

        const targetRow = event.target.closest('.ci[data-id]');
        const draggedId = editorDraggingId;
        const targetId = targetRow?.dataset.id ?? null;
        const position = editorDragPosition;

        clearDragClasses();
        editorDraggingId = null;
        editorDragPosition = null;

        if (!draggedId || draggedId === targetId) return;

        const draggedNode = editorFind(draggedId);

        if (
            draggedNode?.type === 'folder' &&
            targetId &&
            isDescendantOf(draggedNode, targetId)
        ) {
            toast('自身の配下には移動できません', 'err');
            return;
        }

        editorMutate(() => {
            const source = editorFindParentArray(draggedId);
            if (!source) return false;

            const sourceIndex = source.findIndex(
                node => node.id === draggedId
            );

            if (sourceIndex < 0) return false;

            const targetNode = targetId
                ? editorFind(targetId)
                : null;

            const targetArray = targetId
                ? editorFindParentArray(targetId)
                : getCurrentEditorItems();

            const targetIndex = targetArray && targetId
                ? targetArray.findIndex(node => node.id === targetId)
                : -1;

            const [node] = source.splice(sourceIndex, 1);

            if (
                position === 'into' &&
                targetNode?.type === 'folder'
            ) {
                targetNode.children.push(node);
                return true;
            }

            if (targetArray && targetIndex >= 0) {
                let insertionIndex = targetIndex;

                if (
                    source === targetArray &&
                    sourceIndex < targetIndex
                ) {
                    insertionIndex -= 1;
                }

                if (position === 'after') {
                    insertionIndex += 1;
                }

                targetArray.splice(
                    Math.max(0, insertionIndex),
                    0,
                    node
                );

                return true;
            }

            getCurrentEditorItems().push(node);
            return true;
        });

        toast('移動しました', 'ok');
    });

    $('#ed-content-list').addEventListener('dragend', event => {
        const row = event.target.closest('.ci[data-id]');

        if (row) {
            row.style.opacity = '';
        }

        clearDragClasses();
        editorDraggingId = null;
        editorDragPosition = null;
    });

    // ═══════════════════════════════════════════════════════════════
    // Context menu
    // ═══════════════════════════════════════════════════════════════

    function removeContextMenu() {
        $('#ed-ctx')?.remove();
    }

    function openEditorContextMenu(event, id) {
        event.preventDefault();
        event.stopPropagation();

        removeContextMenu();

        if (!editorSelection.has(id)) {
            editorSelection.clear();
            editorSelection.add(id);
            updateSelectionUi();
        }

        const ids = [...editorSelection];
        const singleNode = ids.length === 1
            ? editorFind(ids[0])
            : null;

        const hasLinks = ids.some(
            selectedId => editorFind(selectedId)?.type === 'link'
        );

        const actions = [];

        if (singleNode?.type === 'folder') {
            actions.push({
                label: '📂 開く',
                shortcut: 'Enter',
                handler: () => openEditorFolder(singleNode.id)
            });

            actions.push({
                label: '↗ 新しいタブで開く',
                handler: () => openFolderInNewTab(singleNode.id)
            });
        }

        if (singleNode?.type === 'link') {
            actions.push({
                label: '🔗 リンクを開く',
                shortcut: 'Enter',
                handler: () => safeOpenUrl(singleNode.url)
            });

            actions.push({
                label: '🖼️ プレビュー',
                handler: () => previewEditorLink(singleNode.id)
            });
        }

        if (singleNode) {
            actions.push({
                label: '✏️ 編集',
                shortcut: 'F2',
                handler: () => openEditorModal(singleNode.id)
            });
        }

        actions.push({ separator: true });

        if (hasLinks) {
            actions.push({
                label: '📋 URLをコピー',
                shortcut: 'Ctrl+C',
                handler: copySelectedUrls
            });

            actions.push({
                label: `🌐 選択したリンクを全部開く`,
                handler: openSelectedLinksInTabs
            });
        }

        actions.push({
            label: '📝 タイトルをコピー',
            handler: copySelectedTitles
        });

        actions.push({ separator: true });

        actions.push({
            label: '⭐ レーティング...',
            handler: editSelectedRating
        });

        actions.push({
            label: '🏷️ タグ編集...',
            handler: editSelectedTags
        });

        actions.push({ separator: true });

        actions.push({
            label: '📁 移動...',
            handler: openBulkMoveModal
        });

        actions.push({
            label: '🗑️ 削除',
            shortcut: 'Del',
            danger: true,
            handler: deleteSelectedEditorItems
        });

        const menu = document.createElement('div');

        menu.id = 'ed-ctx';
        menu.className = 'ctx-menu';

        menu.innerHTML = actions.map((action, index) => {
            if (action.separator) {
                return '<div class="ctx-sep"></div>';
            }

            return (
                `<div class="ctx-item${action.danger ? ' ctx-danger' : ''}" ` +
                `data-index="${index}">` +
                `${action.label}` +
                (action.shortcut
                    ? `<span class="ctx-shortcut">${action.shortcut}</span>`
                    : '') +
                '</div>'
            );
        }).join('');

        document.body.appendChild(menu);

        menu.style.left = `${Math.min(
            event.clientX,
            window.innerWidth - menu.offsetWidth - 8
        )}px`;

        menu.style.top = `${Math.min(
            event.clientY,
            window.innerHeight - menu.offsetHeight - 8
        )}px`;

        menu.addEventListener('click', clickEvent => {
            const item = clickEvent.target.closest('[data-index]');
            if (!item) return;

            const action = actions[Number(item.dataset.index)];

            removeContextMenu();
            action?.handler?.();
        });

        setTimeout(() => {
            document.addEventListener(
                'click',
                removeContextMenu,
                { once: true }
            );
        }, 0);
    }

    // ═══════════════════════════════════════════════════════════════
    // Editor tabs
    // ═══════════════════════════════════════════════════════════════

    function currentTabLabel() {
        return editorPath.length
            ? `📁 ${editorPath.at(-1).title}`
            : '🏠 Root';
    }

    function saveActiveEditorTab() {
        const tab = editorTabs[editorActiveTab];
        if (!tab) return;

        tab.path = editorPath.map(segment => ({ ...segment }));
        tab.selection = new Set(editorSelection);
        tab.scroll = $('#ed-content-list').scrollTop;
        tab.search = editorSearch;
        tab.label = currentTabLabel();
    }

    function loadEditorTab(index) {
        const tab = editorTabs[index];
        if (!tab) return;

        editorActiveTab = index;
        editorPath = tab.path.map(segment => ({ ...segment }));
        editorSelection = new Set(tab.selection);
        editorSearch = tab.search || '';

        $('#ed-search-input').value = editorSearch;

        repairEditorNavigation();
        renderEditorAll();

        requestAnimationFrame(() => {
            $('#ed-content-list').scrollTop = tab.scroll || 0;
        });
    }

    function syncActiveEditorTab() {
        const tab = editorTabs[editorActiveTab];

        if (tab) {
            tab.path = editorPath.map(segment => ({ ...segment }));
            tab.label = currentTabLabel();
        }

        renderEditorTabs();
    }

    function renderEditorTabs() {
        const container = $('#ed-content-tabs');

        container.innerHTML =
            editorTabs.map((tab, index) =>
                `<div class="ed-ctab` +
                `${index === editorActiveTab ? ' active' : ''}` +
                `${tab.pinned ? ' pinned' : ''}" ` +
                `data-index="${index}" data-action="tab-switch" ` +
                `title="${escapeHtml(tab.label)}">` +
                `<span class="ed-ctab-lbl">${escapeHtml(tab.label)}</span>` +
                (
                    editorTabs.length > 1 && !tab.pinned
                        ? '<span class="ed-ctab-x" data-action="tab-close">×</span>'
                        : ''
                ) +
                '</div>'
            ).join('') +
            '<button class="ed-ctab-add" data-action="tab-add" title="新しいタブ (Ctrl+T)">＋</button>';
    }

    function switchEditorTab(index) {
        if (
            index < 0 ||
            index >= editorTabs.length ||
            index === editorActiveTab
        ) {
            return;
        }

        saveActiveEditorTab();
        loadEditorTab(index);
    }

    function newEditorTab(path = [], label = '🏠 Root') {
        saveActiveEditorTab();

        editorTabs.push({
            path: path.map(segment => ({ ...segment })),
            selection: new Set(),
            scroll: 0,
            search: '',
            label,
            pinned: false
        });

        loadEditorTab(editorTabs.length - 1);
    }

    function closeEditorTab(index) {
        if (
            editorTabs.length <= 1 ||
            editorTabs[index]?.pinned
        ) {
            return;
        }

        const closingActive = index === editorActiveTab;

        editorTabs.splice(index, 1);

        if (index < editorActiveTab) {
            editorActiveTab -= 1;
        } else if (closingActive) {
            editorActiveTab = Math.min(
                index,
                editorTabs.length - 1
            );

            loadEditorTab(editorActiveTab);
        }

        renderEditorTabs();
    }

    function openFolderInNewTab(id) {
        const folder = editorFind(id);

        if (!folder || folder.type !== 'folder') return;

        newEditorTab(
            getFolderPath(id),
            `📁 ${folder.title}`
        );
    }

    $('#ed-content-tabs').addEventListener('click', event => {
        const action = event.target.closest('[data-action]');
        if (!action) return;

        if (action.dataset.action === 'tab-add') {
            newEditorTab();
            return;
        }

        const tab = action.closest('.ed-ctab');
        const index = Number(tab?.dataset.index);

        if (action.dataset.action === 'tab-close') {
            event.stopPropagation();
            closeEditorTab(index);
            return;
        }

        if (action.dataset.action === 'tab-switch') {
            switchEditorTab(index);
        }
    });

    $('#ed-content-tabs').addEventListener('contextmenu', async event => {
        const tab = event.target.closest('.ed-ctab');
        if (!tab) return;

        event.preventDefault();

        const index = Number(tab.dataset.index);
        const item = editorTabs[index];

        if (!item) return;

        const action = await uiConfirm(
            item.pinned
                ? 'このタブのピンを解除しますか？'
                : 'このタブをピン留めしますか？',
            { title: '📌 タブ', danger: false, okLabel: 'はい' }
        );

        if (action) {
            item.pinned = !item.pinned;
            renderEditorTabs();
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // Filter presets
    // ═══════════════════════════════════════════════════════════════

    function loadFilterPresets() {
        const presets = safeJsonParse(
            localStorage.getItem('bmt_presets'),
            {}
        ) || {};

        $('#flt-preset').innerHTML =
            '<option value="">📁 保存済み</option>' +
            Object.keys(presets)
                .sort((a, b) => a.localeCompare(b, 'ja'))
                .map(name =>
                    `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
                )
                .join('');
    }

    function syncFilterUi() {
        $('#flt-type').value = editorFilterType;
        $('#flt-rating').value = String(editorFilterRating);
        $('#flt-tag').value = editorFilterTag;
        $('#flt-domain').value = editorFilterDomain;
        $('#flt-sort').value = editorSort;

        $('#flt-tagunset').classList.toggle(
            'on',
            editorFilterTagUnset
        );

        $('#sch-title').checked =
            editorSearchOptions.fields.title;

        $('#sch-url').checked =
            editorSearchOptions.fields.url;

        $('#sch-tags').checked =
            editorSearchOptions.fields.tags;

        $('#sch-case').checked =
            editorSearchOptions.caseSensitive;

        $('#sch-word').checked =
            editorSearchOptions.wholeWord;

        $('#sch-regex').checked =
            editorSearchOptions.regex;

        $('#sch-mode-and').classList.toggle(
            'on',
            editorSearchOptions.mode === 'and'
        );

        $('#sch-mode-or').classList.toggle(
            'on',
            editorSearchOptions.mode === 'or'
        );
    }

    async function saveFilterPreset() {
        const name = await uiPrompt(
            '💾 検索プリセット保存',
            'プリセット名を入力してください',
            '',
            '例: 開発用・未読'
        );

        if (!name?.trim()) return;

        const presets = safeJsonParse(
            localStorage.getItem('bmt_presets'),
            {}
        ) || {};

        presets[name.trim()] = {
            search: editorSearch,
            searchDeep: editorSearchDeep,
            searchOptions: {
                fields: {
                    ...editorSearchOptions.fields
                },
                caseSensitive: editorSearchOptions.caseSensitive,
                wholeWord: editorSearchOptions.wholeWord,
                regex: editorSearchOptions.regex,
                mode: editorSearchOptions.mode
            },
            filterType: editorFilterType,
            filterRating: editorFilterRating,
            filterTag: editorFilterTag,
            filterDomain: editorFilterDomain,
            filterTagUnset: editorFilterTagUnset,
            sort: editorSort
        };

        localStorage.setItem(
            'bmt_presets',
            JSON.stringify(presets)
        );

        loadFilterPresets();
        toast(`プリセット「${name.trim()}」を保存しました`, 'ok');
    }

    function applyFilterPreset(name) {
        if (!name) return;

        const presets = safeJsonParse(
            localStorage.getItem('bmt_presets'),
            {}
        ) || {};

        const preset = presets[name];
        if (!preset) return;

        editorSearch = preset.search || '';
        editorSearchDeep = preset.searchDeep !== false;

        Object.assign(
            editorSearchOptions,
            preset.searchOptions || {}
        );

        editorSearchOptions.fields = {
            title: true,
            url: true,
            tags: true,
            ...(preset.searchOptions?.fields || {})
        };

        editorFilterType = preset.filterType || 'all';
        editorFilterRating = Number(preset.filterRating) || 0;
        editorFilterTag = preset.filterTag || '';
        editorFilterDomain = preset.filterDomain || '';
        editorFilterTagUnset = Boolean(preset.filterTagUnset);
        editorSort = preset.sort || 'default';

        $('#ed-search-input').value = editorSearch;
        $('#ed-search-bar').classList.toggle(
            'show',
            Boolean(editorSearch)
        );

        syncFilterUi();

        $$('.scope-btn[data-scope]').forEach(button => {
            button.classList.toggle(
                'on',
                (
                    button.dataset.scope === 'deep'
                ) === editorSearchDeep
            );
        });

        renderEditorContent();
        toast(`プリセット「${name}」を適用しました`, 'ok');
    }

    // ═══════════════════════════════════════════════════════════════
    // Panel dividers
    // ═══════════════════════════════════════════════════════════════

    function setupDivider(dividerId, panelId, leftPanel) {
        const divider = $(`#${dividerId}`);
        const panel = $(`#${panelId}`);

        let dragging = false;
        let startX = 0;
        let startWidth = 0;

        divider.addEventListener('mousedown', event => {
            dragging = true;
            startX = event.clientX;
            startWidth = panel.offsetWidth;

            divider.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', event => {
            if (!dragging) return;

            const difference = leftPanel
                ? event.clientX - startX
                : startX - event.clientX;

            panel.style.width =
                `${Math.max(140, Math.min(700, startWidth + difference))}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;

            dragging = false;
            divider.classList.remove('dragging');

            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });

        divider.addEventListener('dblclick', () => {
            panel.style.width = leftPanel
                ? '220px'
                : '400px';
        });
    }

    setupDivider('ed-divider1', 'ed-tree-panel', true);
    setupDivider('ed-divider2', 'ed-preview-panel', false);

    // ═══════════════════════════════════════════════════════════════
    // Toolbar / filters / search events
    // ═══════════════════════════════════════════════════════════════

    $('#tb-import').addEventListener('click', () => {
        $('#ed-file-input').click();
    });

    $('#ed-file-input').addEventListener('change', event => {
        importEditorFile(event.target.files[0]);
        event.target.value = '';
    });

    $('#tb-export').addEventListener('click', exportEditorHtml);
    $('#tb-export-json').addEventListener('click', exportEditorJson);

    $('#tb-undo').addEventListener('click', editorUndo);
    $('#tb-redo').addEventListener('click', editorRedo);

    $('#tb-add-link').addEventListener('click', addEditorLink);
    $('#tb-add-folder').addEventListener('click', () => addEditorFolder(false));
    $('#tb-add-root').addEventListener('click', () => addEditorFolder(true));
    $('#tree-add-root').addEventListener('click', () => addEditorFolder(true));

    $('#tb-edit').addEventListener('click', () => {
        if (editorSelection.size === 1) {
            openEditorModal([...editorSelection][0]);
        }
    });

    $('#tb-delete').addEventListener('click', deleteSelectedEditorItems);
    $('#tb-move-to').addEventListener('click', openBulkMoveModal);
    $('#tb-copy-url').addEventListener('click', copySelectedUrls);
    $('#tb-tag-btn').addEventListener('click', editSelectedTags);
    $('#tb-rate-btn').addEventListener('click', editSelectedRating);

    $('#tb-dedup').addEventListener('click', deduplicateAll);

    $('#tb-find-dup').addEventListener('click', () => {
        editorShowDuplicates = !editorShowDuplicates;

        $('#tb-find-dup').classList.toggle(
            'active',
            editorShowDuplicates
        );

        if (editorShowDuplicates) {
            computeDuplicateIds();

            toast(
                `${editorDuplicateIds.size.toLocaleString()}件の重複対象を検出しました`
            );
        } else {
            editorDuplicateIds.clear();
        }

        renderEditorContent();
    });

    $('#tree-expand-all').addEventListener('click', () => {
        function walk(nodes) {
            for (const node of nodes) {
                if (node.type === 'folder') {
                    editorExpanded.add(node.id);
                    walk(node.children || []);
                }
            }
        }

        walk(editorTree);
        renderEditorTree();
    });

    $('#tree-collapse-all').addEventListener('click', () => {
        editorExpanded.clear();
        renderEditorTree();
    });

    $('#tb-collapse').addEventListener('click', () => {
        const panel = $('#ed-tree-panel');
        const collapsed = panel.classList.toggle('collapsed');

        $('#tb-collapse').textContent = collapsed ? '▶' : '◀';
    });

    $('#tb-preview').addEventListener('click', () => {
        const panel = $('#ed-preview-panel');

        panel.classList.toggle('collapsed');
        editorPreviewEnabled = !panel.classList.contains('collapsed');

        $('#tb-preview').classList.toggle(
            'active',
            editorPreviewEnabled
        );
    });

    $('#tb-keys').addEventListener('click', () => {
        $('#ed-keys-modal').classList.add('show');
    });

    $('#ed-keys-close').addEventListener('click', () => {
        $('#ed-keys-modal').classList.remove('show');
    });

    $('#ed-m-save').addEventListener('click', saveEditorModal);
    $('#ed-m-cancel').addEventListener('click', closeEditorModal);

    $('#ed-modal').addEventListener('click', event => {
        if (event.target === event.currentTarget) {
            closeEditorModal();
        }
    });

    $('#ed-move-cancel').addEventListener('click', () => {
        $('#ed-move-modal').classList.remove('show');
    });

    $('#ed-move-modal').addEventListener('click', event => {
        if (event.target === event.currentTarget) {
            event.currentTarget.classList.remove('show');
        }
    });

    $('#ed-move-list').addEventListener('click', event => {
        const destination = event.target.closest('[data-destination]');
        if (!destination) return;

        moveSelectionToFolder(
            destination.dataset.destination === '__root__'
                ? null
                : destination.dataset.destination
        );
    });

    $('#ed-keys-modal').addEventListener('click', event => {
        if (event.target === event.currentTarget) {
            event.currentTarget.classList.remove('show');
        }
    });

    $('#list-top').addEventListener('click', () => {
        $('#ed-content-list').scrollTop = 0;
    });

    $('#list-bot').addEventListener('click', () => {
        $('#ed-content-list').scrollTop =
            $('#ed-content-list').scrollHeight;
    });

    $('#btn-search').addEventListener('click', () => {
        const searchBar = $('#ed-search-bar');

        if (!searchBar.classList.contains('show')) {
            searchBar.classList.add('show');
            $('#ed-search-input').focus();
        } else {
            $('#ed-search-input').focus();
        }
    });

    let searchCompositionActive = false;

    $('#ed-search-input').addEventListener('compositionstart', () => {
        searchCompositionActive = true;
    });

    $('#ed-search-input').addEventListener('compositionend', event => {
        searchCompositionActive = false;
        editorSearch = event.target.value.trim();
        editorSearchMatchIndex = -1;
        renderEditorContent();
    });

    const handleSearchInput = debounce(event => {
        if (searchCompositionActive) return;

        editorSearch = event.target.value.trim();
        editorSearchMatchIndex = -1;

        renderEditorContent();
    }, 90);

    $('#ed-search-input').addEventListener('input', handleSearchInput);

    $('#ed-search-input').addEventListener('keydown', event => {
        if (event.isComposing || event.keyCode === 229) return;

        if (event.key === 'Enter') {
            event.preventDefault();

            const value = event.currentTarget.value.trim();

            if (
                value &&
                editorSearchHistory.at(-1) !== value
            ) {
                editorSearchHistory.push(value);
                editorSearchHistory = editorSearchHistory.slice(-20);

                localStorage.setItem(
                    'bmt_search_history',
                    JSON.stringify(editorSearchHistory)
                );
            }

            editorSearchHistoryIndex = -1;

            goToSearchMatch(event.shiftKey ? -1 : 1);
            return;
        }

        if (event.key === 'ArrowUp') {
            if (!editorSearchHistory.length) return;

            event.preventDefault();

            editorSearchHistoryIndex = Math.min(
                editorSearchHistory.length - 1,
                editorSearchHistoryIndex + 1
            );

            const value = editorSearchHistory[
                editorSearchHistory.length -
                1 -
                editorSearchHistoryIndex
            ];

            event.currentTarget.value = value;
            editorSearch = value;
            renderEditorContent();
            return;
        }

        if (event.key === 'ArrowDown') {
            if (editorSearchHistoryIndex < 0) return;

            event.preventDefault();

            editorSearchHistoryIndex -= 1;

            const value = editorSearchHistoryIndex >= 0
                ? editorSearchHistory[
                editorSearchHistory.length -
                1 -
                editorSearchHistoryIndex
                ]
                : '';

            event.currentTarget.value = value;
            editorSearch = value;
            renderEditorContent();
        }
    });

    $('#sch-prev').addEventListener('click', () => {
        goToSearchMatch(-1);
    });

    $('#sch-next').addEventListener('click', () => {
        goToSearchMatch(1);
    });

    $('#ed-search-clear').addEventListener('click', () => {
        editorSearch = '';
        editorSearchError = '';
        editorSearchMatchIndex = -1;
        editorSearchHistoryIndex = -1;

        $('#ed-search-input').value = '';
        $('#ed-search-input').removeAttribute('aria-invalid');

        renderEditorContent();
        $('#ed-search-input').focus();
    });

    $$('.scope-btn[data-scope]').forEach(button => {
        button.addEventListener('click', () => {
            editorSearchDeep =
                button.dataset.scope === 'deep';

            $$('.scope-btn[data-scope]').forEach(item => {
                item.classList.toggle(
                    'on',
                    item === button
                );
            });

            renderEditorContent();
        });
    });

    $('#sch-mode-and').addEventListener('click', () => {
        editorSearchOptions.mode = 'and';
        syncFilterUi();
        renderEditorContent();
    });

    $('#sch-mode-or').addEventListener('click', () => {
        editorSearchOptions.mode = 'or';
        syncFilterUi();
        renderEditorContent();
    });

    const searchOptionMap = {
        'sch-title': ['fields', 'title'],
        'sch-url': ['fields', 'url'],
        'sch-tags': ['fields', 'tags'],
        'sch-case': ['caseSensitive'],
        'sch-word': ['wholeWord'],
        'sch-regex': ['regex']
    };

    for (const [id, path] of Object.entries(searchOptionMap)) {
        $(`#${id}`).addEventListener('change', event => {
            if (path.length === 2) {
                editorSearchOptions[path[0]][path[1]] =
                    event.target.checked;
            } else {
                editorSearchOptions[path[0]] =
                    event.target.checked;
            }

            renderEditorContent();
        });
    }

    $('#flt-type').addEventListener('change', event => {
        editorFilterType = event.target.value;
        renderEditorContent();
    });

    $('#flt-rating').addEventListener('change', event => {
        editorFilterRating = Number(event.target.value);
        renderEditorContent();
    });

    $('#flt-sort').addEventListener('change', event => {
        editorSort = event.target.value;
        renderEditorContent();
    });

    $('#flt-tag').addEventListener(
        'input',
        debounce(event => {
            editorFilterTag = event.target.value.trim();
            renderEditorContent();
        }, 90)
    );

    $('#flt-domain').addEventListener(
        'input',
        debounce(event => {
            editorFilterDomain = event.target.value.trim();
            renderEditorContent();
        }, 90)
    );

    $('#flt-tagunset').addEventListener('click', event => {
        editorFilterTagUnset = !editorFilterTagUnset;

        event.currentTarget.classList.toggle(
            'on',
            editorFilterTagUnset
        );

        renderEditorContent();
    });

    $('#flt-preset-save').addEventListener(
        'click',
        saveFilterPreset
    );

    $('#flt-preset').addEventListener('change', event => {
        applyFilterPreset(event.target.value);
        event.target.value = '';
    });

    // ═══════════════════════════════════════════════════════════════
    // Global file drop
    // ═══════════════════════════════════════════════════════════════

    document.addEventListener('dragover', event => {
        if (event.dataTransfer?.types?.includes('Files')) {
            event.preventDefault();
        }
    });

    document.addEventListener('drop', event => {
        if (event.target.closest('#m-drop')) return;

        const file = event.dataTransfer?.files?.[0];

        if (!file) return;

        if (!/\.(html?|htm|json)$/i.test(file.name)) {
            return;
        }

        event.preventDefault();

        activateEditorTab();
        importEditorFile(file);
    });

    // ═══════════════════════════════════════════════════════════════
    // Keyboard shortcuts
    // ═══════════════════════════════════════════════════════════════

    document.addEventListener('keydown', event => {
        if ($('#ed-modal').classList.contains('show')) {
            if (event.key === 'Escape') {
                closeEditorModal();
            }

            if (
                event.key === 'Enter' &&
                event.target.matches('input') &&
                !event.isComposing
            ) {
                event.preventDefault();
                saveEditorModal();
            }

            return;
        }

        const openModals = $$('.modal-ov.show');

        if (openModals.length) {
            const suiteOwned = openModals.some(
                modal => modal.dataset.suite === '1'
            );

            if (event.key === 'Escape' && !suiteOwned) {
                openModals.forEach(modal =>
                    modal.classList.remove('show')
                );
            }

            return;
        }

        if (!$('#tab-editor').classList.contains('active')) {
            return;
        }

        if (event.target === $('#ed-search-input')) {
            if (event.key === 'Escape') {
                event.target.blur();
            }

            return;
        }

        const isInput = event.target.matches(
            'input, textarea, select, [contenteditable="true"]'
        );

        if (event.key === 'Escape') {
            if (isInput) {
                event.target.blur();
                return;
            }

            if (editorSelection.size) {
                editorSelection.clear();
                updateSelectionUi();
                return;
            }

            if (editorSearch) {
                editorSearch = '';
                $('#ed-search-input').value = '';
                renderEditorContent();
                return;
            }

            $('#ed-search-bar').classList.remove('show');
            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'f'
        ) {
            event.preventDefault();

            $('#ed-search-bar').classList.add('show');
            $('#ed-search-input').focus();
            $('#ed-search-input').select();

            return;
        }

        if (isInput) return;

        if (
            event.key === '/' &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
        ) {
            event.preventDefault();

            $('#ed-search-bar').classList.add('show');
            $('#ed-search-input').focus();
            $('#ed-search-input').select();

            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'z' &&
            !event.shiftKey
        ) {
            event.preventDefault();
            editorUndo();
            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            (
                event.key.toLowerCase() === 'y' ||
                (
                    event.shiftKey &&
                    event.key.toLowerCase() === 'z'
                )
            )
        ) {
            event.preventDefault();
            editorRedo();
            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 's'
        ) {
            event.preventDefault();
            exportEditorHtml();
            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'o'
        ) {
            event.preventDefault();
            $('#ed-file-input').click();
            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'p'
        ) {
            event.preventDefault();
            $('#tb-preview').click();
            return;
        }

        if (
            event.key === 'Backspace' ||
            (
                event.altKey &&
                event.key === 'ArrowLeft'
            )
        ) {
            event.preventDefault();
            navigateEditorUp();
            return;
        }

        if (
            event.key === 'ArrowDown' ||
            event.key === 'ArrowUp'
        ) {
            event.preventDefault();

            if (!editorVisibleIds.length) return;

            const currentId =
                [...editorSelection].at(-1) ??
                editorVisibleIds[0];

            let index = editorVisibleIds.indexOf(currentId);

            if (index < 0) index = 0;

            index = event.key === 'ArrowDown'
                ? Math.min(editorVisibleIds.length - 1, index + 1)
                : Math.max(0, index - 1);

            const id = editorVisibleIds[index];

            if (!event.shiftKey) {
                editorSelection.clear();
            }

            editorSelection.add(id);
            editorLastSelectedId = id;

            if (virtualList.enabled) {
                $('#ed-content-list').scrollTop =
                    index * virtualList.rowHeight;

                renderVirtualList(true);
            }

            updateSelectionUi();

            requestAnimationFrame(() => {
                document.querySelector(
                    `#ed-content-list .ci[data-id="${CSS.escape(id)}"]`
                )?.scrollIntoView({
                    block: 'nearest'
                });
            });

            const node = editorFind(id);

            if (
                node?.type === 'link' &&
                settings.autoPreview &&
                editorPreviewEnabled
            ) {
                previewEditorLink(id);
            }

            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            $('#ed-content-list').scrollTop = 0;
            return;
        }

        if (event.key === 'End') {
            event.preventDefault();
            $('#ed-content-list').scrollTop =
                $('#ed-content-list').scrollHeight;
            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'a'
        ) {
            event.preventDefault();

            editorSelection = new Set(editorVisibleIds);
            updateSelectionUi();
            return;
        }

        if (
            event.key === 'Delete' &&
            editorSelection.size
        ) {
            deleteSelectedEditorItems();
            return;
        }

        if (
            event.key === 'F2' &&
            editorSelection.size === 1
        ) {
            openEditorModal([...editorSelection][0]);
            return;
        }

        if (
            event.key === 'Enter' &&
            editorSelection.size === 1
        ) {
            const node = editorFind([...editorSelection][0]);

            if (node?.type === 'folder') {
                openEditorFolder(node.id);
            } else if (node?.type === 'link') {
                safeOpenUrl(node.url);
            }

            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'c'
        ) {
            event.preventDefault();
            copySelectedUrls();
            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'l'
        ) {
            event.preventDefault();
            addEditorLink();
            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.shiftKey &&
            event.key.toLowerCase() === 'n'
        ) {
            event.preventDefault();
            addEditorFolder(false);
            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 't'
        ) {
            event.preventDefault();
            newEditorTab();
            return;
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'w'
        ) {
            event.preventDefault();
            closeEditorTab(editorActiveTab);
            return;
        }

        if (event.key === '?') {
            $('#ed-keys-modal').classList.add('show');
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // Before unload
    // ═══════════════════════════════════════════════════════════════

    window.addEventListener('beforeunload', event => {
        if (!editorDirty) return;

        event.preventDefault();
        event.returnValue = '';
    });

    // ═══════════════════════════════════════════════════════════════
    // Suite bridge API (extension / external integrations)
    // ═══════════════════════════════════════════════════════════════

    window.BookmarkSuite = Object.freeze({
        version: '5.0',
        loadRawTree: rawTree =>
            resetEditorTree(rawTree, { preserveIds: false, dirty: true }),
        getTree: () => editorTree,
        toNetscapeHtml: serializeEditorHtml,
        showEditor: activateEditorTab,
        confirm: uiConfirm,
        toast,
        setStatus
    });

    // ═══════════════════════════════════════════════════════════════
    // Initialization
    // ═══════════════════════════════════════════════════════════════

    async function initialize() {
        initializeTheme();
        configurePreviewSandbox();
        setupSettingsMenu();
        loadFilterPresets();
        syncFilterUi();

        rebuildEditorIndex();
        renderEditorTabs();
        renderEditorAll();
        updateUndoButtons();

        await nextFrame();

        setTimeout(() => {
            restoreAutosave().catch(error => {
                console.warn('Autosave restore failed:', error);
            });
        }, 300);
    }

    initialize();
})();