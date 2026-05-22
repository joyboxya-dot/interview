/**
 * Azure Speech 발음 평가 (브라우저)
 * 키는 넣지 않음 → speech-server 가 토큰 발급
 */
(function (global) {
    const settings = () => global.INTERVIEW_SETTINGS || {};

    let ready = false;
    let token = '';
    let region = 'eastus';
    let tokenFetchedAt = 0;
    let recognizer = null;
    let azureRecording = false;
    let lastRecognizedText = '';
    let lastAssessment = null;
    let lastRawJson = '';
    let lastInitHint = '';

    async function fetchToken() {
        const url = settings().tokenUrl || '/api/speech-token';
        const res = await fetch(url);
        if (!res.ok) throw new Error('token_http_' + res.status);
        const data = await res.json();
        token = data.token;
        region = data.region || region;
        tokenFetchedAt = Date.now();
        return data;
    }

    async function ensureToken() {
        if (token && Date.now() - tokenFetchedAt < 9 * 60 * 1000) return;
        await fetchToken();
    }

    function disposeRecognizer() {
        if (!recognizer) return;
        try {
            recognizer.close();
        } catch (e) {}
        recognizer = null;
    }

    function extractJsonFromResult(result) {
        if (!result || !result.properties || typeof SpeechSDK === 'undefined') return '';
        try {
            return (
                result.properties.getProperty(
                    SpeechSDK.PropertyId.SpeechServiceResponse_JsonResult
                ) || ''
            );
        } catch (e) {
            return '';
        }
    }

    function buildRecognizer(referenceText) {
        if (typeof SpeechSDK === 'undefined') throw new Error('SpeechSDK not loaded');
        disposeRecognizer();

        const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
        speechConfig.speechRecognitionLanguage = 'en-US';

        const ref = (referenceText || '').replace(/\s+/g, ' ').trim();
        const paConfig = new SpeechSDK.PronunciationAssessmentConfig(
            ref,
            SpeechSDK.PronunciationAssessmentGradingSystem.HundredMark,
            SpeechSDK.PronunciationAssessmentGranularity.Phoneme,
            true
        );
        paConfig.enableMiscue = true;
        paConfig.enableProsodyAssessment = true;

        const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
        const rec = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
        paConfig.applyTo(rec);

        lastRecognizedText = '';
        lastAssessment = null;
        lastRawJson = '';

        rec.recognizing = function (_s, e) {
            const t = e.result && e.result.text;
            if (t && typeof global.onAzureInterim === 'function') {
                global.onAzureInterim(t);
            }
        };

        rec.recognized = function (_s, e) {
            if (
                e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech &&
                e.result.text
            ) {
                lastRecognizedText = e.result.text;
                lastRawJson = extractJsonFromResult(e.result);
                try {
                    lastAssessment = SpeechSDK.PronunciationAssessmentResult.fromResult(
                        e.result
                    );
                } catch (err) {
                    console.warn('PronunciationAssessmentResult', err);
                }
            }
        };

        rec.canceled = function (_s, e) {
            console.warn('Azure canceled', e.errorDetails || e.reason);
        };

        recognizer = rec;
        return rec;
    }

    function buildAssessmentPayload(pa) {
        const detail =
            typeof global.PronunciationViz !== 'undefined'
                ? global.PronunciationViz.parseFromPa(pa, lastRawJson)
                : null;

        return {
            text: lastRecognizedText || '',
            accuracyScore: pa ? pa.accuracyScore : 0,
            fluencyScore: pa ? pa.fluencyScore : 0,
            completenessScore: pa ? pa.completenessScore : 0,
            prosodyScore: pa && pa.prosodyScore != null ? pa.prosodyScore : null,
            pronunciationScore:
                pa && pa.pronunciationScore != null ? pa.pronunciationScore : null,
            words: pa && pa.words ? pa.words : [],
            detail: detail,
        };
    }

    async function initAzureSpeech() {
        ready = false;
        lastInitHint = '';
        if (!settings().useAzurePronunciation) {
            lastInitHint = 'disabled';
            return false;
        }
        if (typeof SpeechSDK === 'undefined') {
            lastInitHint = 'sdk';
            return false;
        }
        try {
            await fetchToken();
            ready = true;
            lastInitHint = 'ok';
        } catch (e) {
            console.warn('Azure Speech init failed', e);
            ready = false;
            const msg = String(e.message || e);
            if (msg.includes('token_http_401') || msg.includes('token_http_403')) {
                lastInitHint = 'bad_key';
            } else if (msg.includes('token_http_')) {
                lastInitHint = 'token_api';
            } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
                lastInitHint = 'no_server';
            } else {
                lastInitHint = 'unknown';
            }
        }
        return ready;
    }

    function getAzureStatusMessage() {
        if (lastInitHint === 'ok' || ready) return 'Azure 발음·운율 평가 연결됨';
        if (lastInitHint === 'disabled') return '브라우저 단어 매칭 모드';
        if (lastInitHint === 'sdk') return 'Azure SDK 로드 실패 — 새로고침';
        if (lastInitHint === 'bad_key') {
            return 'Azure 키 오류 — speech-server/.env 또는 배포 환경변수 확인';
        }
        if (lastInitHint === 'token_api') {
            return '토큰 API 오류 — 서버 로그·SPEECH_REGION 확인';
        }
        if (lastInitHint === 'no_server') {
            if (location.protocol === 'file:') {
                return 'file:// 로는 불가 — 터미널 npm start 후 http://localhost:3001/index.html';
            }
            return '토큰 서버 없음 — Node 서버 필요 (로컬: npm start / 배포: Render 등 + 환경변수)';
        }
        return 'Azure 미연결 — npm start 또는 배포 서버 확인';
    }

    function isAzureReady() {
        return (
            !!settings().useAzurePronunciation &&
            ready &&
            typeof SpeechSDK !== 'undefined'
        );
    }

    function shouldUseAzureForPhase(phase) {
        return isAzureReady() && phase === 2;
    }

    async function startAzureRecording(referenceText) {
        await ensureToken();
        buildRecognizer(referenceText);
        azureRecording = true;
        return new Promise(function (resolve, reject) {
            recognizer.startContinuousRecognitionAsync(resolve, reject);
        });
    }

    function stopAzureRecording() {
        return new Promise(function (resolve) {
            if (!recognizer || !azureRecording) {
                resolve(null);
                return;
            }
            azureRecording = false;
            recognizer.stopContinuousRecognitionAsync(
                function () {
                    const pa = lastAssessment;
                    const payload = pa ? buildAssessmentPayload(pa) : null;
                    resolve(payload);
                    disposeRecognizer();
                },
                function (err) {
                    console.warn('stopContinuousRecognition', err);
                    resolve(null);
                    disposeRecognizer();
                }
            );
        });
    }

    function stopIfActive() {
        if (!recognizer || !azureRecording) {
            disposeRecognizer();
            return Promise.resolve(null);
        }
        return stopAzureRecording();
    }

    function getWeakWords(assessmentWords) {
        if (!assessmentWords || !assessmentWords.length) return [];
        const weak = [];
        assessmentWords.forEach(function (w) {
            const word = (w.word || w.Word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!word || word.length < 2) return;
            const paW = w.PronunciationAssessment || w.pronunciationAssessment || {};
            const err = w.errorType || paW.ErrorType || 'None';
            const acc =
                w.accuracyScore != null
                    ? w.accuracyScore
                    : paW.AccuracyScore != null
                      ? paW.AccuracyScore
                      : 100;
            if (err !== 'None' || acc < 60) weak.push(word);
        });
        return [...new Set(weak)];
    }

    global.AzureSpeech = {
        initAzureSpeech: initAzureSpeech,
        isAzureReady: isAzureReady,
        shouldUseAzureForPhase: shouldUseAzureForPhase,
        startAzureRecording: startAzureRecording,
        stopAzureRecording: stopAzureRecording,
        stopIfActive: stopIfActive,
        getWeakWords: getWeakWords,
        getAzureStatusMessage: getAzureStatusMessage,
    };
})(window);
