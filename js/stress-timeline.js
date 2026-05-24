/**
 * 강세/리듬 UI — RhythmLane 래퍼 (StressTimeline API 유지)
 */
(function (global) {
    let activeLane = null;
    let listenRefText = '';
    let listenRefDur = 1;
    let listenNotes = [];
    let listenPlan = null;
    let notesBuiltAtDur = 1;
    let browserSyncRaf = null;

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

    function planFromText(refText, refDur, words) {
        if (global.PitchCompare && global.PitchCompare.buildStressedWordPlan) {
            return global.PitchCompare.buildStressedWordPlan(refText, refDur, words);
        }
        return [{ beatIndex: 1, word: refText, tCenter: refDur / 2, t0: 0, t1: refDur }];
    }

    function buildNotes(refText, refDur, words, modelPts, plan, slots) {
        if (global.RhythmNotesBuilder && global.RhythmNotesBuilder.buildRhythmNotes) {
            return global.RhythmNotesBuilder.buildRhythmNotes({
                refText: refText,
                refDur: refDur,
                azureWords: words,
                modelPts: modelPts,
                plan: plan,
                slots: slots,
            });
        }
        return [];
    }

    function slotStatusClass(status) {
        if (status === 'ok') return 'ok';
        if (status === 'late') return 'late';
        if (status === 'low') return 'low';
        if (status === 'high') return 'high';
        return 'weak';
    }

    function renderCoachHtml(slots) {
        if (!slots || !slots.length) return '';
        return slots
            .map(function (s) {
                const hint = s.hintKo === 'OK' ? 'OK' : s.hintKo;
                return (
                    '<div class="rhythm-coach-row is-' +
                    slotStatusClass(s.status) +
                    '"><span class="rhythm-coach-beat">' +
                    beatNum(s.beatIndex) +
                    '</span><span>' +
                    escapeHtml(hint) +
                    '</span></div>'
                );
            })
            .join('');
    }

    function destroyLane() {
        if (browserSyncRaf) {
            cancelAnimationFrame(browserSyncRaf);
            browserSyncRaf = null;
        }
        if (activeLane) {
            activeLane.stop();
            activeLane = null;
        }
    }

    function stopModelPlaybackOnly() {
        destroyLane();
        if (typeof global.AzureTts !== 'undefined' && global.AzureTts.stopPlayback) {
            global.AzureTts.stopPlayback();
        }
        if (global.speechSynthesis) {
            global.speechSynthesis.cancel();
        }
    }

    function mountLaneOnContainer(container, options) {
        if (!container || !global.RhythmLane || !global.RhythmLane.createLane) return null;
        destroyLane();
        activeLane = global.RhythmLane.createLane(container, options);
        return activeLane;
    }

    async function estimateModelDuration(refText) {
        if (global.L2Fluency && global.L2Fluency.countWords && global.L2Fluency.expectedDurationMs) {
            const wc = global.L2Fluency.countWords(refText);
            return global.L2Fluency.expectedDurationMs(wc) / 1000;
        }
        const wc = String(refText || '').split(/\s+/).filter(Boolean).length;
        return Math.max(0.8, wc * 0.42);
    }

    function rebuildNotesIfDuration(refText, duration, words) {
        if (!duration || duration <= 0) return;
        const prevDur = notesBuiltAtDur;
        listenRefDur = duration;
        listenPlan = planFromText(refText, duration, words || []);
        if (
            global.RhythmNotesBuilder &&
            global.RhythmNotesBuilder.rescaleNotes &&
            listenNotes.length &&
            prevDur &&
            Math.abs(prevDur - duration) > 0.03
        ) {
            listenNotes = global.RhythmNotesBuilder.rescaleNotes(listenNotes, prevDur, duration);
        } else {
            listenNotes = buildNotes(refText, duration, words, null, listenPlan, null);
        }
        notesBuiltAtDur = duration;
        if (activeLane) activeLane.setNotes(listenNotes);
    }

    async function playModelSynced(refText, root, onDone) {
        listenRefText = refText;
        listenRefDur = await estimateModelDuration(refText);
        notesBuiltAtDur = listenRefDur;
        listenPlan = planFromText(refText, listenRefDur, []);
        listenNotes = buildNotes(refText, listenRefDur, [], null, listenPlan, null);

        if (root) {
            mountLaneOnContainer(root, {
                mode: 'listen',
                notes: listenNotes,
                onReplay: function () {
                    stopModelPlaybackOnly();
                    playModelSynced(refText, root, null);
                },
            });
            if (activeLane) {
                activeLane.resetHits();
                activeLane.setTime(0);
                activeLane.start();
            }
        }

        function onTime(current, duration) {
            if (duration > 0) {
                rebuildNotesIfDuration(refText, duration, []);
            }
            if (activeLane) {
                activeLane.setTime(current);
            }
        }

        function finish() {
            if (browserSyncRaf) {
                cancelAnimationFrame(browserSyncRaf);
                browserSyncRaf = null;
            }
            if (activeLane) {
                activeLane.markDone();
            } else if (root) {
                const lane = root.querySelector('.rhythm-lane');
                if (lane) lane.classList.add('is-listen-done');
            }
            if (onDone) onDone();
        }

        function playBrowserWithSync() {
            const dur = listenRefDur;
            const started = performance.now();
            function browserTick() {
                const elapsed = (performance.now() - started) / 1000;
                const t = Math.min(dur, elapsed);
                if (activeLane) activeLane.setTime(t);
                if (elapsed < dur) {
                    browserSyncRaf = requestAnimationFrame(browserTick);
                }
            }
            browserSyncRaf = requestAnimationFrame(browserTick);
            global.speakText(refText, 'en', finish);
        }

        const azureReady =
            typeof global.AzureTts !== 'undefined' &&
            global.AzureTts.speak &&
            global.AzureTts.isTtsReady &&
            global.AzureTts.isTtsReady();

        if (azureReady) {
            global.AzureTts.speak(refText, 'en', finish, { onTimeUpdate: onTime });
            return;
        }
        if (typeof global.speakText === 'function') {
            playBrowserWithSync();
            return;
        }
        finish();
    }

    function bindReplay(root, refText) {
        const btn = root.querySelector('.rhythm-lane-replay');
        if (!btn) return;
        btn.onclick = function () {
            stopModelPlaybackOnly();
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
        if (!autoPlay) {
            Promise.resolve(options.refDur || estimateModelDuration(refText)).then(function (dur) {
                listenRefDur = dur;
                listenPlan = planFromText(refText, listenRefDur, options.words || []);
                listenNotes = buildNotes(refText, dur, options.words, null, listenPlan, null);
                mountLaneOnContainer(container, {
                    mode: 'listen',
                    notes: listenNotes,
                    onReplay: function () {
                        playModelSynced(refText, container, null);
                    },
                });
                bindReplay(container, refText);
            });
            return;
        }
        playModelSynced(refText, container, options.onEnd);
    }

    function buildFeedbackHtml(analysis) {
        if (!analysis || analysis.error || !analysis.plan) return '';
        return '<div class="fb-rhythm-host"></div>';
    }

    function mountResult(container, analysis) {
        if (!container) return;
        if (!analysis || analysis.error) {
            container.innerHTML = '';
            return;
        }
        const slots = analysis.slots || [];
        const notes =
            analysis.rhythmNotes ||
            buildNotes(
                analysis.refText,
                analysis.refDur,
                analysis.words,
                analysis.modelPts,
                analysis.plan,
                slots
            );
        mountLaneOnContainer(container, {
            mode: 'result',
            notes: notes,
            frozenTime: analysis.refDur,
            coachHtml: renderCoachHtml(slots),
            onReplay: function () {
                playModelSynced(analysis.refText, container, null);
            },
        });
        bindReplay(container, analysis.refText);
    }

    function stop() {
        destroyLane();
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
