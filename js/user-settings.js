/**
 * 여기만 수정하세요 (Azure 키는 speech-server/.env 에 넣음)
 */
window.INTERVIEW_SETTINGS = {
    /** true: 서버 켜져 있으면 Azure 발음 평가 / false: 예전 방식(단어 맞추기) */
    useAzurePronunciation: true,

    /** speech-server (npm start) */
    healthUrl: '/api/health',
    /** 2단계 Short Audio REST 발음 평가 */
    pronounceAssessUrl: '/api/pronounce-assess',
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
