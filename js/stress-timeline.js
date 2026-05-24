/**
 * 강세 타임라인 — 모범 TTS 동기 하이라이트 + 결과 슬롯 코칭
 */
(function (global) {
    let listenRoot = null;
    let listenPlan = null;
    let listenRefText = '';
    let listenRefDur = 1;
    let listenRaf = null;

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function beatNum(n) {
        if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
        return String(n);
    }

    function displayWord(w) {
        const raw = String(w || '').trim();
        const m = raw.match(/[A-Za-z]+/);
        if (!m) return raw.slice(0, 12);
        return m[0].length <= 10 ? m[0] : m[0].slice(0, 9) + '…';
    }

    function planFromText(refText, refDur, words) {
        if (global.PitchCompare && global.PitchCompare.buildStressedWordPlan) {
            return global.PitchCompare.buildStressedWordPlan(refText, refDur, words);
        }
        return [{ beatIndex: 1, word: refText, tCenter: refDur / 2, t0: 0, t1: refDur }];
    }

    function slotStatusClass(status) {
        if (status === 'ok') return 'ok';
        if (status === 'late') return 'late';
        if (status === 'low') return 'low';
        if (status === 'high') return 'high';
        return 'weak';
    }

    function renderSlotsHtml(plan, mode, slotsWithStatus) {
        const refDur = listenRefDur || 1;
        return (plan || [])
            .map(function (slot, idx) {
                const left = ((slot.tCenter || 0) / refDur) * 100;
                const st =
                    slotsWithStatus && slotsWithStatus[idx]
                        ? slotsWithStatus[idx]
                        : null;
                const status = st ? st.status : '';
                const cls =
                    'stress-tl-slot' +
                    (mode === 'result' && status ? ' is-' + slotStatusClass(status) : '');
                const dots =
                    mode === 'result' && st
                        ? '<span class="stress-tl-dots" aria-hidden="true">' +
                          '<span class="stress-tl-dot stress-tl-dot-model" title="모범"></span>' +
                          '<span class="stress-tl-dot stress-tl-dot-user is-' +
                          slotStatusClass(st.status) +
                          '" title="나"></span></span>'
                        : '';
                return (
                    '<div class="' +
                    cls +
                    '" data-slot-idx="' +
                    idx +
                    '" style="left:' +
                    Math.max(4, Math.min(92, left)) +
                    '%">' +
                    '<span class="stress-tl-num">' +
                    beatNum(slot.beatIndex || idx + 1) +
                    '</span>' +
                    '<span class="stress-tl-word">' +
                    escapeHtml(displayWord(slot.word)) +
                    '</span>' +
                    dots +
                    '</div>'
                );
            })
            .join('');
    }

    function renderCoachHtml(slots) {
        if (!slots || !slots.length) return '';
        return (
            '<div class="stress-tl-coach">' +
            slots
                .map(function (s) {
                    const label = beatNum(s.beatIndex) + ' ' + escapeHtml(displayWord(s.word));
                    const hint = s.hintKo === 'OK' ? 'OK' : s.hintKo;
                    return (
                        '<div class="stress-tl-coach-row is-' +
                        slotStatusClass(s.status) +
                        '"><strong>' +
                        label +
                        '</strong><span>' +
                        escapeHtml(hint) +
                        '</span></div>'
                    );
                })
                .join('') +
            '</div>'
        );
    }

    function renderTimelineShell(mode, plan, slots) {
        const title =
            mode === 'result' ? '강세 맵 · 교정' : '강세 맵 · 모범 듣기';
        const hint =
            mode === 'result'
                ? '회색=모범 · 주황=나 · 맞으면 초록'
                : '▶ 모범과 함께 박자가 밝아집니다';
        return (
            '<div class="stress-tl stress-tl-mode-' +
            mode +
            '" data-mode="' +
            mode +
            '">' +
            '<div class="stress-tl-head">' +
            '<span class="stress-tl-title">' +
            title +
            '</span>' +
            '<button type="button" class="stress-tl-replay">▶ 모범</button>' +
            '</div>' +
            '<p class="stress-tl-hint">' +
            hint +
            '</p>' +
            '<div class="stress-tl-track">' +
            '<div class="stress-tl-bar"></div>' +
            '<div class="stress-tl-playhead"></div>' +
            '<div class="stress-tl-slots">' +
            renderSlotsHtml(plan, mode, slots) +
            '</div>' +
            '</div>' +
            (mode === 'result' ? renderCoachHtml(slots) : '') +
            '</div>'
        );
    }

    function clearListenAnim() {
        if (listenRaf) {
            cancelAnimationFrame(listenRaf);
            listenRaf = null;
        }
    }

    function setActiveSlot(root, index) {
        if (!root) return;
        root.querySelectorAll('.stress-tl-slot').forEach(function (el, i) {
            el.classList.remove('is-active', 'is-past');
            if (i < index) el.classList.add('is-past');
            if (i === index) el.classList.add('is-active');
        });
    }

    function setPlayhead(root, ratio) {
        if (!root) return;
        const head = root.querySelector('.stress-tl-playhead');
        if (!head) return;
        const pct = Math.max(0, Math.min(100, ratio * 100));
        head.style.left = pct + '%';
    }

    function resetTimelineVisual(root) {
        if (!root) return;
        setPlayhead(root, 0);
        root.querySelectorAll('.stress-tl-slot').forEach(function (el) {
            el.classList.remove('is-active', 'is-past');
        });
    }

    function syncTimelineToTime(root, plan, t, dur) {
        if (!root || !plan || !plan.length || !dur) return;
        const ratio = t / dur;
        setPlayhead(root, ratio);
        let idx = 0;
        for (let i = 0; i < plan.length; i++) {
            if ((plan[i].tCenter || 0) <= t + 0.05) idx = i;
        }
        setActiveSlot(root, idx);
    }

    async function estimateModelDuration(refText) {
        if (global.L2Fluency && global.L2Fluency.countWords && global.L2Fluency.expectedDurationMs) {
            const wc = global.L2Fluency.countWords(refText);
            return global.L2Fluency.expectedDurationMs(wc) / 1000;
        }
        const wc = String(refText || '').split(/\s+/).filter(Boolean).length;
        return Math.max(0.8, wc * 0.42);
    }

    async function playModelSynced(refText, root, onDone) {
        listenRefText = refText;
        listenRefDur = await estimateModelDuration(refText);
        listenPlan = planFromText(refText, listenRefDur, []);

        if (root) {
            root.innerHTML = renderTimelineShell('listen', listenPlan, null);
            listenRoot = root;
            bindReplay(root, refText);
            resetTimelineVisual(root);
        }

        function onTime(current, duration) {
            if (root && duration > 0) {
                listenRefDur = duration;
                syncTimelineToTime(root, listenPlan, current, duration);
            }
        }

        function finish() {
            clearListenAnim();
            if (root) {
                setPlayhead(root, 1);
                setActiveSlot(root, listenPlan.length);
            }
            if (onDone) onDone();
        }

        if (typeof global.AzureTts !== 'undefined' && global.AzureTts.speak) {
            global.AzureTts.speak(refText, 'en', finish, { onTimeUpdate: onTime });
            return;
        }
        if (typeof global.speakText === 'function') {
            global.speakText(refText, 'en', finish);
            return;
        }
        finish();
    }

    function bindReplay(root, refText) {
        const btn = root.querySelector('.stress-tl-replay');
        if (!btn) return;
        btn.onclick = function () {
            if (typeof global.stopAllPlayback === 'function') global.stopAllPlayback();
            playModelSynced(refText, root, null);
        };
    }

    function mountListen(container, refText, options) {
        options = options || {};
        if (!container || !refText) {
            if (container) container.innerHTML = '';
            return;
        }
        const autoPlay = options.autoPlay !== false;
        Promise.resolve(options.refDur || estimateModelDuration(refText)).then(function (dur) {
            listenRefDur = dur;
            listenPlan = planFromText(refText, listenRefDur, options.words || []);
            container.innerHTML = renderTimelineShell('listen', listenPlan, null);
            listenRoot = container;
            bindReplay(container, refText);
            if (autoPlay) playModelSynced(refText, container, options.onEnd);
        });
    }

    function buildFeedbackHtml(analysis) {
        if (!analysis || analysis.error || !analysis.plan) return '';
        listenRefDur = analysis.refDur;
        const slots = analysis.slots || [];
        return renderTimelineShell('result', analysis.plan, slots);
    }

    function mountResult(container, analysis) {
        if (!container) return;
        if (!analysis || analysis.error) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = buildFeedbackHtml(analysis);
        listenRoot = container;
        listenPlan = analysis.plan;
        listenRefDur = analysis.refDur;
        bindReplay(container, analysis.refText);
    }

    function stop() {
        clearListenAnim();
        if (typeof global.stopAllPlayback === 'function') global.stopAllPlayback();
    }

    global.StressTimeline = {
        mountListen: mountListen,
        mountResult: mountResult,
        buildFeedbackHtml: buildFeedbackHtml,
        playModelSynced: playModelSynced,
        bindReplay: bindReplay,
        stop: stop,
    };
})(window);
