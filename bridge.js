(() => {
    'use strict';

    // ================================================================
    // Bookmark Suite – extension bridge
    // Adds live Chrome-bookmarks integration on top of the bundled
    // web editor via the window.BookmarkSuite API exposed by app.js.
    // ================================================================

    const api = window.BookmarkSuite;

    if (!api || !chrome?.bookmarks?.getTree || !chrome?.downloads) {
        document.getElementById('bs-banner')?.remove();
        return;
    }

    const SPECIAL_ROOT_IDS = ['1', '2'];

    const NETSCAPE_HEAD =
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

    // ── toolbar injection ─────────────────────────────────────────

    const toolbar = document.getElementById('ed-main-toolbar');
    if (!toolbar) return;

    const bridgeGroup = document.createElement('div');
    bridgeGroup.className = 'tb-group';
    bridgeGroup.innerHTML =
        '<button type="button" class="tb-btn tb-primary" id="bs-load-browser" ' +
        'title="Chromeの最新ブックマークを再読み込みします">🌐 再読込</button>' +
        '<button type="button" class="tb-btn" id="bs-save-browser" disabled ' +
        'title="エディタの内容でブラウザのブックマークを上書きします（自動バックアップ付き）">' +
        '☁️ ブラウザに保存</button>';

    const bridgeSeparator = document.createElement('div');
    bridgeSeparator.className = 'tb-sep';

    toolbar.prepend(bridgeSeparator);
    toolbar.prepend(bridgeGroup);

    const loadButton = document.getElementById('bs-load-browser');
    const saveButton = document.getElementById('bs-save-browser');

    // ── helpers ───────────────────────────────────────────────────

    const bookmarksCall = (method, args) =>
        new Promise((resolve, reject) => {
            const cb = result => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message));
                else resolve(result);
            };
            // getTree は引数なしが正しいシグネチャ。undefined を渡すと
            // "No matching signature" になるので引数なしで呼ぶ
            if (args === undefined) chrome.bookmarks[method](cb);
            else chrome.bookmarks[method](args, cb);
        });

    const getBrowserTree = async () =>
        (await bookmarksCall('getTree', undefined))[0];

    const hasBrowserRootMapping = () =>
        api.getTree().some(
            node => node.bid && SPECIAL_ROOT_IDS.includes(node.bid)
        );

    function convertBrowserNode(node) {
        if (node.url) {
            return {
                type: 'link',
                title: node.title || node.url,
                url: node.url,
                addDate: Math.floor((node.dateAdded || Date.now()) / 1000)
            };
        }

        const converted = {
            type: 'folder',
            title: node.title || 'Folder',
            addDate: Math.floor((node.dateAdded || Date.now()) / 1000),
            children: (node.children || []).map(convertBrowserNode)
        };

        if (SPECIAL_ROOT_IDS.includes(node.id)) {
            converted.bid = node.id;
        }

        return converted;
    }

    function buildNetscapeBackup(rootNode) {
        let html = NETSCAPE_HEAD;

        const walk = node => {
            if (node.url) {
                html +=
                    `        <DT><A HREF="${escapeText(node.url)}" ` +
                    `ADD_DATE="${Math.floor((node.dateAdded || 0) / 1000)}">` +
                    `${escapeText(node.title)}</A>\n`;

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

        for (const child of rootNode?.children || []) {
            walk(child);
        }

        return `${html}</DL><p>\n`;
    }

    async function downloadBackup(html) {
        const stamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, '-');

        const blobUrl = URL.createObjectURL(
            new Blob([html], { type: 'text/html;charset=utf-8' })
        );

        await new Promise((resolve, reject) => {
            chrome.downloads.download(
                {
                    url: blobUrl,
                    filename: `bookmark_suite_backup_${stamp}.html`,
                    saveAs: false,
                    conflictAction: 'uniquify'
                },
                downloadId => {
                    const error = chrome.runtime.lastError;

                    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

                    if (error) {
                        reject(new Error(error.message));
                    } else {
                        resolve(downloadId);
                    }
                }
            );
        });
    }

    async function createEditorNode(browserParentId, node, index) {
        const created = await bookmarksCall('create', {
            parentId: browserParentId,
            ...(Number.isInteger(index) ? { index } : {}),
            title: String(node.title || node.url || 'Untitled').slice(0, 250),
            ...(node.type === 'link' && node.url ? { url: node.url } : {})
        });

        createdCount += 1;

        if (createdCount % 40 === 0) {
            api.setStatus(`☁️ 書き戻し中... ${createdCount.toLocaleString()}件`);
            await new Promise(resolve => setTimeout(resolve));
        }

        if (node.type === 'folder') {
            let childIndex = 0;

            for (const child of node.children || []) {
                await createEditorNode(created.id, child, childIndex);
                childIndex += 1;
            }
        }
    }

    let createdCount = 0;

    // ── load from browser ─────────────────────────────────────────

    async function loadFromBrowser() {
        loadButton.disabled = true;

        try {
            api.setStatus('🌐 ブラウザのブックマークを取得中...');
            const root = await getBrowserTree();

            const tree = (root?.children || []).map(convertBrowserNode);

            api.loadRawTree(tree);

            const counts = tree.reduce(
                (sum, topNode) =>
                    sum + (
                        topNode.type === 'link'
                            ? 1
                            : countLinks(topNode)
                    ),
                0
            );

            function countLinks(folder) {
                return (folder.children || []).reduce(
                    (sum, child) =>
                        sum + (
                            child.type === 'link'
                                ? 1
                                : countLinks(child)
                        ),
                    0
                );
            }

            api.setStatus(`🌐 読み込み完了（${counts.toLocaleString()}リンク）`);
            api.toast('ブラウザのブックマークを読み込みました', 'ok');

            saveButton.disabled = !hasBrowserRootMapping();
        } catch (error) {
            api.setStatus(`❌ 読み込み失敗: ${error.message}`);
            api.toast(`読み込み失敗: ${error.message}`, 'err');
        } finally {
            loadButton.disabled = false;
        }
    }

    // ── save back to browser ──────────────────────────────────────

    async function saveToBrowser() {
        const editorTree = api.getTree();

        const mappedRoots = editorTree.filter(
            node => node.bid && SPECIAL_ROOT_IDS.includes(node.bid)
        );

        if (!mappedRoots.length) {
            api.toast(
                '先に「🌐 ブラウザから読み込み」を実行してください',
                'err'
            );
            return;
        }

        const confirmed = await api.confirm(
            '現在のブラウザのブックマークバー／その他のブックマークを消去し、' +
            'エディタの内容で上書きします。\n' +
            '直前の状態は HTML バックアップとして自動ダウンロードされます。よろしいですか？',
            {
                title: '☁️ ブラウザへ書き戻し',
                danger: true,
                okLabel: 'バックアップして上書き'
            }
        );

        if (!confirmed) return;

        saveButton.disabled = true;
        createdCount = 0;

        try {
            api.setStatus('💾 自動バックアップを保存中...');
            await downloadBackup(buildNetscapeBackup(await getBrowserTree()));

            api.setStatus('🧹 既存のブックマークを消去中...');

            for (const rootId of SPECIAL_ROOT_IDS) {
                const children = await bookmarksCall(
                    'getChildren',
                    rootId
                ).catch(() => []);

                for (const child of children) {
                    await bookmarksCall('removeTree', child.id)
                        .catch(() => {});
                }
            }

            api.setStatus('☁️ 書き戻し中...');

            for (const topNode of mappedRoots) {
                let childIndex = 0;

                for (const child of topNode.children || []) {
                    await createEditorNode(
                        topNode.bid,
                        child,
                        childIndex
                    );

                    childIndex += 1;
                }
            }

            const unmapped = editorTree.filter(
                node => !(node.bid && SPECIAL_ROOT_IDS.includes(node.bid))
            );

            for (const extra of unmapped) {
                await createEditorNode('2', extra);
            }

            api.setStatus(
                `✅ 書き戻し完了（${createdCount.toLocaleString()}件）`
            );

            api.toast(
                `ブラウザへ ${createdCount.toLocaleString()}件 書き戻しました`,
                'ok'
            );
        } catch (error) {
            api.setStatus(`❌ 書き戻し失敗: ${error.message}`);
            api.toast(`書き戻し失敗: ${error.message}`, 'err');
        } finally {
            saveButton.disabled = false;
        }
    }

    // ── wiring ────────────────────────────────────────────────────

    loadButton.addEventListener('click', loadFromBrowser);
    saveButton.addEventListener('click', saveToBrowser);

    api.setStatus('🌐 拡張連携が有効です。ブラウザのブックマークを自動で読み込みます…');

    // ── マージ最適化を即適用 ──────────────────────────────────────
    const btnGroup = document.querySelector('#m-result .btn-group');
    if (btnGroup && !document.getElementById('m-apply-browser')) {
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.id = 'm-apply-browser';
        applyBtn.className = 'dl-btn btn-blue';
        applyBtn.textContent = '☁️ ブラウザへ即適用';
        applyBtn.disabled = true;
        btnGroup.appendChild(applyBtn);

        const origToEditor = document.getElementById('m-to-editor');

        // マージ結果が出たら即適用ボタンを有効化 (app.js 側の有効化に追随)
        // setInterval は重くなるので使わず、MutationObserver のみで追随する
        let syncQueued = false;
        const syncApplyBtn = () => {
            if (syncQueued) return;
            syncQueued = true;
            requestAnimationFrame(() => {
                syncQueued = false;
                applyBtn.disabled = !api.getMergerCount();
                if (origToEditor) origToEditor.disabled = applyBtn.disabled;
            });
        };
        new MutationObserver(syncApplyBtn).observe(origToEditor || btnGroup, { attributes: true, attributeFilter: ['disabled'] });
        syncApplyBtn();

        applyBtn.addEventListener('click', async () => {
            const items = api.getMergerItems();
            if (!items.length) return;
            const confirmed = await api.confirm(
                `マージ結果 ${items.length}件を「その他のブックマーク」にドメイン別フォルダで追加します。\n※ 既存のブックマークは削除しません (追加のみ)。\n※ 事前に HTML バックアップを自動ダウンロードします。`,
                { title: '☁️ ブウザへ即適用', danger: true, okLabel: 'バックアップして追加' }
            );
            if (!confirmed) return;
            applyBtn.disabled = true;
            try {
                api.setStatus('💾 自動バックアップを保存中...');
                await downloadBackup(buildNetscapeBackup(await getBrowserTree()));

                const groups = new Map();
                for (const it of items) {
                    if (!groups.has(it.hostname)) groups.set(it.hostname, []);
                    groups.get(it.hostname).push(it);
                }
                let count = 0;
                for (const [hostname, list] of groups) {
                    const folder = await bookmarksCall('create', { parentId: '2', title: hostname });
                    for (const it of list) {
                        await bookmarksCall('create', { parentId: folder.id, title: it.title || it.url, url: it.url });
                        count += 1;
                        if (count % 40 === 0) api.setStatus(`☁️ 追加中... ${count.toLocaleString()}件`);
                    }
                }
                api.toast(`ブラウザへ ${count.toLocaleString()}件 追加しました`, 'ok');
                api.setStatus(`✅ 即適用完了（${count.toLocaleString()}件）`);
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                api.toast('追加失敗: ' + e.message, 'err');
            } finally {
                syncApplyBtn();
            }
        });
    }

    // ポップアップから渡された pendingImport を受け取り、ファイル経由なしでエディタに開く
    // (.htm/.html 両対応、Netscape 形式なら拡張子は関係なし)
    // pendingImport がない場合は Chrome のブックマークマネージャ (Ctrl+Shift+O) 代わりとして
    // 現在のブックマークを自動ロードし、このエディタを実質デフォルトのマネージャにする
    chrome.storage.local.get('pendingImport', ({ pendingImport }) => {
        if (pendingImport?.html) {
            try {
                api.loadEditorHtml(pendingImport.html);
                api.showEditor();
                api.toast('ポップアップから直接取り込みました', 'ok');
                api.setStatus('✅ ポップアップから取り込み完了');
            } catch (e) {
                api.toast('取り込み失敗: ' + e.message, 'err');
            } finally {
                chrome.storage.local.remove('pendingImport');
            }
            return;
        }
        // 非拡張 (GitHub Pages 等) では chrome.bookmarks が使えないので自動ロードしない
        // 起動直後の自動ロードは大規模ブックマークで重いので、空の時だけ 1回だけ
        if (typeof chrome.bookmarks?.getTree === 'function' && !api.getTree()?.length) {
            requestIdleCallback(() => {
                loadFromBrowser().catch(() => {});
            }, { timeout: 2000 });
        }
    });
})();
