/**
 * manifest + pack.json 로드 (재배포 없이 스크립트 추가)
 */
(function (global) {
    const MANIFEST_URL_KEY = 'interviewContentManifestUrl';
    const VERSION_KEY = 'interviewContentVersion';
    const UPLOAD_KEY = 'interviewContentUploadPack';

    let topics = [];
    let manifest = null;
    let loadError = null;

    function settings() {
        return global.INTERVIEW_SETTINGS || {};
    }

    function defaultManifestUrl() {
        return settings().contentManifestUrl || '/content/manifest.json';
    }

    function normalizeTopic(raw, index) {
        const t = Object.assign({}, raw);
        t.id = t.id || 'topic-' + String(index).padStart(2, '0');
        t.sentences = (t.sentences || []).map(function (s) {
            if (Array.isArray(s)) return s;
            return [s.ko, s.en];
        });
        return t;
    }

    function applyPack(pack) {
        if (!pack || !Array.isArray(pack.topics)) throw new Error('invalid_pack');
        topics = pack.topics.map(normalizeTopic);
        if (pack.version != null) {
            localStorage.setItem(VERSION_KEY, String(pack.version));
        }
        return topics;
    }

    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('fetch_' + res.status);
        return res.json();
    }

    async function loadFromManifestUrl(url) {
        manifest = await fetchJson(url);
        const packUrl = manifest.packUrl || manifest.pack || '/content/pack.json';
        const pack = await fetchJson(packUrl);
        applyPack(pack);
        localStorage.setItem(MANIFEST_URL_KEY, url);
        loadError = null;
        return topics;
    }

    function loadFromUploadPack() {
        const raw = localStorage.getItem(UPLOAD_KEY);
        if (!raw) return null;
        const pack = JSON.parse(raw);
        applyPack(pack);
        loadError = null;
        return topics;
    }

    function saveUploadPack(pack) {
        localStorage.setItem(UPLOAD_KEY, JSON.stringify(pack));
        return applyPack(pack);
    }

    function clearUploadPack() {
        localStorage.removeItem(UPLOAD_KEY);
    }

    async function loadContent(options) {
        options = options || {};
        if (options.inlinePack) {
            applyPack(options.inlinePack);
            return topics;
        }
        if (options.useUpload) {
            const up = loadFromUploadPack();
            if (up) return up;
        }
        const url = options.manifestUrl || defaultManifestUrl();
        try {
            return await loadFromManifestUrl(url);
        } catch (e) {
            loadError = e;
            if (typeof global.EMBEDDED_TOPIC_PACK !== 'undefined' && global.EMBEDDED_TOPIC_PACK.topics) {
                applyPack(global.EMBEDDED_TOPIC_PACK);
                return topics;
            }
            throw e;
        }
    }

    function getTopics() {
        return topics;
    }

    function getManifest() {
        return manifest;
    }

    function getLoadError() {
        return loadError;
    }

    global.ContentLoader = {
        loadContent: loadContent,
        getTopics: getTopics,
        getManifest: getManifest,
        getLoadError: getLoadError,
        saveUploadPack: saveUploadPack,
        clearUploadPack: clearUploadPack,
        loadFromUploadPack: loadFromUploadPack,
    };
})(window);
