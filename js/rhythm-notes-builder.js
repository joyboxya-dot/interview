/**
 * 리듬 레인용 notes[] 생성 — plan + 피치 컨투어
 */
(function (global) {
    function semiToPitch(semi) {
        if (semi == null || !isFinite(semi)) return 'mid';
        if (semi > 0.85) return 'high';
        if (semi < -0.85) return 'low';
        return 'mid';
    }

    function sampleSemiAt(pts, t, refDur) {
        if (!pts || !pts.length || !refDur) return null;
        if (global.PitchCompare && global.PitchCompare.sampleSemiAt) {
            return global.PitchCompare.sampleSemiAt(pts, t, refDur, false, refDur);
        }
        return null;
    }

    function buildFromPlan(plan, refDur, modelPts, slots) {
        const refDurSafe = refDur || 0.1;
        const sorted = (plan || []).slice().sort(function (a, b) {
            return (a.tCenter || 0) - (b.tCenter || 0);
        });
        const notes = [];
        let id = 1;

        sorted.forEach(function (slot, idx) {
            const startTime =
                slot.tCenter != null ? slot.tCenter : (slot.t0 + slot.t1) * 0.5;
            const next = sorted[idx + 1];
            const nextT = next
                ? next.tCenter != null
                    ? next.tCenter
                    : (next.t0 + next.t1) * 0.5
                : refDurSafe;
            const gap = Math.max(0.12, nextT - startTime);
            const duration = Math.min(0.38, Math.max(0.1, gap * 0.55));
            const semi = sampleSemiAt(modelPts, startTime, refDurSafe);
            let st = slot.status || null;
            if (slots && slots.length) {
                for (let si = 0; si < slots.length; si++) {
                    if (
                        slots[si].beatIndex === slot.beatIndex ||
                        (slot.clean && slots[si].clean === slot.clean)
                    ) {
                        st = slots[si].status;
                        break;
                    }
                }
            }

            notes.push({
                id: id++,
                startTime: startTime,
                duration: duration,
                stress: true,
                pitch: semiToPitch(semi),
                semi: semi,
                status: st,
                slotIndex: idx,
                beatIndex: slot.beatIndex != null ? slot.beatIndex : idx + 1,
                word: slot.word || '',
                clean: slot.clean || '',
            });

            if (next && nextT - startTime > 0.42) {
                const weakT = startTime + gap * 0.52;
                const weakSemi = sampleSemiAt(modelPts, weakT, refDurSafe);
                notes.push({
                    id: id++,
                    startTime: weakT,
                    duration: Math.min(0.14, gap * 0.22),
                    stress: false,
                    pitch: semiToPitch(weakSemi),
                    semi: weakSemi,
                    status: null,
                    slotIndex: -1,
                });
            }
        });

        notes.sort(function (a, b) {
            return a.startTime - b.startTime;
        });
        return notes;
    }

    function buildRhythmNotes(opts) {
        opts = opts || {};
        const refText = String(opts.refText || '').trim();
        const refDur = opts.refDur || 1;
        let plan = opts.plan;

        if (!plan || !plan.length) {
            if (global.PitchCompare && global.PitchCompare.buildStressedWordPlan) {
                plan = global.PitchCompare.buildStressedWordPlan(
                    refText,
                    refDur,
                    opts.azureWords || opts.words || [],
                    { chunkOnly: opts.chunkOnly !== false }
                );
            } else {
                plan = [
                    {
                        beatIndex: 1,
                        tCenter: refDur / 2,
                        t0: 0,
                        t1: refDur,
                        stressScore: 2,
                    },
                ];
            }
        }

        return buildFromPlan(plan, refDur, opts.modelPts || null, opts.slots || null);
    }

    function rescaleNotes(notes, oldDur, newDur) {
        if (!notes || !notes.length || !oldDur || !newDur || Math.abs(oldDur - newDur) < 0.02) {
            return notes;
        }
        const scale = newDur / oldDur;
        return notes.map(function (n) {
            return Object.assign({}, n, {
                startTime: n.startTime * scale,
                duration: n.duration * scale,
            });
        });
    }

    global.RhythmNotesBuilder = {
        buildRhythmNotes: buildRhythmNotes,
        buildFromPlan: buildFromPlan,
        rescaleNotes: rescaleNotes,
        semiToPitch: semiToPitch,
    };
})(window);
