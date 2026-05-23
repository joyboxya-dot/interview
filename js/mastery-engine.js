/**
 * 항목별 숙달 + 숙달 큐 (무제한 재출제)
 */
(function (global) {
    const STORAGE_KEY = 'interviewMasteryV1';
    const MODE_KEY = 'interviewMasteryModeV1';

    function defaultState() {
        return { items: {}, queue: [] };
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return defaultState();
            const s = JSON.parse(raw);
            if (!s.items) s.items = {};
            if (!Array.isArray(s.queue)) s.queue = [];
            return s;
        } catch (e) {
            return defaultState();
        }
    }

    function saveState(state) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function isMasteryMode() {
        const v = localStorage.getItem(MODE_KEY);
        if (v === '0' || v === 'false') return false;
        return true;
    }

    function setMasteryMode(on) {
        localStorage.setItem(MODE_KEY, on ? '1' : '0');
    }

    function itemKey(topicIdx, type, sentIdx) {
        if (type === 'full') return topicIdx + '-full';
        return topicIdx + '-sent-' + sentIdx;
    }

    function parseKey(key) {
        const m = key.match(/^(\d+)-sent-(\d+)$/);
        if (m) return { topicIdx: parseInt(m[1], 10), type: 'sent', sentIdx: parseInt(m[2], 10) };
        const f = key.match(/^(\d+)-full$/);
        if (f) return { topicIdx: parseInt(f[1], 10), type: 'full', sentIdx: -1 };
        return null;
    }

    function getItem(state, key) {
        if (!state.items[key]) {
            state.items[key] = { mastered: false, streak: 0, inQueue: false, history: [] };
        }
        return state.items[key];
    }

    function addToQueue(state, key) {
        const item = getItem(state, key);
        item.inQueue = true;
        item.mastered = false;
        if (state.queue.indexOf(key) < 0) state.queue.push(key);
    }

    function removeFromQueue(state, key) {
        const item = getItem(state, key);
        item.inQueue = false;
        state.queue = state.queue.filter(function (k) {
            return k !== key;
        });
    }

    function recordAttempt(key, pass, metrics) {
        const state = loadState();
        const item = getItem(state, key);
        const required = global.L2Fluency ? global.L2Fluency.getPreset().requiredStreak : 2;

        item.history.push({
            at: Date.now(),
            pass: pass,
            metrics: metrics,
        });
        if (item.history.length > 10) item.history.shift();

        if (pass) {
            item.streak += 1;
            if (item.streak >= required) {
                item.mastered = true;
                removeFromQueue(state, key);
            }
        } else {
            item.streak = 0;
            item.mastered = false;
            addToQueue(state, key);
        }
        saveState(state);
        return item;
    }

    function registerFailure(key) {
        const state = loadState();
        addToQueue(state, key);
        const item = getItem(state, key);
        item.streak = 0;
        item.mastered = false;
        saveState(state);
    }

    function queueCount() {
        return loadState().queue.length;
    }

    function pickNextQueueKey(topicIdx) {
        const state = loadState();
        const q = state.queue.filter(function (key) {
            const p = parseKey(key);
            return p && (topicIdx === undefined || p.topicIdx === topicIdx);
        });
        if (!q.length) return null;
        return q[Math.floor(Math.random() * q.length)];
    }

    function clearTopic(topicIdx) {
        const state = loadState();
        Object.keys(state.items).forEach(function (key) {
            const p = parseKey(key);
            if (p && p.topicIdx === topicIdx) delete state.items[key];
        });
        state.queue = state.queue.filter(function (key) {
            const p = parseKey(key);
            return !p || p.topicIdx !== topicIdx;
        });
        saveState(state);
    }

    function resetAll() {
        saveState(defaultState());
    }

    global.MasteryEngine = {
        itemKey: itemKey,
        parseKey: parseKey,
        isMasteryMode: isMasteryMode,
        setMasteryMode: setMasteryMode,
        recordAttempt: recordAttempt,
        registerFailure: registerFailure,
        queueCount: queueCount,
        pickNextQueueKey: pickNextQueueKey,
        loadState: loadState,
        clearTopic: clearTopic,
        resetAll: resetAll,
    };
})(window);
