/**
 * 점진 가리기(cloze) — 1바퀴 끝→앞, 2바퀴 랜덤 (총 2×maxLevel)
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

    /** 한 문장 cloze 준비 Enter 횟수 = maxLevel × 2 (순차 + 랜덤) */
    function maxPrepSteps(wordCount) {
        return maxLevel(wordCount) * 2;
    }

    function hideCount(wordCount, level) {
        if (!level) return 0;
        return Math.min(maxLevel(wordCount), level);
    }

    /** prepStep 1..2*max → { mode: 'end'|'random', hideLevel, lap, lapMax } */
    function prepStepConfig(prepStep, wordCount) {
        const lapMax = maxLevel(wordCount);
        const step = Math.max(1, Math.min(maxPrepSteps(wordCount), prepStep || 1));
        if (step <= lapMax) {
            return { mode: 'end', hideLevel: step, lap: 1, lapMax: lapMax, prepStep: step, prepMax: lapMax * 2 };
        }
        const hideLevel = step - lapMax;
        return {
            mode: 'random',
            hideLevel: hideLevel,
            lap: 2,
            lapMax: lapMax,
            prepStep: step,
            prepMax: lapMax * 2,
        };
    }

    function hashSeed(str) {
        let h = 2166136261;
        const s = String(str || '');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
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

    /** 같은 prepStep이면 같은 빈칸 위치 (새로고침해도 동일) */
    function indicesToHideRandom(tokens, level, seedKey) {
        const n = hideCount(tokens.length, level);
        const hide = new Set();
        if (!n) return hide;
        const idx = tokens.map(function (_, i) {
            return i;
        });
        let seed = hashSeed(seedKey + '|' + level);
        for (let i = idx.length - 1; i > 0; i--) {
            seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
            const j = seed % (i + 1);
            const t = idx[i];
            idx[i] = idx[j];
            idx[j] = t;
        }
        for (let k = 0; k < n && k < idx.length; k++) {
            hide.add(idx[k]);
        }
        return hide;
    }

    function renderPlain(text, level, mode, seedKey) {
        const tokens = tokenize(text);
        if (!tokens.length) return '';
        const hide =
            mode === 'random'
                ? indicesToHideRandom(tokens, level, seedKey || text)
                : indicesToHideFromEnd(tokens, level);
        return tokens
            .map(function (tok, i) {
                if (!hide.has(i)) return escapeHtml(tok);
                return '<span class="cloze-blank" aria-hidden="true">___</span>';
            })
            .join(' ');
    }

    function prepTagLabel(cfg) {
        if (!cfg) return '';
        if (cfg.mode === 'random') {
            return (
                '랜덤 가리기 ' +
                cfg.hideLevel +
                '/' +
                cfg.lapMax +
                ' (2바퀴·' +
                cfg.prepStep +
                '/' +
                cfg.prepMax +
                ')'
            );
        }
        return '끝→앞 가리기 ' + cfg.hideLevel + '/' + cfg.lapMax + ' (1바퀴·' + cfg.prepStep + '/' + cfg.prepMax + ')';
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
        maxPrepSteps: maxPrepSteps,
        prepStepConfig: prepStepConfig,
        prepTagLabel: prepTagLabel,
        renderPlain: renderPlain,
        resetTopic: resetTopic,
    };
})(window);
