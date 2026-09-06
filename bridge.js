(() => {
    'use strict';

    // ================================================================
    // Bookmark Suite – extension bridge
    // Adds live Chrome-bookmarks integration on top of the bundled
    // web editor via the window.BookmarkSuite API exposed by app.js.
    // ================================================================

    const api = window.BookmarkSuite;

    if (!api || !chrome?.bookmarks?.getTree || !chrome?.downloads) {
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
        'title="Chromeのブックマークをエディタに読み込みます">🌐 ブラウザから読み込み</button>' +
        '<button type="button" class="tb-btn" id="bs-save-browser" disabled ' +
        'title="エディタの内容でブラウザのブックマークを上書きします（自動バックアップ付き）">' +
        '☁️ ブラウザへ書き戻す</button>';

    const bridgeSeparator = document.createElement('div');
    bridgeSeparator.className = 'tb-sep';

    toolbar.prepend(bridgeSeparator);
    toolbar.prepend(bridgeGroup);

    const loadButton = document.getElementById('bs-load-browser');
    const saveButton = document.getElementById('bs-save-browser');

    // ── helpers ───────────────────────────────────────────────────

    const bookmarksCall = (method, args) =>
        new Promise((resolve, reject) => {
            chrome.bookmarks[method](args, result => {
                const error = chrome.runtime.lastError;

                if (error) {
                    reject(new Error(error.message));
                } else {
                    resolve(result);
                }
            });
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

    api.setStatus('🌐 拡張連携が有効です。「ブラウザから読み込み」で開始できます');
})();
