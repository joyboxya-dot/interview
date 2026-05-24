/**
 * 청크 단위 망각곡선 (주제와 무관한 전역 스케줄)
 */
(function (global) {
    const STORAGE_KEY = 'interviewChunkSrsV1';

    /** 복습 간격(시간): 첫 통과 후 단계적으로 증가 */
    const REP_INTERVAL_HOURS = [4, 24, 72, 168, 336, 720];
    const FAIL_RETRY_MS = 10 * 60 * 1000;
    const NEW_CHUNK_DELAY_MS = 0;

    function defaultCard() {
        return {
            hintLevel: 2,
            repLevel: 0,
            streak: 0,
            ease: 2.5,
            nextDueAt: 0,
            lastAttemptAt: 0,
            lastPass: false,
            history: [],
        };
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { cards: {}, version: 1 };
            const s = JSON.parse(raw);
            if (!s.cards) s.cards = {};
            return s;
        } catch (e) {
            return { cards: {}, version: 1 };
        }
    }

    function saveState(state) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function getCard(state, key) {
        if (!state.cards[key]) state.cards[key] = defaultCard();
        return state.cards[key];
    }

    /** 새 청크 키 등록 · 삭제된 키 정리 */
    function syncChunkKeys(keys) {
        const state = loadState();
        const set = new Set(keys || []);
        Object.keys(state.cards).forEach(function (k) {
            if (!set.has(k)) delete state.cards[k];
        });
        (keys || []).forEach(function (k) {
            if (!state.cards[k]) {
                state.cards[k] = defaultCard();
                state.cards[k].nextDueAt = Date.now() + NEW_CHUNK_DELAY_MS;
            }
        });
        saveState(state);
        return state;
    }

    function dueCount(now) {
        const t = now != null ? now : Date.now();
        const state = loadState();
        return Object.keys(state.cards).filter(function (k) {
            return state.cards[k].nextDueAt <= t;
        }).length;
    }

    function pickNextDueKey(now) {
        const t = now != null ? now : Date.now();
        const state = loadState();
        const keys = Object.keys(state.cards);
        if (!keys.length) return null;

        const due = keys.filter(function (k) {
            return state.cards[k].nextDueAt <= t;
        });
        if (due.length) {
            due.sort(function (a, b) {
                return state.cards[a].nextDueAt - state.cards[b].nextDueAt;
            });
            return due[Math.floor(Math.random() * Math.min(due.length, 12))];
        }

        const never = keys.filter(function (k) {
            return !state.cards[k].lastAttemptAt;
        });
        if (never.length) return never[Math.floor(Math.random() * never.length)];

        keys.sort(function (a, b) {
            return state.cards[a].nextDueAt - state.cards[b].nextDueAt;
        });
        return keys[0];
    }

    function getHintLevel(key) {
        const state = loadState();
        return getCard(state, key).hintLevel;
    }

    function formatNextDue(key) {
        const state = loadState();
        const card = state.cards[key];
        if (!card) return '';
        const ms = card.nextDueAt - Date.now();
        if (ms <= 0) return '지금 복습';
        const min = Math.ceil(ms / 60000);
        if (min < 60) return min + '분 후';
        const hr = Math.ceil(ms / 3600000);
        if (hr < 48) return hr + '시간 후';
        return Math.ceil(ms / 86400000) + '일 후';
    }

    /**
     * @param {string} key
     * @param {boolean} pass
     * @param {object} metrics
     * @returns {{ pass: boolean, fluHint: string, nextDueLabel: string, hintLevel: number }}
     */
    function recordAttempt(key, pass, metrics) {
        const state = loadState();
        const card = getCard(state, key);
        const now = Date.now();
        let fluHint = '';

        let speedOk = true;
        if (global.L2Fluency && metrics) {
            const flu = global.L2Fluency.evaluateFluency(metrics);
            speedOk = flu.speedOk;
            if (!flu.pass && flu.formatHint) fluHint = flu.formatHint(metrics, flu);
        }

        const overallPass = pass && speedOk;

        card.history.push({
            at: now,
            pass: overallPass,
            hintLevel: card.hintLevel,
            metrics: metrics,
        });
        if (card.history.length > 12) card.history.shift();

        card.lastAttemptAt = now;
        card.lastPass = overallPass;

        if (overallPass) {
            card.streak += 1;
            if (card.streak >= 2 && card.hintLevel > 0) {
                card.hintLevel -= 1;
                card.streak = 0;
            }
            card.repLevel = Math.min(card.repLevel + 1, REP_INTERVAL_HOURS.length - 1);
            const hours = REP_INTERVAL_HOURS[card.repLevel];
            card.nextDueAt = now + hours * 3600000;
            card.ease = Math.min(3, card.ease + 0.05);
        } else {
            card.streak = 0;
            card.hintLevel = Math.min(2, card.hintLevel + 1);
            card.repLevel = Math.max(0, card.repLevel - 1);
            card.nextDueAt = now + FAIL_RETRY_MS;
            card.ease = Math.max(1.3, card.ease - 0.15);
            if (!pass) fluHint = fluHint || '발음·내용을 다시 맞춰 보세요.';
            else if (!speedOk) fluHint = fluHint || '속도가 느립니다. 힌트를 늘리고 다시 연습합니다.';
        }

        saveState(state);
        return {
            pass: overallPass,
            fluHint: fluHint,
            nextDueLabel: formatNextDue(key),
            hintLevel: card.hintLevel,
        };
    }

    function bumpHintLevel(key, delta) {
        const state = loadState();
        const card = getCard(state, key);
        card.hintLevel = Math.max(0, Math.min(2, card.hintLevel + delta));
        saveState(state);
    }

    function resetAll() {
        localStorage.removeItem(STORAGE_KEY);
    }

    function hintLevelLabel(level) {
        if (level >= 2) return '힌트 많음';
        if (level === 1) return 'cloze';
        return '의미만';
    }

    global.ChunkSrs = {
        syncChunkKeys: syncChunkKeys,
        dueCount: dueCount,
        pickNextDueKey: pickNextDueKey,
        getHintLevel: getHintLevel,
        formatNextDue: formatNextDue,
        recordAttempt: recordAttempt,
        bumpHintLevel: bumpHintLevel,
        resetAll: resetAll,
        hintLevelLabel: hintLevelLabel,
        loadState: loadState,
    };
})(window);
