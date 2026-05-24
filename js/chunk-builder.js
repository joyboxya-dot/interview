/**
 * 주제 JSON → 체화용 청크 목록 (주제 순서와 무관하게 SRS에 등록)
 */
(function (global) {
    const ROLE_LABELS = {
        bridge: '브릿지',
        filler: '필러',
        glue: '연결',
        body: '문장',
        full: '통문장',
    };

    function bridgeEn(topic) {
        return String((topic && topic.bridge) || '').trim();
    }

    function bridgeKo(topic) {
        return String((topic && (topic.bridgeKo || topic.bridgeKor)) || '').trim();
    }

    function normalizePair(pair) {
        if (Array.isArray(pair)) return [String(pair[0] || '').trim(), String(pair[1] || '').trim()];
        return [String(pair.ko || '').trim(), String(pair.en || '').trim()];
    }

    function pushChunk(list, topic, topicIndex, chunkId, role, ko, en, order) {
        if (!en) return order;
        list.push({
            key: topic.id + ':' + chunkId,
            topicId: topic.id,
            topicIndex: topicIndex,
            chunkId: chunkId,
            role: role,
            roleLabel: ROLE_LABELS[role] || role,
            ko: ko || '',
            en: en,
            order: order,
        });
        return order + 1;
    }

    /** topic.chunks 가 있으면 그대로, 없으면 bridge + fillers + glues + sentences 로 생성 */
    function buildChunksForTopic(topic, topicIndex) {
        if (!topic || !topic.id) return [];
        const out = [];
        let order = 0;

        if (topic.chunks && Array.isArray(topic.chunks) && topic.chunks.length) {
            topic.chunks.forEach(function (raw, i) {
                const en = String(raw.en || '').trim();
                if (!en) return;
                if (String(raw.role || 'body') === 'full') return;
                const chunkId = String(raw.id || raw.chunkId || 'c' + i);
                order = pushChunk(
                    out,
                    topic,
                    topicIndex,
                    chunkId,
                    raw.role || 'body',
                    raw.ko || '',
                    en,
                    raw.order != null ? raw.order : order
                );
            });
            return out.sort(function (a, b) {
                return a.order - b.order;
            });
        }

        const bEn = bridgeEn(topic);
        const bKo = bridgeKo(topic);
        if (bEn) {
            order = pushChunk(out, topic, topicIndex, 'bridge', 'bridge', bKo || '이 주제로 이어가기', bEn, order);
        }

        (topic.fillers || []).forEach(function (f, i) {
            const pair = normalizePair(f);
            order = pushChunk(out, topic, topicIndex, 'filler-' + i, 'filler', pair[0], pair[1], order);
        });

        const sents = (topic.sentences || []).map(normalizePair).filter(function (s) {
            return s[0] || s[1];
        });

        (topic.glues || []).forEach(function (g, gi) {
            const pair = normalizePair(g);
            const before = g.beforeBody != null ? g.beforeBody : g.attachBefore != null ? g.attachBefore : gi + 1;
            const glueId = 'glue-' + gi;
            order = pushChunk(out, topic, topicIndex, glueId, 'glue', pair[0], pair[1], order);
            if (typeof before === 'number' && sents[before]) {
                sents[before]._glueBefore = glueId;
            }
        });

        sents.forEach(function (sent, i) {
            order = pushChunk(out, topic, topicIndex, 'body-' + i, 'body', sent[0], sent[1], order);
        });

        const fullParts = [];
        if (bEn) fullParts.push(bEn);
        sents.forEach(function (s) {
            if (s[1]) fullParts.push(s[1]);
        });
        /* 통문장(full) 청크는 생성하지 않음 — 체화는 bridge/body/filler/glue 단위만 */

        return out;
    }

    function buildAll(topics) {
        const all = [];
        (topics || []).forEach(function (topic, topicIndex) {
            buildChunksForTopic(topic, topicIndex).forEach(function (c) {
                if (c.role !== 'full') all.push(c);
            });
        });
        return all;
    }

    function findChunk(allChunks, key) {
        for (let i = 0; i < allChunks.length; i++) {
            if (allChunks[i].key === key) return allChunks[i];
        }
        return null;
    }

    function getTopicTitle(topics, topicIndex) {
        if (!topics || !topics[topicIndex]) return '';
        return topics[topicIndex].title || topics[topicIndex].id || '';
    }

    global.ChunkBuilder = {
        ROLE_LABELS: ROLE_LABELS,
        buildChunksForTopic: buildChunksForTopic,
        buildAll: buildAll,
        findChunk: findChunk,
        getTopicTitle: getTopicTitle,
    };
})(window);
