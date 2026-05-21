/**
 * 여기만 수정하세요 (Azure 키는 speech-server/.env 에 넣음)
 */
window.INTERVIEW_SETTINGS = {
    /** true: 서버 켜져 있으면 Azure 발음 평가 / false: 예전 방식(단어 맞추기) */
    useAzurePronunciation: true,

    /** 합격 점수 (0~100) — Azure 연결 시 */
    passAccuracy: 70,
    passProsody: 55,
    passFluency: 55,

    /** 토큰 API (speech-server npm start 기본 주소) */
    tokenUrl: '/api/speech-token',
};
