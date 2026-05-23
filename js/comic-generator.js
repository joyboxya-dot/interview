/**
 * 주제 4컷 생성 — POST /api/generate-topic-comic (data URI, localStorage 저장용)
 */
(function (global) {
    function apiBase() {
        if (global.location && global.location.origin && global.location.protocol !== 'file:') {
            return global.location.origin;
        }
        return 'http://localhost:3001';
    }

    async function attachTopicComic(topic) {
        const t = Object.assign({}, topic);
        const res = await fetch(apiBase() + '/api/generate-topic-comic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic: t, preferFiles: false }),
        });
        const data = await res.json().catch(function () {
            return {};
        });
        if (!res.ok || !data.ok || !data.topicComic) {
            throw new Error(
                (data && (data.detail || data.error)) ||
                    '4컷 생성 실패 — speech-server가 켜져 있는지 확인하세요.'
            );
        }
        t.topicComic = data.topicComic;
        return t;
    }

    global.ComicGenerator = {
        attachTopicComic: attachTopicComic,
    };
})(window);
