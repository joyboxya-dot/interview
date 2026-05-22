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
                return 'file:// 로는 불가 — 서버 주소로 열기 (로컬: localhost:3001 / 배포: Render URL)';
            }
            return '서버 미연결 — 로컬 npm start 또는 Render 배포 URL로 접속';
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

    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () {
                const dataUrl = reader.result || '';
                const comma = String(dataUrl).indexOf(',');
                resolve(comma >= 0 ? String(dataUrl).slice(comma + 1) : '');
            };
            reader.onerror = function () {
                reject(new Error('audio_read_failed'));
            };
            reader.readAsDataURL(blob);
        });
    }

    async function assessWavBlob(wavBlob, referenceText) {
        const url = settings().pronounceAssessUrl || '/api/pronounce-assess';
        const ref = (referenceText || '').replace(/\s+/g, ' ').trim();
        if (!ref) throw new Error('missing_reference_text');
        const audioBase64 = await blobToBase64(wavBlob);
        if (!audioBase64) throw new Error('missing_audio');
        const controller = new AbortController();
        const timer = setTimeout(function () {
            controller.abort();
        }, 90000);
        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-Reference-Text': encodeURIComponent(ref),
                },
                body: JSON.stringify({ referenceText: ref, audioBase64: audioBase64 }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
        let data;
        try {
            data = await res.json();
        } catch (e) {
            if (e && e.name === 'AbortError') throw new Error('assess_timeout');
            throw new Error('assess_bad_response');
        }
        if (!res.ok || !data.ok) {
            const parts = [data.error || data.message || 'assess_failed'];
            if (data.detail) parts.push(String(data.detail).slice(0, 200));
            throw new Error(parts.join(': '));
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
