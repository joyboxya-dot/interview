/**
 * 여기만 수정하세요 (Azure 키는 speech-server/.env 에 넣음)
 */
window.INTERVIEW_SETTINGS = {
    /** true: 서버 켜져 있으면 Azure 발음 평가 / false: 예전 방식(단어 맞추기) */
    useAzurePronunciation: true,

    /** true: Azure Neural TTS (서버·브라우저 캐시, 문구당 1회 합성) */
    useAzureTts: true,
    /** 여성 Neural (Aria) — 서버 SSML과 맞춤, newscast-formal 은 너무 빠름 */
    ttsVoiceEn: 'en-US-AriaNeural',
    ttsVoiceKo: 'ko-KR-SunHiNeural',
    ttsStyleEn: 'empathetic',

    /** speech-server (npm start) */
    healthUrl: '/api/health',
    /** 2단계 Short Audio REST 발음 평가 */
    pronounceAssessUrl: '/api/pronounce-assess',
    /** TTS 합성 (디스크 캐시) */
    ttsUrl: '/api/tts',
    /** 면접 스크립트 AI (EvoLink 프록시) */
    generateScriptUrl: '/api/generate-script',
};

/** 2단계 Azure 합격선 프리셋 (난이도) */
window.DIFFICULTY_PRESETS = {
    easy: {
        id: 'easy',
        label: '쉬움',
        passAccuracy: 75,
        passFluency: 60,
        passProsody: 55,
        summary: '문장 따라 말하기 입문 · 통과가 비교적 쉬움',
    },
    normal: {
        id: 'normal',
        label: '보통',
        passAccuracy: 80,
        passFluency: 65,
        passProsody: 60,
        summary: '면접에서 이해 가능한 수준 목표',
    },
    strict: {
        id: 'strict',
        label: '엄격',
        passAccuracy: 85,
        passFluency: 70,
        passProsody: 65,
        summary: '문장별로 탄탄히 · 단락 회상 전 기초 다지기',
    },
};

window.DIFFICULTY_STORAGE_KEY = 'interviewDifficultyV1';
window.DEFAULT_DIFFICULTY = 'strict';

window.getSavedDifficultyId = function () {
    const saved = localStorage.getItem(window.DIFFICULTY_STORAGE_KEY);
    if (saved && window.DIFFICULTY_PRESETS[saved]) return saved;
    return window.DEFAULT_DIFFICULTY;
};

window.setSavedDifficultyId = function (id) {
    if (!window.DIFFICULTY_PRESETS[id]) return;
    localStorage.setItem(window.DIFFICULTY_STORAGE_KEY, id);
};

window.getPassThresholds = function () {
    const preset = window.DIFFICULTY_PRESETS[window.getSavedDifficultyId()];
    return {
        passAccuracy: preset.passAccuracy,
        passFluency: preset.passFluency,
        passProsody: preset.passProsody,
        label: preset.label,
        summary: preset.summary,
    };
};

window.formatPassThresholdLine = function (t) {
    t = t || window.getPassThresholds();
    return '정확도 ' + t.passAccuracy + ' · 유창성 ' + t.passFluency + ' · 운율 ' + t.passProsody;
};

/** TTS·안내 음성 재생 속도 (대시보드 콤보, localStorage) — 녹음본(←→)은 항상 100% */
window.TTS_SPEED_OPTIONS = [
    { rate: 0.5, label: '50% · 아주 느림' },
    { rate: 0.55, label: '55%' },
    { rate: 0.65, label: '65%' },
    { rate: 0.72, label: '72%' },
    { rate: 0.82, label: '82% · 기본' },
    { rate: 0.92, label: '92%' },
    { rate: 1.0, label: '100% · 원속' },
];

window.TTS_NORMAL_SPEED_KEY = 'interviewTtsNormalSpeedV1';
window.TTS_PRACTICE_SPEED_KEY = 'interviewTtsPracticeSpeedV1';
window.DEFAULT_TTS_NORMAL_RATE = 0.82;
window.DEFAULT_TTS_PRACTICE_RATE = 0.82;

function parseTtsRate(value, fallback) {
    const n = parseFloat(value);
    if (!isNaN(n) && n >= 0.4 && n <= 1.2) return n;
    return fallback;
}

function closestTtsOptionRate(rate) {
    const opts = window.TTS_SPEED_OPTIONS;
    let best = opts[0].rate;
    let diff = Math.abs(rate - best);
    opts.forEach(function (o) {
        const d = Math.abs(rate - o.rate);
        if (d < diff) {
            diff = d;
            best = o.rate;
        }
    });
    return best;
}

window.getSavedTtsNormalRate = function () {
    const saved = localStorage.getItem(window.TTS_NORMAL_SPEED_KEY);
    if (saved != null) return closestTtsOptionRate(parseTtsRate(saved, window.DEFAULT_TTS_NORMAL_RATE));
    const legacy = window.INTERVIEW_SETTINGS && window.INTERVIEW_SETTINGS.ttsNormalPlaybackRate;
    return closestTtsOptionRate(parseTtsRate(legacy, window.DEFAULT_TTS_NORMAL_RATE));
};

window.getSavedTtsPracticeRate = function () {
    const saved = localStorage.getItem(window.TTS_PRACTICE_SPEED_KEY);
    if (saved != null) return closestTtsOptionRate(parseTtsRate(saved, window.DEFAULT_TTS_PRACTICE_RATE));
    const legacy = window.INTERVIEW_SETTINGS && window.INTERVIEW_SETTINGS.ttsPracticePlaybackRate;
    return closestTtsOptionRate(parseTtsRate(legacy, window.DEFAULT_TTS_PRACTICE_RATE));
};

window.setSavedTtsNormalRate = function (rate) {
    localStorage.setItem(window.TTS_NORMAL_SPEED_KEY, String(closestTtsOptionRate(rate)));
};

window.setSavedTtsPracticeRate = function (rate) {
    localStorage.setItem(window.TTS_PRACTICE_SPEED_KEY, String(closestTtsOptionRate(rate)));
};

/** @returns {{ normal: number, practice: number, browserNormal: number, browserPractice: number }} */
window.getModelEnglishTtsRate = function () {
    if (typeof window.L2Fluency !== 'undefined' && window.L2Fluency.getModelEnglishTtsRate) {
        return window.L2Fluency.getModelEnglishTtsRate();
    }
    return window.getSavedTtsNormalRate();
};

window.getTtsPlaybackRates = function () {
    const normal = window.getSavedTtsNormalRate();
    const practice = window.getSavedTtsPracticeRate();
    const modelEn =
        typeof window.getModelEnglishTtsRate === 'function'
            ? window.getModelEnglishTtsRate()
            : normal;
    return {
        normal: normal,
        practice: practice,
        modelEnglish: modelEn,
        browserNormal: Math.min(1, normal * 0.92),
        browserModelEnglish: Math.min(1, modelEn * 0.92),
        browserPractice: Math.min(0.5, practice * 0.34),
    };
};

window.closestTtsOptionRate = closestTtsOptionRate;

window.formatTtsSpeedHint = function () {
    const r = window.getTtsPlaybackRates();
    const pct = function (x) {
        return Math.round(x * 100) + '%';
    };
    return (
        '영어 모범 ' +
        pct(r.modelEnglish) +
        ' (L2 말하기 속도) · 한글 안내 ' +
        pct(r.normal) +
        ' · 틀린 단어 ' +
        pct(r.practice) +
        ' · 내 녹음(←→) 100%'
    );
};
