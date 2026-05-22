/**
 * Azure 발음 평가 — 타임라인 + 오류 단어만 표시 (점수 막대·상세 헤더 없음)
 */
(function (global) {
    const PROSODY_CONF_THRESHOLD = 0.75;

    /** Azure 운율 린터 중 UI·재연습 대상에서 제외 (운율 총점·부적절한 멈춤은 유지) */
    const IGNORED_PROSODY_LINT = new Set(['MissingBreak', 'Monotone']);

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
            accuracyScore:
                pa.AccuracyScore != null ? pa.AccuracyScore : p.AccuracyScore != null ? p.AccuracyScore : p.accuracyScore,
            offsetMs: ticksToMs(p.Offset != null ? p.Offset : p.offset),
            durationMs: ticksToMs(p.Duration != null ? p.Duration : p.duration),
        };
    }

    function normalizeSyllable(s) {
        const pa = s.PronunciationAssessment || s.pronunciationAssessment || {};
        return {
            syllable: s.Syllable || s.syllable || '',
            accuracyScore:
                pa.AccuracyScore != null ? pa.AccuracyScore : s.AccuracyScore != null ? s.AccuracyScore : s.accuracyScore,
            offsetMs: ticksToMs(s.Offset != null ? s.Offset : s.offset),
            durationMs: ticksToMs(s.Duration != null ? s.Duration : s.duration),
        };
    }

    function isIgnoredProsodyLint(errorType) {
        return IGNORED_PROSODY_LINT.has(errorType);
    }

    /** 타임라인·오류 목록용 (멈춤 누락·단조로움 → 정상 처리) */
    function displayErrorType(errorType) {
        const et = errorType || 'None';
        return isIgnoredProsodyLint(et) ? 'None' : et;
    }

    function collectProsodyIssues(prosody) {
        const issues = [];
        if (!prosody) return issues;
        const br = prosody.Break;
        if (br) {
            const ub = br.UnexpectedBreak && br.UnexpectedBreak.Confidence;
            if (ub != null && ub > PROSODY_CONF_THRESHOLD) issues.push('부적절한 멈춤');
            if (br.ErrorTypes && br.ErrorTypes.length) {
                br.ErrorTypes.forEach(function (et) {
                    if (et && et !== 'None' && !isIgnoredProsodyLint(et) && ERROR_LABELS[et]) {
                        issues.push(ERROR_LABELS[et].label);
                    }
                });
            }
        }
        return [...new Set(issues)];
    }

    function mergeProsodyErrorType(errorType, prosodyIssues) {
        if (errorType && errorType !== 'None' && !isIgnoredProsodyLint(errorType)) return errorType;
        if (!prosodyIssues.length) return displayErrorType(errorType);
        if (prosodyIssues.indexOf('부적절한 멈춤') >= 0) return 'UnexpectedBreak';
        return displayErrorType(errorType);
    }

    function normalizeDetailWord(w) {
        const paW = w.PronunciationAssessment || w.pronunciationAssessment || {};
        let errorType = paW.ErrorType || w.ErrorType || w.errorType || 'None';
        const prosody = (w.Feedback && w.Feedback.Prosody) || w.prosodyFeedback || null;
        const prosodyIssues = collectProsodyIssues(prosody);
        errorType = mergeProsodyErrorType(errorType, prosodyIssues);
        return {
            word: w.Word || w.word || '',
            accuracyScore:
                paW.AccuracyScore != null
                    ? paW.AccuracyScore
                    : w.AccuracyScore != null
                      ? w.AccuracyScore
                      : w.accuracyScore,
            errorType: displayErrorType(errorType),
            offsetMs: ticksToMs(w.Offset != null ? w.Offset : w.offset),
            durationMs: ticksToMs(w.Duration != null ? w.Duration : w.duration),
            phonemes: (w.Phonemes || w.phonemes || []).map(normalizePhoneme),
            syllables: (w.Syllables || w.syllables || []).map(normalizeSyllable),
            prosodyIssues: prosodyIssues,
        };
    }

    function normalizeSdkWord(w) {
        const prosodyIssues = w.prosodyIssues || collectProsodyIssues(w.prosodyFeedback);
        return {
            word: w.word || '',
            accuracyScore: w.accuracyScore,
            errorType: displayErrorType(mergeProsodyErrorType(w.errorType || 'None', prosodyIssues)),
            offsetMs: ticksToMs(w.offset),
            durationMs: ticksToMs(w.duration),
            phonemes: (w.phonemes || []).map(normalizePhoneme),
            syllables: (w.syllables || []).map(normalizeSyllable),
            prosodyIssues: prosodyIssues,
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
            const et = displayErrorType(w.errorType);
            if (et !== 'None') return true;
            const acc = w.accuracyScore != null ? Math.round(w.accuracyScore) : 100;
            return acc < 80;
        });
    }

    function issueWordSpeakLabel(w) {
        const et = displayErrorType(w.errorType);
        if (et !== 'None') return (ERROR_LABELS[et] || { label: et }).label;
        return '발음 점수 낮음';
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
            const et = displayErrorType(w.errorType);
            if (et === 'None') return;
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
            const width =
                w.durationMs != null ? Math.max(4, (w.durationMs / totalMs) * 100) : Math.max(6, 100 / words.length);
            const acc = w.accuracyScore != null ? Math.round(w.accuracyScore) : '';
            const timeTip =
                (w.offsetMs != null ? (w.offsetMs / 1000).toFixed(1) + 's' : '') +
                (w.durationMs != null ? ' · ' + (w.durationMs / 1000).toFixed(1) + 's' : '');
            const proTip = w.prosodyIssues && w.prosodyIssues.length ? ' · ' + w.prosodyIssues.join(', ') : '';
            return (
                '<span class="pa-tl-word ' +
                meta.cls +
                '" style="left:' +
                left.toFixed(1) +
                '%;width:' +
                width.toFixed(1) +
                '%;" ' +
                'title="' +
                escapeHtml(w.word + ' · ' + meta.label + (acc !== '' ? ' · ' + acc : '') + timeTip + proTip) +
                '">' +
                escapeHtml(w.word) +
                '</span>'
            );
        }).join('');
        const sec = (totalMs / 1000).toFixed(1);
        return (
            '<div class="pa-timeline">' +
            '<div class="pa-timeline-title">타임라인</div>' +
            '<div class="pa-timeline-track">' +
            parts +
            '</div>' +
            '<div class="pa-timeline-axis">0s — ' +
            sec +
            's</div>' +
            '</div>'
        );
    }

    function buildIssueWordCards(issueWords) {
        if (!issueWords.length) return '';
        const cards = issueWords.slice(0, 9).map(function (w, idx) {
            const et = displayErrorType(w.errorType);
            const meta = et !== 'None' ? ERROR_LABELS[et] : { label: issueWordSpeakLabel(w), cls: 'pa-err-mis' };
            const acc = w.accuracyScore != null ? Math.round(w.accuracyScore) : '—';
            const time = w.offsetMs != null ? '@' + (w.offsetMs / 1000).toFixed(1) + 's' : '';
            const safeWord = String(w.word || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const shortcut = idx + 1;
            const speakBtn =
                '<button type="button" class="pa-word-speak-btn" onclick="speakExaggeratedWord(\'' +
                safeWord +
                '\')" title="느리게 듣기">' +
                '🔊 발음 <span class="shortcut-key">' +
                shortcut +
                '</span></button>';
            const scoreLow = w.accuracyScore != null && Math.round(w.accuracyScore) < 80;
            let phonHtml = '';
            const weakPhonemes = (w.phonemes || []).filter(function (p) {
                return p.accuracyScore != null && Math.round(p.accuracyScore) < 70;
            });
            if (weakPhonemes.length) {
                phonHtml =
                    '<div class="pa-phoneme-row">' +
                    weakPhonemes
                        .map(function (p) {
                            const pAcc = Math.round(p.accuracyScore);
                            return (
                                '<span class="pa-phoneme pa-phoneme-weak" title="음소 ' +
                                escapeHtml(p.phoneme) +
                                ' · ' +
                                pAcc +
                                '">' +
                                escapeHtml(p.phoneme) +
                                '<small>' +
                                pAcc +
                                '</small></span>'
                            );
                        })
                        .join('') +
                    '</div>';
            }
            let prosodyHtml = '';
            if (w.prosodyIssues && w.prosodyIssues.length) {
                prosodyHtml = '<div class="pa-prosody-line">' + escapeHtml(w.prosodyIssues.join(' · ')) + '</div>';
            }
            let stressSnippet = '';
            if (typeof global.renderStressSnippet === 'function') {
                stressSnippet = global.renderStressSnippet(w.word);
            }
            return (
                '<div class="pa-word-card ' +
                meta.cls +
                '">' +
                '<div class="pa-word-top">' +
                '<span class="pa-word-name">' +
                escapeHtml(w.word) +
                '</span>' +
                '<span class="pa-word-score' +
                (scoreLow ? ' pa-word-score-low' : '') +
                '">' +
                acc +
                '점</span>' +
                speakBtn +
                '</div>' +
                '<div class="pa-word-meta">' +
                '<span class="pa-word-badge">' +
                escapeHtml(meta.label) +
                '</span>' +
                (time ? '<span class="pa-word-time">' + escapeHtml(time) + '</span>' : '') +
                '</div>' +
                stressSnippet +
                prosodyHtml +
                phonHtml +
                '</div>'
            );
        }).join('');
        const more =
            issueWords.length > 9
                ? '<p class="pa-issue-more">+' + (issueWords.length - 9) + '개 — 카드에서 🔊 발음 버튼 사용</p>'
                : '';
        return '<div class="pa-issue-list">' + cards + more + '</div>';
    }

    /** 점수 막대·상세 헤더 없음. 오류 단어만 목록(스크롤 없음). */
    function buildHtml(detail) {
        if (!detail || !detail.words.length) return '';

        const issueWords = detail.issueWords || getIssueWords(detail.words);
        let html = '<div class="pa-viz">';

        if (issueWords.length) {
            html +=
                '<div class="pa-issues-block">' +
                '<div class="pa-issue-title">발음 오류 ' +
                issueWords.length +
                '개<span class="pa-issue-hint">숫자 키 1~9 = 🔊 발음 듣기 · Enter = 전체 다시 말하기</span></div>' +
                buildIssueWordCards(issueWords) +
                '</div>';
        }

        html += buildTimeline(detail.words, detail.totalDurationMs);
        html += '</div>';
        return html;
    }

    global.PronunciationViz = {
        parseFromPa: parseFromPa,
        buildHtml: buildHtml,
        getIssueWords: getIssueWords,
        getIssueWordKeys: function (detail) {
            if (!detail) return [];
            const list = detail.issueWords || getIssueWords(detail.words || []);
            return list.slice(0, 9).map(function (w) {
                return String(w.word || '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, '');
            }).filter(Boolean);
        },
        isIgnoredProsodyLint: isIgnoredProsodyLint,
        displayErrorType: displayErrorType,
        ERROR_LABELS: ERROR_LABELS,
    };
})(window);
