/**
 * EvoLink — 면접 스크립트 AI 생성 · 단계별 수정
 */
(function (global) {
    function settingsUrl() {
        const s = global.INTERVIEW_SETTINGS || {};
        return s.generateScriptUrl || '/api/generate-script';
    }

    function summarizeExistingTopics(topics) {
        if (!topics || !topics.length) {
            return '(아직 등록된 스크립트 없음)';
        }
        return topics
            .slice(0, 12)
            .map(function (t, i) {
                const sentPreview = (t.sentences || [])
                    .slice(0, 2)
                    .map(function (s) {
                        return s[1] || s.en || '';
                    })
                    .join(' ');
                return (
                    i +
                    1 +
                    '. title: ' +
                    (t.title || '') +
                    '\n   question: ' +
                    (t.question || '') +
                    '\n   altQuestion: ' +
                    (t.altQuestion || '') +
                    '\n   bridge: ' +
                    (t.bridge || '') +
                    '\n   sample EN: ' +
                    sentPreview.slice(0, 120)
                );
            })
            .join('\n\n');
    }

    function errorMessage(err, data) {
        const code = (data && data.error) || (err && err.message) || '';
        if (code === 'evolink_not_configured') {
            return 'AI가 설정되지 않았습니다. speech-server/.env 에 EVOLINK_API_KEY 를 넣고 서버를 재시작하세요.';
        }
        if (code === 'user_prompt_required') {
            return '요청 내용을 입력해 주세요. (예: 모르는 툴 질문에 답하는 스크립트)';
        }
        if (code === 'invalid_json') {
            return (
                'AI 응답 JSON 형식이 올바르지 않습니다. 다시 생성해 보세요.' +
                (data && data.raw ? '\n\n(일부 응답: ' + data.raw.slice(0, 200) + '…)' : '')
            );
        }
        const shapeMap = {
            missing_title: '제목이 비어 있습니다. 다시 생성해 주세요.',
            missing_question: '면접 질문이 비어 있습니다.',
            missing_altQuestion: '돌발 질문이 비어 있습니다.',
            missing_kor: '한글 통문장이 비어 있습니다.',
            missing_sentences: '문장 쌍이 없습니다.',
            invalid_topic_shape: '스크립트 형식이 맞지 않습니다.',
        };
        if (shapeMap[code]) return shapeMap[code];
        if (String(code).indexOf('evolink_http_401') >= 0 || code === 'authentication_error') {
            return 'EvoLink API 키가 잘못되었습니다. EVOLINK_API_KEY 를 확인하세요.';
        }
        if (String(code).indexOf('Failed to fetch') >= 0) {
            return '서버에 연결할 수 없습니다. npm start 후 http://localhost:3001/index.html 로 여세요.';
        }
        return '스크립트 생성 실패: ' + (data && data.detail ? data.detail : code);
    }

    async function generateScript(userPrompt, options) {
        options = options || {};
        const topics = options.topics || [];
        const currentDraft = options.currentDraft || null;

        const body = {
            userPrompt: String(userPrompt || '').trim(),
            existingScriptsSummary: summarizeExistingTopics(topics),
            currentDraft: currentDraft,
        };

        const res = await fetch(settingsUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        let data = null;
        try {
            data = await res.json();
        } catch (e) {
            data = null;
        }

        if (!res.ok || !data || !data.ok) {
            const err = new Error((data && data.error) || 'request_failed');
            if (data && data.detail && typeof data.detail === 'string') {
                err.message = data.detail;
            }
            throw new Error(errorMessage(err, data));
        }

        return data.topic;
    }

    global.ScriptAI = {
        generateScript: generateScript,
        summarizeExistingTopics: summarizeExistingTopics,
        errorMessage: errorMessage,
    };
})(window);
