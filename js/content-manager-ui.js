/**
 * 대시보드 — 스크립트 추가(폼) · 삭제(콤보) · AI 초안
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

    function setSentenceRows(sentences) {
        const wrap = el('topic-sentence-rows');
        if (!wrap) return;
        wrap.innerHTML = '';
        const list = sentences && sentences.length ? sentences : [['', '']];
        list.forEach(function (s) {
            wrap.appendChild(createSentenceRow(s[0], s[1]));
        });
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

    function readDraftFromForm() {
        return {
            title: ((el('topic-add-title') || {}).value || '').trim(),
            question: ((el('topic-add-question') || {}).value || '').trim(),
            altQuestion: ((el('topic-add-alt') || {}).value || '').trim(),
            bridgeKo: ((el('topic-add-bridge-ko') || {}).value || '').trim(),
            bridge: ((el('topic-add-bridge') || {}).value || '').trim(),
            kor: ((el('topic-add-kor') || {}).value || '').trim(),
            sentences: readSentencesFromForm(),
        };
    }

    function hasDraftOutput() {
        const d = readDraftFromForm();
        return !!(
            d.title ||
            d.question ||
            d.kor ||
            d.bridge ||
            d.bridgeKo ||
            (d.sentences && d.sentences.length)
        );
    }

    function fillFormFromTopic(topic) {
        if (!topic) return;
        const set = function (id, val) {
            const node = el(id);
            if (node) node.value = val || '';
        };
        set('topic-add-title', topic.title);
        set('topic-add-question', topic.question);
        set('topic-add-alt', topic.altQuestion);
        set('topic-add-bridge-ko', topic.bridgeKo);
        set('topic-add-bridge', topic.bridge);
        set('topic-add-kor', topic.kor);
        setSentenceRows(topic.sentences || []);
        updateAiModeHint();
    }

    function clearAddForm() {
        ['topic-add-title', 'topic-add-question', 'topic-add-alt', 'topic-add-bridge-ko', 'topic-add-bridge', 'topic-add-kor'].forEach(
            function (id) {
                const input = el(id);
                if (input) input.value = '';
            }
        );
        resetSentenceRows(2);
        const prompt = el('topic-ai-prompt');
        if (prompt) prompt.value = '';
        setAiStatus('');
        updateAiModeHint();
    }

    function setAiStatus(msg, isError) {
        const st = el('topic-ai-status');
        if (!st) return;
        st.textContent = msg || '';
        st.className = 'topic-ai-status' + (isError ? ' is-error' : msg ? ' is-ok' : '');
    }

    function updateAiModeHint() {
        const hint = el('topic-ai-mode-hint');
        if (!hint) return;
        if (hasDraftOutput()) {
            hint.textContent =
                '초안이 있음 → 다음 생성 시 「요청」+ 「아래 초안」을 함께 보내 수정합니다.';
        } else {
            hint.textContent =
                '초안 없음 → 생성 시 「요청」+ 「기존 스크립트」를 참고해 새 스크립트를 만듭니다.';
        }
    }

    function buildTopicFromForm(serverTopics) {
        const d = readDraftFromForm();
        const title = d.title;
        const question = d.question;
        const altQuestion = d.altQuestion;
        const bridgeKo = d.bridgeKo;
        const bridge = d.bridge;
        const kor = d.kor;
        const sentences = d.sentences;

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

    async function runAiGenerate(getTopics) {
        const promptEl = el('topic-ai-prompt');
        const userPrompt = promptEl ? promptEl.value.trim() : '';
        if (!userPrompt) {
            setAiStatus('요청 내용을 입력해 주세요.', true);
            return;
        }
        if (typeof global.ScriptAI === 'undefined') {
            setAiStatus('ScriptAI 모듈을 불러오지 못했습니다.', true);
            return;
        }

        const btn = el('btn-ai-generate-script');
        const topics = typeof getTopics === 'function' ? getTopics() : [];
        const currentDraft = hasDraftOutput() ? readDraftFromForm() : null;

        if (btn) {
            btn.disabled = true;
            btn.textContent = '생성 중…';
        }
        setAiStatus(
            currentDraft
                ? 'AI가 초안을 수정하는 중…'
                : 'AI가 새 스크립트를 만드는 중… (기존 스크립트 참고)'
        );

        try {
            let topic = await global.ScriptAI.generateScript(userPrompt, {
                topics: topics,
                currentDraft: currentDraft,
            });
            if (typeof global.ComicGenerator !== 'undefined') {
                setAiStatus('4컷 맥락 이미지 생성 중…');
                try {
                    const server =
                        global.ContentLoader && global.ContentLoader.getServerTopics
                            ? global.ContentLoader.getServerTopics()
                            : [];
                    if (!topic.id) {
                        topic.id = global.TopicStore.generateTopicId(server);
                    }
                    topic = await global.ComicGenerator.attachTopicComic(topic);
                } catch (comicErr) {
                    console.warn('comic preview', comicErr);
                }
            }
            fillFormFromTopic(topic);
            setAiStatus(
                topic.topicComic
                    ? '초안 + 4컷 미리보기를 채웠습니다. 고친 뒤 「추가하기」를 누르세요.'
                    : '초안을 채웠습니다. 아래에서 고친 뒤 「추가하기」를 누르세요.'
            );
            const block = el('topic-draft-fields');
            if (block) block.open = true;
        } catch (e) {
            setAiStatus(e.message || String(e), true);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'AI 스크립트 생성';
            }
            updateAiModeHint();
        }
    }

    function bind(options) {
        options = options || {};
        const onChange = options.onTopicsChanged || function () {};
        const getTopics = options.getTopics || function () {
            return global.db || [];
        };

        resetSentenceRows(2);
        updateAiModeHint();

        const btnAddRow = el('btn-add-sentence-row');
        if (btnAddRow && !btnAddRow.dataset.bound) {
            btnAddRow.dataset.bound = '1';
            btnAddRow.onclick = function () {
                const wrap = el('topic-sentence-rows');
                if (wrap) wrap.appendChild(createSentenceRow('', ''));
            };
        }

        const btnAi = el('btn-ai-generate-script');
        if (btnAi && !btnAi.dataset.bound) {
            btnAi.dataset.bound = '1';
            btnAi.onclick = function () {
                runAiGenerate(getTopics);
            };
        }

        const btnClearDraft = el('btn-clear-topic-draft');
        if (btnClearDraft && !btnClearDraft.dataset.bound) {
            btnClearDraft.dataset.bound = '1';
            btnClearDraft.onclick = function () {
                if (!hasDraftOutput() && !(el('topic-ai-prompt') || {}).value) return;
                if (!confirm('AI 초안과 입력란을 비울까요?')) return;
                clearAddForm();
            };
        }

        ['topic-add-title', 'topic-add-question', 'topic-add-alt', 'topic-add-kor'].forEach(function (id) {
            const node = el(id);
            if (node && !node.dataset.aiHintBound) {
                node.dataset.aiHintBound = '1';
                node.addEventListener('input', updateAiModeHint);
            }
        });

        const btnAdd = el('btn-add-topic');
        if (btnAdd && !btnAdd.dataset.bound) {
            btnAdd.dataset.bound = '1';
            btnAdd.onclick = async function () {
                const prevLabel = btnAdd.textContent;
                try {
                    const server =
                        global.ContentLoader && global.ContentLoader.getServerTopics
                            ? global.ContentLoader.getServerTopics()
                            : [];
                    let topic = buildTopicFromForm(server);
                    if (typeof global.ComicGenerator !== 'undefined') {
                        btnAdd.disabled = true;
                        btnAdd.textContent = '4컷 생성 중…';
                        setAiStatus('답변 4컷 이미지를 만드는 중…');
                        topic = await global.ComicGenerator.attachTopicComic(topic);
                    }
                    global.TopicStore.addTopic(topic);
                    if (global.ContentLoader && global.ContentLoader.refreshMergedTopics) {
                        global.ContentLoader.refreshMergedTopics();
                    }
                    clearAddForm();
                    onChange();
                    setAiStatus('');
                    alert(
                        '추가했습니다: ' +
                            topic.title +
                            '\nID: ' +
                            topic.id +
                            (topic.topicComic ? '\n4컷 힌트 포함' : '')
                    );
                } catch (e) {
                    setAiStatus(e.message || String(e), true);
                    alert(e.message || String(e));
                } finally {
                    btnAdd.disabled = false;
                    btnAdd.textContent = prevLabel;
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
        fillFormFromTopic: fillFormFromTopic,
        readDraftFromForm: readDraftFromForm,
        hasDraftOutput: hasDraftOutput,
        bind: bind,
    };
})(window);
