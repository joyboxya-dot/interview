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
        paConfig.enableProsodyAssessment = true;

        const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
        const rec = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
        paConfig.applyTo(rec);

        lastRecognizedText = '';
        lastAssessment = null;

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

    async function initAzureSpeech() {
        ready = false;
        if (!settings().useAzurePronunciation) return false;
        if (typeof SpeechSDK === 'undefined') return false;
        try {
            await fetchToken();
            ready = true;
        } catch (e) {
            console.warn('Azure Speech init failed', e);
            ready = false;
        }
        return ready;
    }

    function isAzureReady() {
        return (
            !!settings().useAzurePronunciation &&
            ready &&
            typeof SpeechSDK !== 'undefined'
        );
    }

    function shouldUseAzureForPhase(phase) {
        return isAzureReady() && phase >= 2;
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
                    resolve({
                        text: lastRecognizedText || '',
                        accuracyScore: pa ? pa.accuracyScore : 0,
                        fluencyScore: pa ? pa.fluencyScore : 0,
                        completenessScore: pa ? pa.completenessScore : 0,
                        prosodyScore: pa.prosodyScore != null ? pa.prosodyScore : null,
                        words: pa && pa.words ? pa.words : [],
                    });
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
            const word = (w.word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!word || word.length < 2) return;
            const err = w.errorType || 'None';
            const acc = w.accuracyScore != null ? w.accuracyScore : 100;
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
    };
})(window);
