/**
 * Azure Neural TTS — 서버 디스크 캐시 + 브라우저 IndexedDB (문구·프로필당 1회 합성)
 */
(function (global) {
    const settings = () => global.INTERVIEW_SETTINGS || {};
    const TTS_IDB = 'interviewTtsCache';
    const TTS_STORE = 'clips';

    let ready = false;

    function cacheId(text, lang, profile) {
        return profile + '|' + lang + '|' + text;
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

    function practicePlaybackRate() {
        const r = settings().ttsPracticePlaybackRate;
        return typeof r === 'number' && r > 0 && r <= 1.5 ? r : 0.7;
    }

    async function fetchMp3FromServer(text, lang, profile) {
        const url = settings().ttsUrl || '/api/tts';
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify({ text: text, lang: lang, profile: profile }),
        });
        if (!res.ok) {
            const err = await res.json().catch(function () {
                return { detail: res.statusText };
            });
            throw new Error(err.error || err.detail || 'tts_failed');
        }
        return res.blob();
    }

    async function getCachedMp3Blob(text, lang, profile) {
        const id = cacheId(text, lang, profile);
        let blob = await idbGetTts(id);
        if (blob && blob.size) return blob;
        blob = await fetchMp3FromServer(text, lang, profile);
        if (blob && blob.size) await idbPutTts(id, blob);
        return blob;
    }

    function cancelPlayback() {
        if (typeof global.stopAllPlayback === 'function') {
            global.stopAllPlayback();
        } else if (global.speechSynthesis) {
            global.speechSynthesis.cancel();
        }
    }

    async function playMp3Blob(blob, playbackRate, callback) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = playbackRate || 1;
        audio.onended = function () {
            URL.revokeObjectURL(url);
            if (callback) callback();
        };
        audio.onerror = function () {
            URL.revokeObjectURL(url);
            if (callback) callback();
        };
        await audio.play();
        return audio;
    }

    /**
     * 안내·모범 발음 — 여성 Neural, 강세·운율 강조 (newscast-formal)
     */
    async function speak(text, lang, callback) {
        const safe = String(text || '').trim();
        if (!safe) {
            if (callback) callback();
            return;
        }
        if (!isTtsReady()) {
            return speakBrowserFallback(safe, lang, callback, false);
        }
        try {
            cancelPlayback();
            const blob = await getCachedMp3Blob(safe, lang === 'ko' ? 'ko' : 'en', 'normal');
            await playMp3Blob(blob, 1, callback);
        } catch (e) {
            console.warn('Azure TTS speak failed', e);
            speakBrowserFallback(safe, lang, callback, false);
        }
    }

    /**
     * 틀린 단어 교정용 — 과장 합성(shouting) + 재생 0.7배속
     */
    async function speakPractice(word, callback) {
        const safe = String(word || '').trim();
        if (!safe) {
            if (callback) callback();
            return;
        }
        const rate = practicePlaybackRate();
        if (!isTtsReady()) {
            return speakBrowserFallback(safe, 'en', callback, true);
        }
        try {
            cancelPlayback();
            const blob = await getCachedMp3Blob(safe, 'en', 'practice');
            await playMp3Blob(blob, rate, callback);
        } catch (e) {
            console.warn('Azure TTS practice failed', e);
            speakBrowserFallback(safe, 'en', callback, true);
        }
    }

    function speakBrowserFallback(text, lang, callback, exaggerated) {
        if (typeof global.speakTextBrowser === 'function') {
            global.speakTextBrowser(text, lang, callback, exaggerated);
        } else if (callback) {
            callback();
        }
    }

    global.AzureTts = {
        initAzureTts: initAzureTts,
        isTtsReady: isTtsReady,
        speak: speak,
        speakPractice: speakPractice,
        practicePlaybackRate: practicePlaybackRate,
    };
})(window);
