/**
 * Azure 발음 평가 상세 파싱 + 시각화 HTML (운율·음소·타임라인)
 */
(function (global) {
    const PROSODY_CONF_THRESHOLD = 0.75;

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
            accuracyScore: pa.AccuracyScore != null ? pa.AccuracyScore : p.AccuracyScore != null ? p.AccuracyScore : p.accuracyScore,
            offsetMs: ticksToMs(p.Offset != null ? p.Offset : p.offset),
            durationMs: ticksToMs(p.Duration != null ? p.Duration : p.duration),
        };
    }

    function normalizeSyllable(s) {
        const pa = s.PronunciationAssessment || s.pronunciationAssessment || {};
        return {
            syllable: s.Syllable || s.syllable || '',
            accuracyScore: pa.AccuracyScore != null ? pa.AccuracyScore : s.AccuracyScore != null ? s.AccuracyScore : s.accuracyScore,
            offsetMs: ticksToMs(s.Offset != null ? s.Offset : s.offset),
            durationMs: ticksToMs(s.Duration != null ? s.Duration : s.duration),
        };
    }

    function collectProsodyIssues(prosody) {
        const issues = [];
        if (!prosody) return issues;
        const br = prosody.Break;
        if (br) {
            const ub = br.UnexpectedBreak && br.UnexpectedBreak.Confidence;
            if (ub != null && ub > PROSODY_CONF_THRESHOLD) issues.push('부적절한 멈춤');
            const mb = br.MissingBreak && br.MissingBreak.Confidence;
            if (mb != null && mb > PROSODY_CONF_THRESHOLD) issues.push('멈춤 누락');
            if (br.ErrorTypes && br.ErrorTypes.length) {
                br.ErrorTypes.forEach(function (et) {
                    if (et && et !== 'None' && ERROR_LABELS[et]) issues.push(ERROR_LABELS[et].label);
                });
            }
        }
        const inton = prosody.Intonation;
        if (inton) {
            if (inton.ErrorTypes && inton.ErrorTypes.indexOf('Monotone') >= 0) issues.push('단조로움');
            const mono = inton.Monotone && inton.Monotone.Confidence;
            if (mono != null && mono > PROSODY_CONF_THRESHOLD) issues.push('단조로움');
        }
        return [...new Set(issues)];
    }

    function mergeProsodyErrorType(errorType, prosodyIssues) {
        if (errorType && errorType !== 'None') return errorType;
        if (!prosodyIssues.length) return errorType || 'None';
        if (prosodyIssues.indexOf('부적절한 멈춤') >= 0) return 'UnexpectedBreak';
        if (prosodyIssues.indexOf('멈춤 누락') >= 0) return 'MissingBreak';
        if (prosodyIssues.indexOf('단조로움') >= 0) return 'Monotone';
        return errorType || 'None';
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
            errorType: errorType,
            offsetMs: ticksToMs(w.Offset != null ? w.Offset : w.offset),
            durationMs: ticksToMs(w.Duration != null ? w.Duration : w.duration),
            phonemes: (w.Phonemes || w.phonemes || []).map(normalizePhoneme),
            syllables: (w.Syllables || w.syllables || []).map(normalizeSyllable),
            prosodyFeedback: prosody,
            prosodyIssues: prosodyIssues,
        };
    }

    function normalizeSdkWord(w) {
        const prosody = w.prosodyFeedback || null;
        const prosodyIssues = w.prosodyIssues || collectProsodyIssues(prosody);
        return {
            word: w.word || '',
            accuracyScore: w.accuracyScore,
            errorType: mergeProsodyErrorType(w.errorType || 'None', prosodyIssues),
            offsetMs: ticksToMs(w.offset),
            durationMs: ticksToMs(w.duration),
            phonemes: (w.phonemes || []).map(normalizePhoneme),
            syllables: (w.syllables || []).map(normalizeSyllable),
            prosodyFeedback: prosody,
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
            const et = w.errorType || 'None';
            return et !== 'None' || (w.prosodyIssues && w.prosodyIssues.length);
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

        const hasProsodyDetail = words.some(function (w) {
            return w.prosodyFeedback || (w.prosodyIssues && w.prosodyIssues.length);
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
            hasProsodyDetail: hasProsodyDetail,
        };
    }

    function scoreBar(label, value, need, accent) {
        const v = value != null ? Math.round(value) : 0;
        const n = need != null ? need : 0;
        const pct = Math.min(100, Math.max(0, v));
        const ok = value == null || v >= n;
        const cls = accent ? ' pa-bar-accent' : '';
        const fillCls = ok ? ' pa-bar-fill-ok' : ' pa-bar-fill-warn';
        const sub =
            need != null
                ? '<span class="pa-bar-need">' + v + ' / ' + n + '</span>'
                : '<span class="pa-bar-need">' + (value != null ? v : '—') + '</span>';
        return (
            '<div class="pa-score-row' + (accent ? ' pa-score-row-accent' : '') + '">' +
            '<span class="pa-score-label">' + escapeHtml(label) + '</span>' +
            '<div class="pa-bar' + cls + '"><div class="pa-bar-fill ' + fillCls + '" style="width:' + pct + '%"></div></div>' +
            sub +
            '</div>'
        );
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
            '<div class="pa-timeline-title">타임라인 (단어 위치 · 길이)</div>' +
            '<div class="pa-timeline-track">' +
            parts +
            '</div>' +
            '<div class="pa-timeline-axis">0s — ' +
            sec +
            's</div>' +
            '</div>'
        );
    }

    function buildProsodyLine(w) {
        if (!w.prosodyIssues || !w.prosodyIssues.length) return '';
        return '<div class="pa-prosody-line">' + escapeHtml(w.prosodyIssues.join(' · ')) + '</div>';
    }

    function buildWordCards(words) {
        if (!words.length) return '';
        const cards = words.map(function (w) {
            const meta = ERROR_LABELS[w.errorType] || ERROR_LABELS.None;
            const acc = w.accuracyScore != null ? Math.round(w.accuracyScore) : '—';
            const time = w.offsetMs != null ? '@' + (w.offsetMs / 1000).toFixed(1) + 's' : '';
            let phonHtml = '';
            if (w.phonemes && w.phonemes.length) {
                phonHtml =
                    '<div class="pa-phoneme-row">' +
                    w.phonemes
                        .map(function (p) {
                            const pAcc = p.accuracyScore != null ? Math.round(p.accuracyScore) : '';
                            const weak = pAcc !== '' && pAcc < 70;
                            return (
                                '<span class="pa-phoneme' +
                                (weak ? ' pa-phoneme-weak' : '') +
                                '" title="음소 ' +
                                escapeHtml(p.phoneme) +
                                (pAcc !== '' ? ' · ' + pAcc : '') +
                                '">' +
                                escapeHtml(p.phoneme) +
                                (pAcc !== '' ? '<small>' + pAcc + '</small>' : '') +
                                '</span>'
                            );
                        })
                        .join('') +
                    '</div>';
            }
            return (
                '<div class="pa-word-card ' +
                meta.cls +
                '">' +
                '<div class="pa-word-head">' +
                '<strong>' +
                escapeHtml(w.word) +
                '</strong>' +
                '<span class="pa-word-badge">' +
                escapeHtml(meta.label) +
                '</span>' +
                '<span class="pa-word-acc">' +
                acc +
                '</span>' +
                '<span class="pa-word-time">' +
                escapeHtml(time) +
                '</span>' +
                '</div>' +
                buildProsodyLine(w) +
                phonHtml +
                '</div>'
            );
        }).join('');
        return '<div class="pa-word-grid">' + cards + '</div>';
    }

    function buildErrorSummary(errorCounts) {
        const keys = Object.keys(errorCounts).filter(function (k) {
            return k !== 'None' && errorCounts[k] > 0;
        });
        if (!keys.length) {
            return '<div class="pa-error-summary pa-error-ok">오류 유형 없음 (오발음·생략·삽입·멈춤·운율)</div>';
        }
        const chips = keys
            .map(function (k) {
                const meta = ERROR_LABELS[k] || { label: k, cls: 'pa-err-mis' };
                return (
                    '<span class="pa-error-chip ' + meta.cls + '">' + escapeHtml(meta.label) + ' ×' + errorCounts[k] + '</span>'
                );
            })
            .join('');
        return '<div class="pa-error-summary">' + chips + '</div>';
    }

    function buildHtml(detail, thresholds) {
        if (!detail || !detail.words.length) return '';
        const th = thresholds || {};
        const needAcc = th.passAccuracy;
        const needFlu = th.passFluency;
        const needPro = th.passProsody;

        let html = '<div class="pa-viz">';
        html += '<div class="pa-viz-title">Azure 발음·운율 상세</div>';
        html +=
            '<p class="pa-viz-desc">운율(prosody): 강세 · 억양 · 말하기 속도 · 리듬 · 음소 단위 분석 · 오류 유형(오발음·생략·삽입·멈춤)</p>';

        html += '<div class="pa-score-grid">';
        html += scoreBar('정확도', detail.accuracyScore, needAcc, false);
        html += scoreBar('유창성', detail.fluencyScore, needFlu, false);
        html += scoreBar('완성도', detail.completenessScore, null, false);
        if (detail.prosodyScore != null) {
            html += scoreBar('운율', detail.prosodyScore, needPro, true);
        } else {
            html += '<p class="pa-viz-note">운율 점수 미수신 — en-US·EnableProsodyAssessment 확인</p>';
        }
        if (detail.pronunciationScore != null) {
            html += scoreBar('종합 발음', detail.pronunciationScore, null, false);
        }
        html += '</div>';

        html += buildErrorSummary(detail.errorCounts);
        html += buildTimeline(detail.words, detail.totalDurationMs);
        html +=
            '<div class="pa-legend">' +
            Object.keys(ERROR_LABELS)
                .filter(function (k) {
                    return k !== 'None';
                })
                .map(function (k) {
                    const m = ERROR_LABELS[k];
                    return '<span class="pa-legend-item"><i class="' + m.cls + '"></i>' + m.label + '</span>';
                })
                .join('') +
            '</div>';
        html += buildWordCards(detail.words);

        if (!detail.hasMiscue) {
            html +=
                '<p class="pa-viz-note">※ 짧은 녹음(Short Audio)에서는 생략·삽입 태그가 제한될 수 있습니다. 문장 끝까지 말하면 표시됩니다.</p>';
        }
        if (detail.prosodyScore != null && !detail.hasProsodyDetail) {
            html +=
                '<p class="pa-viz-note">※ 운율 총점은 있으나 단어별 멈춤·억양 세부가 비어 있을 수 있습니다. 다시 녹음하거나 Granularity를 확인하세요.</p>';
        }
        html += '</div>';
        return html;
    }

    global.PronunciationViz = {
        parseFromPa: parseFromPa,
        buildHtml: buildHtml,
        getIssueWords: getIssueWords,
        ERROR_LABELS: ERROR_LABELS,
    };
})(window);
