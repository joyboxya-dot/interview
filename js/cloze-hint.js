/**
 * 점진 가리기(cloze) — 끝 단어부터 위로 가림
 */
(function (global) {
    const STORAGE_KEY = 'interviewClozeLevelsV1';

    function loadMap() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return {};
            const o = JSON.parse(raw);
            return o && typeof o === 'object' ? o : {};
        } catch (e) {
            return {};
        }
    }

    function saveMap(map) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }

    function sentenceKey(topicIdx, sentIdx) {
        return topicIdx + '-sent-' + sentIdx;
    }

    function fullKey(topicIdx) {
        return topicIdx + '-full';
    }

    function getLevel(key) {
        const map = loadMap();
        const n = parseInt(map[key], 10);
        return isNaN(n) || n < 0 ? 0 : n;
    }

    function bumpLevel(key, wordCount) {
        const map = loadMap();
        const max = maxLevel(wordCount);
        const next = Math.min(max, getLevel(key) + 1);
        map[key] = next;
        saveMap(map);
        return next;
    }

    function maxLevel(wordCount) {
        const wc = Math.max(1, wordCount || 1);
        return Math.max(1, Math.ceil(wc * 0.55));
    }

    function hideCount(wordCount, level) {
        if (!level) return 0;
        return Math.min(maxLevel(wordCount), level);
    }

    function tokenize(text) {
        return String(text || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }

    /** 마지막 단어부터 level개 가림 */
    function indicesToHideFromEnd(tokens, level) {
        const n = hideCount(tokens.length, level);
        const hide = new Set();
        for (let i = tokens.length - 1; i >= 0 && hide.size < n; i--) {
            hide.add(i);
        }
        return hide;
    }

    function renderPlain(text, level) {
        const tokens = tokenize(text);
        if (!tokens.length) return '';
        const hide = indicesToHideFromEnd(tokens, level);
        return tokens
            .map(function (tok, i) {
                if (!hide.has(i)) return escapeHtml(tok);
                return '<span class="cloze-blank" aria-hidden="true">___</span>';
            })
            .join(' ');
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function resetTopic(topicIdx) {
        const map = loadMap();
        const prefix = topicIdx + '-';
        Object.keys(map).forEach(function (k) {
            if (k.indexOf(prefix) === 0) delete map[k];
        });
        saveMap(map);
    }

    global.ClozeHint = {
        sentenceKey: sentenceKey,
        fullKey: fullKey,
        getLevel: getLevel,
        bumpLevel: bumpLevel,
        maxLevel: maxLevel,
        renderPlain: renderPlain,
        resetTopic: resetTopic,
    };
})(window);
