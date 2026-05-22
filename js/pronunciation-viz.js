/**
 * Azure 발음 평가 — 타임라인 + 오류 단어만 표시 (점수 막대·상세 헤더 없음)
 */
(function (global) {
    const ERROR_LABELS = {
        None: { label: '정상', cls: 'pa-err-none' },
        Mispronunciation: { label: '오발음', cls: 'pa-err-mis' },
        Omission: { label: '생략', cls: 'pa-err-omit' },
        Insertion: { label: '삽입', cls: 'pa-err-ins' },
        UnexpectedBreak: { label: '부적절한 멈춤', cls: 'pa-err-break' },
        MissingBreak: { label: '멈춤 누락', cls: 'pa-err-missbreak' },
        Monotone: { label: '단조로움', cls: 'pa-err-mono' },
    };

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function ticksToMs(t) {
        if (t == null || t === undefined || isNaN(Number(t))) return null;
        return Math.round(Number(t) / 10000);
    }

    function normalizePhoneme(p) {
        const pa = p.PronunciationAssessment || p.pronunciationAssessment || {};
        return {
            phoneme: p.Phoneme || p.phoneme || '',
            accuracyScore: pa.AccuracyScore != null ? pa.AccuracyScore : p.accuracyScore,
            offsetMs: ticksToMs(p.Offset != null ? p.Offset : p.offset),
            durationMs: ticksToMs(p.Duration != null ? p.Duration : p.duration),
        };
    }

    function normalizeSyllable(s) {
        const pa = s.PronunciationAssessment || s.pronunciationAssessment || {};
        return {
            syllable: s.Syllable || s.syllable || '',
            accuracyScore: pa.AccuracyScore != null ? pa.AccuracyScore : s.accuracyScore,
            offsetMs: ticksToMs(s.Offset != null ? s.Offset : s.offset),
            durationMs: ticksToMs(s.Duration != null ? s.Duration : s.duration),
        };
    }

    function normalizeDetailWord(w) {
        const paW = w.PronunciationAssessment || w.pronunciationAssessment || {};
        return {
            word: w.Word || w.word || '',
            accuracyScore:
                paW.AccuracyScore != null
                    ? paW.AccuracyScore
                    : w.AccuracyScore != null
                      ? w.AccuracyScore
                      : w.accuracyScore,
            errorType: paW.ErrorType || w.ErrorType || w.errorType || 'None',
            offsetMs: ticksToMs(w.Offset != null ? w.Offset : w.offset),
            durationMs: ticksToMs(w.Duration != null ? w.Duration : w.duration),
            phonemes: (w.Phonemes || w.phonemes || []).map(normalizePhoneme),
            syllables: (w.Syllables || w.syllables || []).map(normalizeSyllable),
        };
    }

    function normalizeSdkWord(w) {
        return {
            word: w.word || '',
            accuracyScore: w.accuracyScore,
            errorType: w.errorType || 'None',
            offsetMs: ticksToMs(w.offset),
            durationMs: ticksToMs(w.duration),
            phonemes: (w.phonemes || []).map(normalizePhoneme),
            syllables: (w.syllables || []).map(normalizeSyllable),
        };
    }

    function parseWordsFromJson(jsonStr) {
        if (!jsonStr) return [];
        try {
            const j = JSON.parse(jsonStr);
            const nbest = j.NBest && j.NBest[0];
            const words = (nbest && nbest.Words) || j.Words || [];
            return words.map(normalizeDetailWord);
        } catch (e) {
            return [];
        }
    }

    function getIssueWords(words) {
        return (words || []).filter(function (w) {
            const et = w.errorType || 'None';
            return et !== 'None';
        });
    }

    function parseFromPa(pa, rawJson) {
        if (!pa) return null;
        let words = [];
        if (pa.detailResult && pa.detailResult.Words && pa.detailResult.Words.length) {
            words = pa.detailResult.Words.map(normalizeDetailWord);
        } else if (pa.words && pa.words.length) {
            words = pa.words.map(normalizeSdkWord);
        }
        if (!words.length && rawJson) {
            words = parseWordsFromJson(rawJson);
        }

        let totalMs = 0;
        words.forEach(function (w) {
            if (w.offsetMs != null && w.durationMs != null) {
                totalMs = Math.max(totalMs, w.offsetMs + w.durationMs);
            }
        });
        if (!totalMs) totalMs = words.length * 400;

        const errorCounts = {};
        words.forEach(function (w) {
            const et = w.errorType || 'None';
            errorCounts[et] = (errorCounts[et] || 0) + 1;
        });

        return {
            accuracyScore: pa.accuracyScore,
            fluencyScore: pa.fluencyScore,
            completenessScore: pa.completenessScore,
            prosodyScore: pa.prosodyScore != null ? pa.prosodyScore : null,
            pronunciationScore: pa.pronunciationScore != null ? pa.pronunciationScore : null,
            words: words,
            issueWords: getIssueWords(words),
            totalDurationMs: totalMs,
            errorCounts: errorCounts,
            hasMiscue: words.some(function (w) {
                return w.errorType === 'Omission' || w.errorType === 'Insertion';
            }),
        };
    }

    function buildTimeline(words, totalMs) {
        if (!words.length) return '';
        const parts = words.map(function (w) {
            const meta = ERROR_LABELS[w.errorType] || ERROR_LABELS.None;
            const left = w.offsetMs != null ? (w.offsetMs / totalMs) * 100 : 0;
            const width = w.durationMs != null
                ? Math.max(4, (w.durationMs / totalMs) * 100)
                : Math.max(6, 100 / words.length);
            const acc = w.accuracyScore != null ? Math.round(w.accuracyScore) : '';
            const timeTip =
                (w.offsetMs != null ? (w.offsetMs / 1000).toFixed(1) + 's' : '') +
                (w.durationMs != null ? ' · ' + (w.durationMs / 1000).toFixed(1) + 's' : '');
            return (
                '<span class="pa-tl-word ' + meta.cls + '" style="left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%;" ' +
                'title="' + escapeHtml(w.word + ' · ' + meta.label + (acc !== '' ? ' · ' + acc : '') + ' · ' + timeTip) + '">' +
                escapeHtml(w.word) +
                '</span>'
            );
        }).join('');
        const sec = (totalMs / 1000).toFixed(1);
        return (
            '<div class="pa-timeline">' +
            '<div class="pa-timeline-title">타임라인</div>' +
            '<div class="pa-timeline-track">' + parts + '</div>' +
            '<div class="pa-timeline-axis">0s — ' + sec + 's</div>' +
            '</div>'
        );
    }

    /** 타임라인만 (점수·오류 카드는 피드백 상단·숫자 버튼에서 표시) */
    function buildHtml(detail) {
        if (!detail || !detail.words.length) return '';
        return '<div class="pa-viz">' + buildTimeline(detail.words, detail.totalDurationMs) + '</div>';
    }

    global.PronunciationViz = {
        parseFromPa: parseFromPa,
        buildHtml: buildHtml,
        getIssueWords: getIssueWords,
        ERROR_LABELS: ERROR_LABELS,
    };
})(window);
