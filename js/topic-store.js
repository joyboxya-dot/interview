/**
 * 브라우저에 추가·삭제한 주제 (서버 topic JSON은 읽기 전용)
 */
(function (global) {
    const STORAGE_KEY = 'interviewTopicStoreV1';

    function defaultStore() {
        return { added: {}, deleted: [] };
    }

    function loadStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return defaultStore();
            const s = JSON.parse(raw);
            if (!s.added) s.added = {};
            if (!Array.isArray(s.deleted)) s.deleted = [];
            return s;
        } catch (e) {
            return defaultStore();
        }
    }

    function saveStore(store) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }

    function normalizeTopic(raw, index) {
        const t = Object.assign({}, raw);
        t.id = t.id || 'topic-' + String(index).padStart(2, '0');
        t.sentences = (t.sentences || []).map(function (s) {
            if (Array.isArray(s)) return [String(s[0] || '').trim(), String(s[1] || '').trim()];
            return [String(s.ko || '').trim(), String(s.en || '').trim()];
        }).filter(function (s) {
            return s[0] || s[1];
        });
        delete t.sentenceComics;
        return t;
    }

    function collectIds(serverTopics) {
        const ids = new Set();
        (serverTopics || []).forEach(function (t) {
            if (t.id) ids.add(t.id);
        });
        const store = loadStore();
        Object.keys(store.added).forEach(function (id) {
            ids.add(id);
        });
        return ids;
    }

    function generateTopicId(serverTopics) {
        const ids = collectIds(serverTopics);
        let max = -1;
        ids.forEach(function (id) {
            const m = String(id).match(/^topic-(\d+)$/i);
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        let n = max + 1;
        let candidate = 'topic-' + String(n).padStart(2, '0');
        while (ids.has(candidate)) {
            n += 1;
            candidate = 'topic-' + String(n).padStart(2, '0');
        }
        return candidate;
    }

    function mergeWithServer(serverTopics) {
        const store = loadStore();
        const deleted = new Set(store.deleted);
        const list = (serverTopics || [])
            .filter(function (t) {
                return t.id && !deleted.has(t.id);
            })
            .map(function (t, i) {
                return normalizeTopic(t, i);
            });

        Object.keys(store.added).forEach(function (id) {
            if (deleted.has(id)) return;
            list.push(normalizeTopic(Object.assign({ id: id }, store.added[id]), list.length));
        });

        list.sort(function (a, b) {
            const na = parseInt(String(a.id).replace(/\D/g, ''), 10) || 0;
            const nb = parseInt(String(b.id).replace(/\D/g, ''), 10) || 0;
            return na - nb || String(a.id).localeCompare(b.id);
        });
        return list;
    }

    function addTopic(topic) {
        const store = loadStore();
        const t = normalizeTopic(topic, 0);
        if (!t.title || !t.question) throw new Error('title_question_required');
        if (!t.sentences.length) throw new Error('sentences_required');
        store.deleted = store.deleted.filter(function (id) {
            return id !== t.id;
        });
        store.added[t.id] = t;
        saveStore(store);
        return t;
    }

    function deleteTopic(id) {
        const store = loadStore();
        if (!store.deleted.includes(id)) store.deleted.push(id);
        delete store.added[id];
        saveStore(store);
    }

    function clearUserChanges() {
        saveStore(defaultStore());
    }

    function listDeletable(topics) {
        return (topics || []).map(function (t) {
            return { id: t.id, title: t.title || t.id };
        });
    }

    global.TopicStore = {
        loadStore: loadStore,
        mergeWithServer: mergeWithServer,
        generateTopicId: generateTopicId,
        addTopic: addTopic,
        deleteTopic: deleteTopic,
        clearUserChanges: clearUserChanges,
        listDeletable: listDeletable,
        normalizeTopic: normalizeTopic,
    };
})(window);
