/**
 * 2단계: Azure Short Audio REST (speech-server 프록시)
 * 3~6단계: 브라우저 STT (이 모듈 미사용)
 */
(function (global) {
    const settings = () => global.INTERVIEW_SETTINGS || {};

    let ready = false;
    let lastInitHint = '';

    async function initAzureSpeech() {
        ready = false;
        lastInitHint = '';
        if (!settings().useAzurePronunciation) {
            lastInitHint = 'disabled';
            return false;
        }
        try {
            const healthUrl = settings().healthUrl || '/api/health';
            const res = await fetch(healthUrl);
            if (!res.ok) throw new Error('health_' + res.status);
            ready = true;
            lastInitHint = 'ok';
        } catch (e) {
            console.warn('Azure Speech init failed', e);
            ready = false;
            const msg = String(e.message || e);
            if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
                lastInitHint = 'no_server';
            } else {
                lastInitHint = 'unknown';
            }
        }
        return ready;
    }

    function getAzureStatusMessage() {
        if (lastInitHint === 'ok' || ready) return 'Azure Short Audio 발음·운율 평가 연결됨';
        if (lastInitHint === 'disabled') return '브라우저 단어 매칭 모드';
        if (lastInitHint === 'no_server') {
            if (location.protocol === 'file:') {
                return 'file:// 로는 불가 — npm start 후 http://localhost:3001/index.html';
            }
            return '토큰 서버 없음 — Node 서버 필요 (로컬: npm start / 배포: Render)';
        }
        return 'Azure 미연결 — speech-server 확인';
    }

    function isAzureReady() {
        return !!settings().useAzurePronunciation && ready;
    }

    function shouldUseAzureForPhase(phase) {
        return isAzureReady() && phase === 2;
    }

    function buildDetailFromAssessment(parsed) {
        if (!parsed || !parsed.ok) return null;
        const mockPa = {
            accuracyScore: parsed.accuracyScore,
            fluencyScore: parsed.fluencyScore,
            completenessScore: parsed.completenessScore,
            prosodyScore: parsed.prosodyScore,
            pronunciationScore: parsed.pronunciationScore,
            detailResult: {
                Words: (parsed.words || []).map(function (w) {
                    return {
                        Word: w.word,
                        Offset: w.offset,
                        Duration: w.duration,
                        AccuracyScore: w.accuracyScore,
                        ErrorType: w.errorType,
                        Phonemes: w.phonemes,
                        Syllables: w.syllables,
                    };
                }),
            },
        };
        if (typeof global.PronunciationViz !== 'undefined') {
            return global.PronunciationViz.parseFromPa(mockPa, null);
        }
        return null;
    }

    async function assessWavBlob(wavBlob, referenceText) {
        const url = settings().pronounceAssessUrl || '/api/pronounce-assess';
        const ref = (referenceText || '').replace(/\s+/g, ' ').trim();
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'audio/wav',
                'X-Reference-Text': encodeURIComponent(ref),
            },
            body: wavBlob,
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.message || data.error || 'assess_failed');
        }
        return {
            text: data.text || '',
            accuracyScore: data.accuracyScore || 0,
            fluencyScore: data.fluencyScore || 0,
            completenessScore: data.completenessScore || 0,
            prosodyScore: data.prosodyScore != null ? data.prosodyScore : null,
            pronunciationScore: data.pronunciationScore != null ? data.pronunciationScore : null,
            words: data.words || [],
            detail: buildDetailFromAssessment(data),
        };
    }

    function getWeakWords(assessmentWords) {
        if (!assessmentWords || !assessmentWords.length) return [];
        const weak = [];
        assessmentWords.forEach(function (w) {
            const word = (w.word || w.Word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!word || word.length < 2) return;
            const err = w.errorType || w.ErrorType || 'None';
            const acc =
                w.accuracyScore != null
                    ? w.accuracyScore
                    : w.AccuracyScore != null
                      ? w.AccuracyScore
                      : 100;
            if (err !== 'None' || acc < 60) weak.push(word);
        });
        return [...new Set(weak)];
    }

    global.AzureSpeech = {
        initAzureSpeech: initAzureSpeech,
        isAzureReady: isAzureReady,
        shouldUseAzureForPhase: shouldUseAzureForPhase,
        assessWavBlob: assessWavBlob,
        getWeakWords: getWeakWords,
        getAzureStatusMessage: getAzureStatusMessage,
    };
})(window);
