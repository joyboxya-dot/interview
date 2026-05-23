/**
 * 대시보드 — 스크립트 추가(폼) · 삭제(콤보)
 */
(function (global) {
    function el(id) {
        return document.getElementById(id);
    }

    function renderDeleteSelect(topics) {
        const sel = el('topic-delete-select');
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = '';
        if (!topics.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '(스크립트 없음)';
            sel.appendChild(opt);
            sel.disabled = true;
            return;
        }
        sel.disabled = false;
        topics.forEach(function (t) {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = (t.title || t.id) + ' (' + t.id + ')';
            sel.appendChild(opt);
        });
        if (prev && topics.some(function (t) { return t.id === prev; })) {
            sel.value = prev;
        }
    }

    function createSentenceRow(ko, en) {
        const row = document.createElement('div');
        row.className = 'topic-sentence-row';
        row.innerHTML =
            '<input type="text" class="topic-input topic-sent-ko" placeholder="한글 문장" value="' +
            escapeAttr(ko || '') +
            '" />' +
            '<input type="text" class="topic-input topic-sent-en" placeholder="English sentence" value="' +
            escapeAttr(en || '') +
            '" />' +
            '<button type="button" class="topic-sent-remove" title="이 문장 제거">×</button>';
        row.querySelector('.topic-sent-remove').onclick = function () {
            const wrap = el('topic-sentence-rows');
            if (wrap && wrap.children.length > 1) row.remove();
        };
        return row;
    }

    function escapeAttr(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    function resetSentenceRows(count) {
        const wrap = el('topic-sentence-rows');
        if (!wrap) return;
        wrap.innerHTML = '';
        const n = count || 2;
        for (let i = 0; i < n; i++) wrap.appendChild(createSentenceRow('', ''));
    }

    function readSentencesFromForm() {
        const rows = document.querySelectorAll('#topic-sentence-rows .topic-sentence-row');
        const sentences = [];
        rows.forEach(function (row) {
            const ko = (row.querySelector('.topic-sent-ko') || {}).value || '';
            const en = (row.querySelector('.topic-sent-en') || {}).value || '';
            if (ko.trim() || en.trim()) {
                sentences.push([ko.trim(), en.trim()]);
            }
        });
        return sentences;
    }

    function clearAddForm() {
        ['topic-add-title', 'topic-add-question', 'topic-add-alt', 'topic-add-bridge-ko', 'topic-add-bridge', 'topic-add-kor'].forEach(
            function (id) {
                const input = el(id);
                if (input) input.value = '';
            }
        );
        resetSentenceRows(2);
    }

    function buildTopicFromForm(serverTopics) {
        const title = (el('topic-add-title') || {}).value.trim();
        const question = (el('topic-add-question') || {}).value.trim();
        const altQuestion = (el('topic-add-alt') || {}).value.trim();
        const bridgeKo = (el('topic-add-bridge-ko') || {}).value.trim();
        const bridge = (el('topic-add-bridge') || {}).value.trim();
        const kor = (el('topic-add-kor') || {}).value.trim();
        const sentences = readSentencesFromForm();

        if (!title) throw new Error('제목을 입력해 주세요.');
        if (!question) throw new Error('면접 질문(영어)을 입력해 주세요.');
        if (!altQuestion) throw new Error('돌발 질문(영어)을 입력해 주세요.');
        if (!kor) throw new Error('한글 통문장을 입력해 주세요.');
        if (!sentences.length) throw new Error('문장을 1개 이상 입력해 주세요.');

        const id = global.TopicStore.generateTopicId(serverTopics || []);

        return {
            id: id,
            title: title,
            question: question,
            altQuestion: altQuestion,
            bridgeKo: bridgeKo,
            bridge: bridge,
            kor: kor,
            sentences: sentences,
        };
    }

    function bind(options) {
        options = options || {};
        const onChange = options.onTopicsChanged || function () {};

        resetSentenceRows(2);

        const btnAddRow = el('btn-add-sentence-row');
        if (btnAddRow && !btnAddRow.dataset.bound) {
            btnAddRow.dataset.bound = '1';
            btnAddRow.onclick = function () {
                const wrap = el('topic-sentence-rows');
                if (wrap) wrap.appendChild(createSentenceRow('', ''));
            };
        }

        const btnAdd = el('btn-add-topic');
        if (btnAdd && !btnAdd.dataset.bound) {
            btnAdd.dataset.bound = '1';
            btnAdd.onclick = function () {
                try {
                    const server =
                        global.ContentLoader && global.ContentLoader.getServerTopics
                            ? global.ContentLoader.getServerTopics()
                            : [];
                    const topic = buildTopicFromForm(server);
                    global.TopicStore.addTopic(topic);
                    if (global.ContentLoader && global.ContentLoader.refreshMergedTopics) {
                        global.ContentLoader.refreshMergedTopics();
                    }
                    clearAddForm();
                    onChange();
                    alert('추가했습니다: ' + topic.title + '\nID: ' + topic.id);
                } catch (e) {
                    alert(e.message || String(e));
                }
            };
        }

        const btnDel = el('btn-delete-topic');
        if (btnDel && !btnDel.dataset.bound) {
            btnDel.dataset.bound = '1';
            btnDel.onclick = function () {
                const sel = el('topic-delete-select');
                const id = sel && sel.value;
                if (!id) return;
                const label = sel.options[sel.selectedIndex].textContent;
                if (!confirm('「' + label + '」을(를) 목록에서 삭제할까요?\n(이 기기에만 저장됩니다)')) return;
                global.TopicStore.deleteTopic(id);
                if (global.ContentLoader && global.ContentLoader.refreshMergedTopics) {
                    global.ContentLoader.refreshMergedTopics();
                }
                onChange();
            };
        }

        const btnReload = el('btn-reload-content');
        if (btnReload && !btnReload.dataset.bound) {
            btnReload.dataset.bound = '1';
            btnReload.onclick = function () {
                if (options.reload) options.reload();
            };
        }
    }

    global.ContentManagerUI = {
        renderDeleteSelect: renderDeleteSelect,
        clearAddForm: clearAddForm,
        bind: bind,
    };
})(window);
