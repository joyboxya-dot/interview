/**
 * manifest + 주제별 JSON (/content/topics/topic-XX.json)
 */
(function (global) {
    const MANIFEST_URL_KEY = 'interviewContentManifestUrl';
    const VERSION_KEY = 'interviewContentVersion';
    const UPLOAD_KEY = 'interviewContentUploadPack';

    let topics = [];
    let manifest = null;
    let loadError = null;
    let lastServerTopics = [];

    function settings() {
        return global.INTERVIEW_SETTINGS || {};
    }

    function defaultManifestUrl() {
        return settings().contentManifestUrl || '/content/manifest.json';
    }

    function normalizeTopic(raw, index) {
        if (global.TopicStore && global.TopicStore.normalizeTopic) {
            return global.TopicStore.normalizeTopic(raw, index);
        }
        const t = Object.assign({}, raw);
        t.id = t.id || 'topic-' + String(index).padStart(2, '0');
        t.sentences = (t.sentences || []).map(function (s) {
            if (Array.isArray(s)) return s;
            return [s.ko, s.en];
        });
        return t;
    }

    function finalizeTopics(serverList) {
        lastServerTopics = serverList.slice();
        if (global.TopicStore && global.TopicStore.mergeWithServer) {
            topics = global.TopicStore.mergeWithServer(serverList);
        } else {
            topics = serverList.map(normalizeTopic);
        }
        return topics;
    }

    function applyPack(pack) {
        if (!pack || !Array.isArray(pack.topics)) throw new Error('invalid_pack');
        const serverList = pack.topics.map(normalizeTopic);
        if (pack.version != null) {
            localStorage.setItem(VERSION_KEY, String(pack.version));
        }
        loadError = null;
        return finalizeTopics(serverList);
    }

    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('fetch_' + res.status);
        return res.json();
    }

    async function loadTopicsFromManifest(m) {
        manifest = m;
        if (m.topicIds && Array.isArray(m.topicIds) && m.topicIds.length) {
            const base = m.topicsBase || '/content/topics/';
            const loaded = await Promise.all(
                m.topicIds.map(function (id) {
                    const url = base + (id.endsWith('.json') ? id : id + '.json');
                    return fetchJson(url).then(function (raw) {
                        if (!raw.id) raw.id = id.replace(/\.json$/, '');
                        return normalizeTopic(raw);
                    });
                })
            );
            return loaded;
        }
        if (m.packUrl || m.pack) {
            const packUrl = m.packUrl || m.pack || '/content/pack.json';
            const pack = await fetchJson(packUrl);
            return pack.topics.map(normalizeTopic);
        }
        throw new Error('manifest_no_topics');
    }

    async function loadFromManifestUrl(url) {
        manifest = await fetchJson(url);
        const serverList = await loadTopicsFromManifest(manifest);
        localStorage.setItem(MANIFEST_URL_KEY, url);
        if (manifest.contentVersion != null) {
            localStorage.setItem(VERSION_KEY, String(manifest.contentVersion));
        }
        loadError = null;
        return finalizeTopics(serverList);
    }

    function loadFromUploadPack() {
        const raw = localStorage.getItem(UPLOAD_KEY);
        if (!raw) return null;
        const pack = JSON.parse(raw);
        return applyPack(pack);
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
            return applyPack(options.inlinePack);
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
                return applyPack(global.EMBEDDED_TOPIC_PACK);
            }
            throw e;
        }
    }

    function getTopics() {
        return topics;
    }

    function getServerTopics() {
        return lastServerTopics;
    }

    function getManifest() {
        return manifest;
    }

    function getLoadError() {
        return loadError;
    }

    function refreshMergedTopics() {
        return finalizeTopics(lastServerTopics);
    }

    global.ContentLoader = {
        loadContent: loadContent,
        getTopics: getTopics,
        getServerTopics: getServerTopics,
        getManifest: getManifest,
        getLoadError: getLoadError,
        saveUploadPack: saveUploadPack,
        clearUploadPack: clearUploadPack,
        loadFromUploadPack: loadFromUploadPack,
        refreshMergedTopics: refreshMergedTopics,
    };
})(window);
