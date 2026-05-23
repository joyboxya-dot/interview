/**
 * 점진 가리기(cloze) — 문장·통문장별 레벨
 */
(function (global) {
    const STORAGE_KEY = 'interviewClozeLevelsV1';

    const SKIP_WORDS = new Set([
        'a', 'an', 'the', 'i', 'my', 'we', 'our', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'but',
        'is', 'am', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'that', 'this', 'as', 'by', 'with',
    ]);

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

    /** 가리기 우선: 긴 단어·콘텐츠어 */
    function indicesToHide(tokens, level) {
        const n = hideCount(tokens.length, level);
        if (!n) return new Set();

        const ranked = tokens.map(function (tok, i) {
            const bare = tok.toLowerCase().replace(/[^a-z]/g, '');
            const skip = SKIP_WORDS.has(bare) || bare.length < 2;
            return { i: i, score: skip ? -1 : bare.length + (/\d/.test(bare) ? 2 : 0) };
        });
        ranked.sort(function (a, b) {
            return b.score - a.score;
        });
        const hide = new Set();
        for (let k = 0; k < ranked.length && hide.size < n; k++) {
            if (ranked[k].score < 0) continue;
            hide.add(ranked[k].i);
        }
        if (hide.size < n) {
            for (let j = 0; j < tokens.length && hide.size < n; j++) {
                hide.add(j);
            }
        }
        return hide;
    }

    function renderPlain(text, level) {
        const tokens = tokenize(text);
        if (!tokens.length) return '';
        const hide = indicesToHide(tokens, level);
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
