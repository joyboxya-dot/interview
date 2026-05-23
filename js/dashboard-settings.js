/**
 * 대시보드 설정 통합 저장 — 다시 열 때 마지막 값 복원
 */
(function (global) {
    const STORAGE_KEY = 'interviewDashboardSettingsV1';

    const DEFAULTS = {
        version: 1,
        difficultyId: 'strict',
        ttsNormalRate: 0.82,
        ttsPracticeRate: 0.82,
        l2PresetId: 'interview',
        masteryMode: true,
        contentSource: 'server',
        contentEditorJson: '',
    };

    let cached = null;

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function readRaw() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function mergeWithDefaults(partial) {
        const s = Object.assign(clone(DEFAULTS), partial || {});
        if (global.DIFFICULTY_PRESETS && !global.DIFFICULTY_PRESETS[s.difficultyId]) {
            s.difficultyId = DEFAULTS.difficultyId;
        }
        if (global.L2Fluency && global.L2Fluency.PRESETS && !global.L2Fluency.PRESETS[s.l2PresetId]) {
            s.l2PresetId = DEFAULTS.l2PresetId;
        }
        return s;
    }

    function buildFromLegacyStorages() {
        const s = clone(DEFAULTS);
        if (typeof global.getSavedDifficultyId === 'function') {
            s.difficultyId = global.getSavedDifficultyId();
        }
        if (typeof global.getSavedTtsNormalRate === 'function') {
            s.ttsNormalRate = global.getSavedTtsNormalRate();
            s.ttsPracticeRate = global.getSavedTtsPracticeRate();
        }
        if (global.L2Fluency && global.L2Fluency.getPresetId) {
            s.l2PresetId = global.L2Fluency.getPresetId();
        }
        if (global.MasteryEngine && global.MasteryEngine.isMasteryMode) {
            s.masteryMode = global.MasteryEngine.isMasteryMode();
        }
        if (global.ContentLoader && global.ContentLoader.loadFromUploadPack) {
            const up = global.ContentLoader.loadFromUploadPack();
            if (up && up.length) {
                s.contentSource = 'editor';
                try {
                    const raw = localStorage.getItem('interviewContentUploadPack');
                    if (raw) s.contentEditorJson = raw;
                } catch (e) {}
            }
        }
        return s;
    }

    function applyToLegacyStorages(s) {
        if (typeof global.setSavedDifficultyId === 'function') {
            global.setSavedDifficultyId(s.difficultyId);
        }
        if (typeof global.setSavedTtsNormalRate === 'function') {
            global.setSavedTtsNormalRate(s.ttsNormalRate);
            global.setSavedTtsPracticeRate(s.ttsPracticeRate);
        }
        if (global.L2Fluency && global.L2Fluency.setPresetId) {
            global.L2Fluency.setPresetId(s.l2PresetId);
        }
        if (global.MasteryEngine && global.MasteryEngine.setMasteryMode) {
            global.MasteryEngine.setMasteryMode(!!s.masteryMode);
        }
        if (s.contentSource === 'editor' && s.contentEditorJson && global.ContentLoader) {
            try {
                const pack = JSON.parse(s.contentEditorJson);
                global.ContentLoader.saveUploadPack(pack);
            } catch (e) {}
        }
    }

    function get() {
        if (!cached) {
            const raw = readRaw();
            cached = raw ? mergeWithDefaults(raw) : mergeWithDefaults(buildFromLegacyStorages());
        }
        return cached;
    }

    function save(partial) {
        cached = mergeWithDefaults(Object.assign(get(), partial || {}));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
        applyToLegacyStorages(cached);
        return cached;
    }

    function loadAndApply() {
        const raw = readRaw();
        if (raw) {
            cached = mergeWithDefaults(raw);
            applyToLegacyStorages(cached);
        } else {
            cached = mergeWithDefaults(buildFromLegacyStorages());
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
            applyToLegacyStorages(cached);
        }
        return get();
    }

    function captureFromUI() {
        const patch = {};
        const diffActive = document.querySelector('#difficulty-options .difficulty-btn.active');
        if (diffActive && diffActive.dataset && diffActive.dataset.id) {
            patch.difficultyId = diffActive.dataset.id;
        } else if (typeof global.getSavedDifficultyId === 'function') {
            patch.difficultyId = global.getSavedDifficultyId();
        }

        const selNormal = document.getElementById('tts-speed-normal');
        const selPractice = document.getElementById('tts-speed-practice');
        if (selNormal) patch.ttsNormalRate = parseFloat(selNormal.value);
        if (selPractice) patch.ttsPracticeRate = parseFloat(selPractice.value);

        const l2 = document.getElementById('l2-speed-preset');
        if (l2) patch.l2PresetId = l2.value;

        const mastery = document.getElementById('mastery-mode-check');
        if (mastery) patch.masteryMode = mastery.checked;

        const editor = document.getElementById('content-pack-editor');
        const srcEditor = document.getElementById('content-source-editor');
        const srcServer = document.getElementById('content-source-server');
        if (srcEditor && srcEditor.checked) patch.contentSource = 'editor';
        else if (srcServer && srcServer.checked) patch.contentSource = 'server';
        if (editor) patch.contentEditorJson = editor.value;

        return save(patch);
    }

    function applyToUI() {
        const s = get();
        const editor = document.getElementById('content-pack-editor');
        const srcEditor = document.getElementById('content-source-editor');
        const srcServer = document.getElementById('content-source-server');
        if (editor && s.contentEditorJson) editor.value = s.contentEditorJson;
        if (srcEditor && srcServer) {
            srcEditor.checked = s.contentSource === 'editor';
            srcServer.checked = s.contentSource !== 'editor';
        }
        const l2 = document.getElementById('l2-speed-preset');
        if (l2 && l2.options.length) l2.value = s.l2PresetId;
        const mastery = document.getElementById('mastery-mode-check');
        if (mastery) mastery.checked = !!s.masteryMode;
        return s;
    }

    function getContentLoadOptions() {
        const s = get();
        if (s.contentSource === 'editor' && s.contentEditorJson && s.contentEditorJson.trim()) {
            try {
                return { inlinePack: JSON.parse(s.contentEditorJson) };
            } catch (e) {
                return { useUpload: true, useServer: true };
            }
        }
        return { useUpload: false, useServer: true };
    }

    function setEditorJson(pack, asEditorSource) {
        const text = typeof pack === 'string' ? pack : JSON.stringify(pack, null, 2);
        const patch = { contentEditorJson: text };
        if (asEditorSource !== false) patch.contentSource = 'editor';
        save(patch);
        const editor = document.getElementById('content-pack-editor');
        if (editor) editor.value = text;
        const srcEditor = document.getElementById('content-source-editor');
        const srcServer = document.getElementById('content-source-server');
        if (srcEditor && srcServer && patch.contentSource === 'editor') {
            srcEditor.checked = true;
            srcServer.checked = false;
        }
        return text;
    }

    function parseEditorPack() {
        const editor = document.getElementById('content-pack-editor');
        const text = (editor && editor.value.trim()) || get().contentEditorJson || '';
        if (!text) throw new Error('empty_json');
        return JSON.parse(text);
    }

    global.DashboardSettings = {
        loadAndApply: loadAndApply,
        get: get,
        save: save,
        captureFromUI: captureFromUI,
        applyToUI: applyToUI,
        getContentLoadOptions: getContentLoadOptions,
        setEditorJson: setEditorJson,
        parseEditorPack: parseEditorPack,
        persistFromUI: captureFromUI,
    };

    global.persistDashboardSettings = function () {
        return captureFromUI();
    };
})(window);
