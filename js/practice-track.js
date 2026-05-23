/**
 * 연습 트랙: 면접 답(짧게) vs 발음·숙달(심화)
 */
(function (global) {
    const STORAGE_KEY = 'interviewPracticeTrackV1';

    const TRACKS = {
        interview: {
            id: 'interview',
            label: '면접 답',
            short: '질문·cloze·통문장 중심 · 짧게',
            hint: '발음·L2는 참고만 · 건너뛰기 가능 · 약점 큐는 진행을 막지 않음',
        },
        deep: {
            id: 'deep',
            label: '발음·숙달',
            short: 'Azure·숙달·L2 풀세트',
            hint: '2단계 발음·연속 통과·주제 끝 약점 반복 (대시보드 숙달 설정)',
        },
    };

    function getTrackId() {
        if (global.DashboardSettings && global.DashboardSettings.get) {
            const s = global.DashboardSettings.get();
            if (s.practiceTrack && TRACKS[s.practiceTrack]) return s.practiceTrack;
        }
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && TRACKS[saved]) return saved;
        return 'interview';
    }

    function setTrackId(id) {
        if (!TRACKS[id]) return;
        localStorage.setItem(STORAGE_KEY, id);
        if (global.DashboardSettings && global.DashboardSettings.save && global.DashboardSettings.get) {
            if (global.DashboardSettings.get().practiceTrack !== id) {
                global.DashboardSettings.save({ practiceTrack: id });
            }
        }
    }

    function isInterviewTrack() {
        return getTrackId() === 'interview';
    }

    function isDeepTrack() {
        return getTrackId() === 'deep';
    }

    /** 숙달이 진행·스킵을 막는지 */
    function isStrictMastery() {
        if (isInterviewTrack()) return false;
        if (typeof global.MasteryEngine === 'undefined' || !global.MasteryEngine.isMasteryMode) return false;
        return global.MasteryEngine.isMasteryMode();
    }

    function shouldDrainTormentAtTopicEnd() {
        return isDeepTrack() && isStrictMastery();
    }

    function shouldApplyL2ToMastery(phase) {
        return isDeepTrack() && phase >= 3;
    }

    function useClozeDisplay(phase) {
        return phase === 2 || phase === 3 || phase === 4;
    }

    function phase3UsesClozeBlindFlow() {
        return true;
    }

    function phase4UsesCloze() {
        return isInterviewTrack();
    }

    function isMinimalPhase1() {
        return isInterviewTrack();
    }

    function canAlwaysSkipPhase(phase) {
        if (!isInterviewTrack()) return false;
        if (phase < 2) return phase === 1;
        return true;
    }

    function phase2ShowsSkip() {
        return isInterviewTrack();
    }

    global.PracticeTrack = {
        TRACKS: TRACKS,
        getTrackId: getTrackId,
        setTrackId: setTrackId,
        isInterviewTrack: isInterviewTrack,
        isDeepTrack: isDeepTrack,
        isStrictMastery: isStrictMastery,
        shouldDrainTormentAtTopicEnd: shouldDrainTormentAtTopicEnd,
        shouldApplyL2ToMastery: shouldApplyL2ToMastery,
        useClozeDisplay: useClozeDisplay,
        phase3UsesClozeBlindFlow: phase3UsesClozeBlindFlow,
        phase4UsesCloze: phase4UsesCloze,
        isMinimalPhase1: isMinimalPhase1,
        canAlwaysSkipPhase: canAlwaysSkipPhase,
        phase2ShowsSkip: phase2ShowsSkip,
    };
})(window);
