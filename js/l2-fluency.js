/**
 * L2 면접형 속도 기준 (원어민 아님)
 */
(function (global) {
    const STORAGE_KEY = 'interviewL2SpeedPresetV1';

    const PRESETS = {
        practice: {
            id: 'practice',
            label: '연습 (느리게)',
            msPerWord: 550,
            ttfbBaseMs: 2800,
            ttfbPerWordMs: 180,
            maxDurationRatio: 1.65,
            requiredStreak: 2,
        },
        interview: {
            id: 'interview',
            label: '면접형 (기본)',
            msPerWord: 420,
            ttfbBaseMs: 2200,
            ttfbPerWordMs: 140,
            maxDurationRatio: 1.45,
            requiredStreak: 2,
        },
        strict: {
            id: 'strict',
            label: '엄격',
            msPerWord: 350,
            ttfbBaseMs: 1800,
            ttfbPerWordMs: 110,
            maxDurationRatio: 1.35,
            requiredStreak: 2,
        },
    };

    function getPresetId() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && PRESETS[saved]) return saved;
        return 'interview';
    }

    function setPresetId(id) {
        if (!PRESETS[id]) return;
        localStorage.setItem(STORAGE_KEY, id);
    }

    function getPreset() {
        return PRESETS[getPresetId()];
    }

    function countWords(text) {
        return String(text || '')
            .replace(/[^a-zA-Z0-9\s']/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean).length;
    }

    function expectedDurationMs(wordCount, modelAudioSec) {
        const p = getPreset();
        const byWords = wordCount * p.msPerWord;
        if (modelAudioSec && modelAudioSec > 0) {
            return Math.max(byWords, modelAudioSec * 1000 * 0.85);
        }
        return byWords;
    }

    function maxTtfbMs(wordCount) {
        const p = getPreset();
        return Math.min(8000, p.ttfbBaseMs + wordCount * p.ttfbPerWordMs);
    }

    /**
     * @param {object} m metrics: ttfbMs, speakDurationMs, wordCount, accuracyOk, modelAudioSec
     */
    function evaluateFluency(metrics) {
        const p = getPreset();
        const wc = metrics.wordCount || 1;
        const ttfbLimit = maxTtfbMs(wc);
        const expected = expectedDurationMs(wc, metrics.modelAudioSec);
        const durationLimit = expected * p.maxDurationRatio;

        const speedOk =
            metrics.ttfbMs <= ttfbLimit &&
            metrics.speakDurationMs <= durationLimit &&
            metrics.speakDurationMs >= Math.min(400, expected * 0.25);

        const contentOk = metrics.accuracyOk !== false;

        return {
            pass: speedOk && contentOk,
            speedOk: speedOk,
            contentOk: contentOk,
            limits: { ttfbLimit, durationLimit, expected },
            preset: p,
        };
    }

    function formatHint(metrics, result) {
        const pct = function (n) {
            return Math.round(n) + 'ms';
        };
        let msg = 'L2 기준 · 시작 ' + pct(metrics.ttfbMs) + ' / 발화 ' + pct(metrics.speakDurationMs);
        if (!result.speedOk) {
            if (metrics.ttfbMs > result.limits.ttfbLimit) msg += ' · 말 시작이 느림';
            if (metrics.speakDurationMs > result.limits.durationLimit) msg += ' · 말이 너무 김';
        }
        return msg;
    }

    global.L2Fluency = {
        PRESETS: PRESETS,
        getPresetId: getPresetId,
        setPresetId: setPresetId,
        getPreset: getPreset,
        countWords: countWords,
        evaluateFluency: evaluateFluency,
        formatHint: formatHint,
        expectedDurationMs: expectedDurationMs,
    };
})(window);
