/**
 * 강세/리듬 UI — RhythmLane 래퍼 (StressTimeline API 유지)
 */
(function (global) {
    let activeLane = null;
    let listenRefText = '';
    let listenRefDur = 1;
    let listenNotes = [];
    let listenPlan = null;
    let listenModelPts = null;
    let notesBuiltAtDur = 1;
    let listenAudioLeadIn = 0;
    let browserSyncRaf = null;

    function syncTimeFromAudio(current, fullDuration) {
        if (!fullDuration || fullDuration <= 0) return 0;
        const speechDur = Math.max(0.2, fullDuration - listenAudioLeadIn);
        return Math.max(0, Math.min(listenRefDur || speechDur, current - listenAudioLeadIn));
    }

    async function loadListenTiming(refText, words) {
        if (global.PitchCompare && global.PitchCompare.buildModelListenTiming) {
            const timing = await global.PitchCompare.buildModelListenTiming(refText);
            listenRefDur = timing.speechDur;
            listenAudioLeadIn = timing.audioLeadIn || 0;
            listenPlan = timing.plan || planFromText(refText, listenRefDur, words);
            listenModelPts = timing.modelPts;
            listenNotes =
                timing.notes && timing.notes.length
                    ? timing.notes
                    : buildNotes(refText, listenRefDur, words, listenModelPts, listenPlan, null);
            notesBuiltAtDur = listenRefDur;
            return timing;
        }
        listenAudioLeadIn = 0;
        listenRefDur = await estimateModelDuration(refText);
        listenPlan = planFromText(refText, listenRefDur, words || []);
        listenModelPts = null;
        listenNotes = buildNotes(refText, listenRefDur, words, null, listenPlan, null);
        notesBuiltAtDur = listenRefDur;
        return null;
    }

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

    function rhythmLaneCallbacks() {
        return {
            onStressHit: function (note) {
                if (
                    note &&
                    note.stress &&
                    typeof global.highlightRhythmStressWord === 'function'
                ) {
                    global.highlightRhythmStressWord(note.clean, note.beatIndex, note.word);
                }
            },
            onStressReset: function () {
                if (typeof global.clearRhythmStressWordHighlight === 'function') {
                    global.clearRhythmStressWordHighlight();
                }
            },
        };
    }

    function mountLaneOnContainer(container, options) {
        if (!container || !global.RhythmLane || !global.RhythmLane.createLane) return null;
        destroyLane();
        options = Object.assign({}, rhythmLaneCallbacks(), options || {});
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

    function rebuildNotesIfDuration(refText, fullDuration, words) {
        if (!fullDuration || fullDuration <= 0) return;
        const measuredSpeech = Math.max(0.25, fullDuration - listenAudioLeadIn);
        const prevDur = notesBuiltAtDur;
        if (Math.abs(measuredSpeech - prevDur) < 0.03) return;

        listenRefDur = measuredSpeech;
        if (
            global.RhythmNotesBuilder &&
            global.RhythmNotesBuilder.rescaleNotes &&
            listenNotes.length &&
            prevDur
        ) {
            listenNotes = global.RhythmNotesBuilder.rescaleNotes(listenNotes, prevDur, measuredSpeech);
        } else {
            listenPlan = planFromText(refText, measuredSpeech, words || []);
            listenNotes = buildNotes(refText, measuredSpeech, words, listenModelPts, listenPlan, null);
        }
        notesBuiltAtDur = measuredSpeech;
        if (activeLane) activeLane.setNotes(listenNotes);
    }

    async function playModelSynced(refText, root, onDone) {
        listenRefText = refText;
        await loadListenTiming(refText, []);

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
                activeLane.setTime(syncTimeFromAudio(current, duration));
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
            loadListenTiming(refText, options.words || []).then(function () {
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
        stopModelPlaybackOnly: stopModelPlaybackOnly,
    };
})(window);
