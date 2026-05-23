/**
 * Azure Neural TTS — 서버·IDB 캐시, 동시 재생 1개만 (겹침 방지)
 */
(function (global) {
    const settings = () => global.INTERVIEW_SETTINGS || {};
    const TTS_IDB = 'interviewTtsCache';
    const TTS_STORE = 'clips';

    let ready = false;
    let playSessionId = 0;
    let currentAudio = null;
    let currentObjectUrl = null;

    const TTS_CACHE_VERSION = 'v5-l2-playback-rate';

    function cacheId(text, lang, profile, playbackRate) {
        return TTS_CACHE_VERSION + '|' + profile + '|' + lang + '|' + playbackRate + '|' + text;
    }

    function openTtsDb() {
        return new Promise(function (resolve, reject) {
            const req = indexedDB.open(TTS_IDB, 1);
            req.onupgradeneeded = function (e) {
                e.target.result.createObjectStore(TTS_STORE);
            };
            req.onsuccess = function () {
                resolve(req.result);
            };
            req.onerror = function () {
                reject(req.error);
            };
        });
    }

    async function idbGetTts(key) {
        try {
            const db = await openTtsDb();
            return new Promise(function (resolve, reject) {
                const tx = db.transaction(TTS_STORE, 'readonly');
                const g = tx.objectStore(TTS_STORE).get(key);
                g.onsuccess = function () {
                    resolve(g.result || null);
                };
                g.onerror = function () {
                    reject(g.error);
                };
            });
        } catch (e) {
            return null;
        }
    }

    async function idbPutTts(key, blob) {
        try {
            const db = await openTtsDb();
            return new Promise(function (resolve, reject) {
                const tx = db.transaction(TTS_STORE, 'readwrite');
                tx.objectStore(TTS_STORE).put(blob, key);
                tx.oncomplete = function () {
                    resolve();
                };
                tx.onerror = function () {
                    reject(tx.error);
                };
            });
        } catch (e) {}
    }

    async function initAzureTts() {
        ready = false;
        if (settings().useAzureTts === false) return false;
        try {
            const healthUrl = settings().healthUrl || '/api/health';
            const res = await fetch(healthUrl);
            if (!res.ok) throw new Error('health_' + res.status);
            const data = await res.json();
            ready = !!(data.ok && data.tts !== false);
        } catch (e) {
            ready = false;
        }
        return ready;
    }

    function isTtsReady() {
        return settings().useAzureTts !== false && ready;
    }

    function normalPlaybackRate(lang) {
        if (lang === 'en' && typeof global.getModelEnglishTtsRate === 'function') {
            return global.getModelEnglishTtsRate();
        }
        if (typeof global.getSavedTtsNormalRate === 'function') return global.getSavedTtsNormalRate();
        const r = settings().ttsNormalPlaybackRate;
        return typeof r === 'number' && r > 0 && r <= 1.5 ? r : 0.82;
    }

    function practicePlaybackRate() {
        if (typeof global.getSavedTtsPracticeRate === 'function') return global.getSavedTtsPracticeRate();
        const r = settings().ttsPracticePlaybackRate;
        return typeof r === 'number' && r > 0 && r <= 1.5 ? r : 0.65;
    }

    /** 실제 오디오만 멈춤 (세션 ID는 유지) */
    function stopTtsAudioOnly() {
        if (currentAudio) {
            try {
                currentAudio.pause();
                currentAudio.currentTime = 0;
                currentAudio.removeAttribute('src');
                currentAudio.load();
            } catch (e) {}
            currentAudio.onended = null;
            currentAudio.onerror = null;
            currentAudio = null;
        }
        if (currentObjectUrl) {
            try {
                URL.revokeObjectURL(currentObjectUrl);
            } catch (e) {}
            currentObjectUrl = null;
        }
        if (global.speechSynthesis) {
            global.speechSynthesis.cancel();
        }
    }

    /** 새 재생 시작 — 이전 TTS·브라우저 음성 전부 끔 */
    function beginPlaySession() {
        playSessionId += 1;
        stopTtsAudioOnly();
        if (typeof global.clearMissedWordPlayTimers === 'function') {
            global.clearMissedWordPlayTimers();
        }
        return playSessionId;
    }

    function stopPlayback() {
        playSessionId += 1;
        stopTtsAudioOnly();
    }

    async function fetchMp3FromServer(text, lang, profile, playbackRate) {
        const url = settings().ttsUrl || '/api/tts';
        const body = { text: text, lang: lang, profile: profile };
        if (playbackRate != null) body.playbackRate = playbackRate;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json().catch(function () {
                return { detail: res.statusText };
            });
            throw new Error(err.error || err.detail || 'tts_failed');
        }
        return res.blob();
    }

    async function getCachedMp3Blob(text, lang, profile, playbackRate) {
        const id = cacheId(text, lang, profile, playbackRate);
        let blob = await idbGetTts(id);
        if (blob && blob.size) return blob;
        blob = await fetchMp3FromServer(text, lang, profile, playbackRate);
        if (blob && blob.size) await idbPutTts(id, blob);
        return blob;
    }

    function playMp3Blob(blob, playbackRate, callback, sessionId) {
        return new Promise(function (resolve) {
            if (sessionId !== playSessionId) {
                resolve();
                return;
            }
            stopTtsAudioOnly();

            const url = URL.createObjectURL(blob);
            currentObjectUrl = url;
            const audio = new Audio(url);
            currentAudio = audio;
            audio.playbackRate = playbackRate || 1;

            if (typeof global.registerActiveAudio === 'function') {
                global.registerActiveAudio(audio);
            }

            function finish() {
                if (currentAudio === audio) currentAudio = null;
                if (currentObjectUrl === url) {
                    URL.revokeObjectURL(url);
                    currentObjectUrl = null;
                }
                if (callback) callback();
                resolve();
            }

            audio.onended = finish;
            audio.onerror = finish;
            audio.play().catch(finish);
        });
    }

    async function speak(text, lang, callback) {
        const safe = String(text || '').trim();
        if (!safe) {
            if (callback) callback();
            return;
        }
        const sessionId = beginPlaySession();
        if (!isTtsReady()) {
            return speakBrowserFallback(safe, lang, callback, false, sessionId);
        }
        try {
            const langKey = lang === 'ko' ? 'ko' : 'en';
            const rate = normalPlaybackRate(langKey);
            const blob = await getCachedMp3Blob(safe, langKey, 'normal', rate);
            if (sessionId !== playSessionId) return;
            await playMp3Blob(blob, 1, callback, sessionId);
        } catch (e) {
            console.warn('Azure TTS speak failed', e);
            if (sessionId === playSessionId) {
                speakBrowserFallback(safe, lang, callback, false, sessionId);
            }
        }
    }

    async function speakPractice(word, callback) {
        const safe = String(word || '').trim();
        if (!safe) {
            if (callback) callback();
            return;
        }
        const sessionId = beginPlaySession();
        const rate = practicePlaybackRate();
        if (!isTtsReady()) {
            return speakBrowserFallback(safe, 'en', callback, true, sessionId);
        }
        try {
            const blob = await getCachedMp3Blob(safe, 'en', 'practice', rate);
            if (sessionId !== playSessionId) return;
            await playMp3Blob(blob, 1, callback, sessionId);
        } catch (e) {
            console.warn('Azure TTS practice failed', e);
            if (sessionId === playSessionId) {
                speakBrowserFallback(safe, 'en', callback, true, sessionId);
            }
        }
    }

    function speakBrowserFallback(text, lang, callback, exaggerated, sessionId) {
        if (sessionId != null && sessionId !== playSessionId) {
            if (callback) callback();
            return;
        }
        if (typeof global.speakTextBrowser === 'function') {
            global.speakTextBrowser(text, lang, callback, exaggerated);
        } else if (callback) {
            callback();
        }
    }

    async function getModelEnBlob(text) {
        const safe = String(text || '').trim();
        if (!safe) return null;
        const langKey = 'en';
        const rate = normalPlaybackRate(langKey);
        if (isTtsReady()) {
            return getCachedMp3Blob(safe, langKey, 'normal', rate);
        }
        return fetchMp3FromServer(safe, langKey, 'normal', rate);
    }

    global.AzureTts = {
        initAzureTts: initAzureTts,
        isTtsReady: isTtsReady,
        speak: speak,
        speakPractice: speakPractice,
        stopPlayback: stopPlayback,
        practicePlaybackRate: practicePlaybackRate,
        getModelEnBlob: getModelEnBlob,
    };
})(window);
