/**
 * 모범 TTS vs 내 녹음 — 피치 곡선 겹침 + 유사도
 * · 앞뒤 무음 자동 트림 후 비교 · Web Audio 재생
 */
(function (global) {
    const CHART_STYLES = {
        'rhythm-nodes': 'rhythm-nodes',
        line: 'line',
    };

    const GLUE_WORDS = new Set([
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'at', 'it', 'and', 'but', 'or', 'for', 'with', 'as', 'by',
        'i', 'my', 'our', 'we', 'so', 'if', 'not', 'also', 'just', 'only',
    ]);

    const sessions = {};
    let sessionSeq = 0;
    let pitchPlayCtx = null;
    let pitchPlaySource = null;

    function getPitchChartStyle() {
        if (global.DashboardSettings && global.DashboardSettings.get) {
            const id = global.DashboardSettings.get().pitchChartStyle;
            if (id === CHART_STYLES.line) return CHART_STYLES.line;
        }
        return CHART_STYLES['rhythm-nodes'];
    }

    function beatCircledNum(n) {
        if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
        return String(n);
    }

    function isGlueToken(token) {
        const w = String(token || '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');
        if (!w) return true;
        return GLUE_WORDS.has(w) || w.length <= 2;
    }

    function tokenCleanAlpha(token) {
        const m = String(token || '').match(/[A-Za-z0-9]+/);
        return m ? m[0].toLowerCase() : '';
    }

    function getStressDict() {
        if (typeof global.getInterviewStressDict === 'function') {
            return global.getInterviewStressDict();
        }
        return null;
    }

    /** reading-guide 박자마다 강세 단어 1개 (stressDict 우선, 없으면 박자 내 최장어) */
    function pickStressedTokenInGroup(tokens) {
        const dict = getStressDict();
        const candidates = tokens.filter(function (t) {
            return !isGlueToken(t) && tokenCleanAlpha(t);
        });
        if (!candidates.length) return null;
        let i;
        for (i = 0; i < candidates.length; i++) {
            const c = tokenCleanAlpha(candidates[i]);
            if (dict && dict[c]) return candidates[i];
        }
        let best = candidates[0];
        let bestLen = tokenCleanAlpha(best).length;
        candidates.forEach(function (t) {
            const len = tokenCleanAlpha(t).length;
            if (len > bestLen) {
                bestLen = len;
                best = t;
            }
        });
        return best;
    }

    function listStressedWordsFromText(refText) {
        const items = [];
        const seen = new Set();
        let chunks = [];
        if (global.ReadingGuide && global.ReadingGuide.getChunks) {
            chunks = global.ReadingGuide.getChunks({ en: refText });
        } else if (global.ReadingGuide && global.ReadingGuide.autoChunksFromEn) {
            chunks = global.ReadingGuide.autoChunksFromEn(refText);
        } else {
            chunks = [{ text: refText, pauseAfterSec: 0 }];
        }
        const dict = getStressDict();
        chunks.forEach(function (c) {
            const tokens = String((c && c.text) || '')
                .trim()
                .split(/\s+/)
                .filter(Boolean);
            const picked = pickStressedTokenInGroup(tokens);
            if (!picked) return;
            const clean = tokenCleanAlpha(picked);
            if (!clean || seen.has(clean)) return;
            seen.add(clean);
            items.push({
                word: picked,
                clean: clean,
                stressScore: dict && dict[clean] ? 3 : 2,
            });
        });
        if (!items.length) {
            const all = String(refText || '')
                .trim()
                .split(/\s+/)
                .filter(Boolean);
            const picked = pickStressedTokenInGroup(all);
            if (picked) {
                const clean = tokenCleanAlpha(picked);
                items.push({ word: picked, clean: clean, stressScore: 2 });
            }
        }
        return items;
    }

    function cleanAzureWord(word) {
        return String(word || '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');
    }

    function filterWordsToStressedOnly(words, refText) {
        if (!refText || !words || !words.length) return [];
        const allowed = new Set(
            listStressedWordsFromText(refText).map(function (w) {
                return w.clean;
            })
        );
        if (!allowed.size) return [];
        return words.filter(function (w) {
            return allowed.has(cleanAzureWord(w.word));
        });
    }

    /** 단어 길이 가중 — 균등 n분할보다 실제 발화 타이밍에 가깝게 */
    function tokenWeightedTimeSec(refText, clean, refDurSafe) {
        const refTokens = String(refText || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (!refTokens.length) return refDurSafe * 0.5;
        const weights = refTokens.map(function (t) {
            const c = tokenCleanAlpha(t);
            return Math.max(1, c ? c.length : 1);
        });
        let total = 0;
        let i;
        for (i = 0; i < weights.length; i++) total += weights[i];
        if (!total) return refDurSafe * 0.5;
        let cum = 0;
        for (i = 0; i < refTokens.length; i++) {
            const c = tokenCleanAlpha(refTokens[i]);
            const w = weights[i];
            if (c === clean) {
                return ((cum + w * 0.42) / total) * refDurSafe;
            }
            cum += w;
        }
        const idx = refTokens.findIndex(function (t) {
            return tokenCleanAlpha(t) === clean;
        });
        const pos = idx >= 0 ? idx : 0;
        return ((pos + 0.5) / refTokens.length) * refDurSafe;
    }

    function extractRmsFrames(samples, sampleRate) {
        const frameSize = 512;
        const hop = 128;
        const minFrame = 192;
        const out = [];
        for (let start = 0; start < samples.length; start += hop) {
            const end = Math.min(start + frameSize, samples.length);
            const len = end - start;
            if (len < minFrame) break;
            out.push({
                t: (start + len / 2) / sampleRate,
                rms: frameRms(samples.subarray(start, end)),
            });
        }
        return out;
    }

    /** 모범 음성 envelope 피크·온셋에 강세 시점 스냅 */
    function alignPlanToEnvelope(plan, samples, sampleRate, speechDur) {
        if (!plan || !plan.length || !samples || !sampleRate || !speechDur) return plan;
        const rmsList = extractRmsFrames(samples, sampleRate);
        if (!rmsList.length) return plan;

        return plan.map(function (slot) {
            const expected = slot.tCenter != null ? slot.tCenter : speechDur * 0.5;
            const halfWin = Math.min(0.28, Math.max(0.1, speechDur * 0.09));
            const tMin = Math.max(0, expected - halfWin);
            const tMax = Math.min(speechDur, expected + halfWin);

            let peakT = expected;
            let peakR = 0;
            rmsList.forEach(function (p) {
                if (p.t < tMin || p.t > tMax) return;
                if (p.rms > peakR) {
                    peakR = p.rms;
                    peakT = p.t;
                }
            });

            let onsetT = peakT;
            if (peakR > 1e-6) {
                const thresh = peakR * 0.32;
                for (let i = 0; i < rmsList.length; i++) {
                    const p = rmsList[i];
                    if (p.t < tMin || p.t > peakT) continue;
                    if (p.rms <= thresh) onsetT = p.t;
                }
                onsetT = Math.min(peakT, onsetT + 0.035);
            }

            const blended = expected * 0.25 + onsetT * 0.75;
            const tCenter = Math.max(0, Math.min(speechDur, blended));
            return Object.assign({}, slot, {
                tCenter: tCenter,
                t0: Math.max(0, tCenter - 0.09),
                t1: Math.min(speechDur, tCenter + 0.14),
            });
        });
    }

    const modelListenTimingCache = {};

    /** 모범 TTS 디코드 → 트림·envelope 정렬 → 리듬 노트 (듣기 동기용) */
    async function buildModelListenTiming(refText) {
        const safe = String(refText || '').trim();
        const fallbackDur =
            global.L2Fluency && global.L2Fluency.countWords && global.L2Fluency.expectedDurationMs
                ? global.L2Fluency.expectedDurationMs(global.L2Fluency.countWords(safe)) / 1000
                : Math.max(0.8, safe.split(/\s+/).filter(Boolean).length * 0.42);

        if (!safe) {
            return {
                speechDur: fallbackDur,
                audioLeadIn: 0,
                fullAudioDur: fallbackDur,
                plan: [],
                modelPts: null,
                notes: [],
            };
        }

        const cacheKey = 'v2|' + safe;
        if (modelListenTimingCache[cacheKey]) {
            return modelListenTimingCache[cacheKey];
        }

        let speechDur = fallbackDur;
        let audioLeadIn = 0;
        let fullAudioDur = fallbackDur;
        let modelPts = null;
        let trimSamples = null;
        let trimRate = 8000;

        try {
            const blob = await getModelMp3Blob(safe);
            if (blob) {
                const mono = await blobToMono(await blob.arrayBuffer());
                const trim = trimSpeechBounds(mono.samples, mono.sampleRate);
                speechDur = Math.max(0.25, trim.speechDur);
                audioLeadIn = trim.offsetSec || 0;
                fullAudioDur = mono.samples.length / mono.sampleRate;
                trimSamples = trim.samples;
                trimRate = mono.sampleRate;
                const ds = downsample(trim.samples, mono.sampleRate, 8000);
                const contour = buildDisplayContour(ds.samples, ds.sampleRate);
                modelPts = contour.points;
            }
        } catch (e) {
            console.warn('buildModelListenTiming', e);
        }

        let plan = buildStressedWordPlan(safe, speechDur, []);
        if (trimSamples && trimSamples.length) {
            plan = alignPlanToEnvelope(plan, trimSamples, trimRate, speechDur);
        }

        let notes = [];
        if (global.RhythmNotesBuilder && global.RhythmNotesBuilder.buildRhythmNotes) {
            notes = global.RhythmNotesBuilder.buildRhythmNotes({
                refText: safe,
                refDur: speechDur,
                plan: plan,
                modelPts: modelPts,
            });
        }

        const pack = {
            speechDur: speechDur,
            audioLeadIn: audioLeadIn,
            fullAudioDur: fullAudioDur,
            plan: plan,
            modelPts: modelPts,
            notes: notes,
        };
        modelListenTimingCache[cacheKey] = pack;
        return pack;
    }

    /** 강세 단어 시점 — Azure offset 우선, 없으면 길이 가중 + envelope 정렬(듣기 시) */
    function buildStressedWordPlan(refText, refDur, azureWords) {
        const items = listStressedWordsFromText(refText);
        const refDurSafe = refDur || 0.1;
        if (!items.length) {
            return [
                {
                    beatIndex: 1,
                    word: '',
                    t0: 0,
                    t1: refDurSafe,
                    tCenter: refDurSafe / 2,
                    stressScore: 2,
                },
            ];
        }
        const sorted = sortWordsByOffset(azureWords || []);
        const withTime = items.map(function (item) {
            let tCenter = null;
            let i;
            for (i = 0; i < sorted.length; i++) {
                const aw = sorted[i];
                if (cleanAzureWord(aw.word) === item.clean && aw.offsetMs != null) {
                    tCenter = aw.offsetMs / 1000;
                    break;
                }
            }
            return Object.assign({}, item, { tCenter: tCenter });
        });
        withTime.forEach(function (w) {
            if (w.tCenter != null) return;
            w.tCenter = tokenWeightedTimeSec(refText, w.clean, refDurSafe);
        });
        withTime.sort(function (a, b) {
            return a.tCenter - b.tCenter;
        });
        return withTime.map(function (w, i) {
            return {
                beatIndex: i + 1,
                word: w.word,
                clean: w.clean,
                stressScore: w.stressScore,
                tCenter: w.tCenter,
                t0: Math.max(0, w.tCenter - 0.1),
                t1: Math.min(refDurSafe, w.tCenter + 0.1),
            };
        });
    }

    function sampleSemiAt(pts, t, speechDur, alignUser, refDur) {
        let tt = t;
        if (alignUser && speechDur > 0 && refDur > 0) {
            tt = t * (speechDur / refDur);
        }
        return interpolateSemi(pts, Math.max(0, tt));
    }

    function nodeRadiusFromStress(stressScore) {
        return Math.min(14, Math.max(7, 6 + stressScore * 0.8));
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function stopPlayback() {
        if (pitchPlaySource) {
            try {
                pitchPlaySource.stop();
            } catch (e) {}
            pitchPlaySource.onended = null;
            pitchPlaySource = null;
        }
        if (pitchPlayCtx) {
            pitchPlayCtx.close().catch(function () {});
            pitchPlayCtx = null;
        }
    }

    async function blobToMono(arrayBuffer) {
        const ctx = new (global.AudioContext || global.webkitAudioContext)();
        try {
            const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
            const len = buf.length;
            const ch0 = buf.getChannelData(0);
            let samples;
            if (buf.numberOfChannels === 1) {
                samples = new Float32Array(ch0);
            } else {
                samples = new Float32Array(len);
                const ch1 = buf.getChannelData(1);
                for (let i = 0; i < len; i++) {
                    samples[i] = (ch0[i] + ch1[i]) * 0.5;
                }
            }
            return { samples: samples, sampleRate: buf.sampleRate };
        } finally {
            try {
                await ctx.close();
            } catch (e) {}
        }
    }

    function downsample(samples, sampleRate, targetRate) {
        if (sampleRate <= targetRate) return { samples: samples, sampleRate: sampleRate };
        const ratio = sampleRate / targetRate;
        const outLen = Math.floor(samples.length / ratio);
        const out = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
            out[i] = samples[Math.floor(i * ratio)];
        }
        return { samples: out, sampleRate: targetRate };
    }

    /** 말하기 구간만 남김 — 앞뒤 무음 제거 (끝은 여유 있게 잘라 really·bothered 등 유지) */
    function trimSpeechBounds(samples, sampleRate) {
        const frameSize = 256;
        const hop = 64;
        const gate = 0.008;
        let first = -1;
        let last = -1;
        for (let start = 0; start + frameSize <= samples.length; start += hop) {
            const rms = frameRms(samples.subarray(start, start + frameSize));
            if (rms >= gate) {
                if (first < 0) first = start;
                last = start + frameSize;
            }
        }
        if (first < 0) {
            return {
                samples: samples,
                offsetSec: 0,
                speechDur: samples.length / sampleRate,
            };
        }
        const padStart = Math.floor(sampleRate * 0.04);
        const padEnd = Math.floor(sampleRate * 0.14);
        const i0 = Math.max(0, first - padStart);
        const i1 = Math.min(samples.length, last + padEnd);
        const trimmed = samples.subarray(i0, i1);
        return {
            samples: new Float32Array(trimmed),
            offsetSec: i0 / sampleRate,
            speechDur: trimmed.length / sampleRate,
        };
    }

    function shiftWordOffsets(words, offsetSec) {
        if (!words || !words.length || !offsetSec) return words || [];
        const ms = offsetSec * 1000;
        return words
            .map(function (w) {
                if (w.offsetMs == null) return w;
                return { word: w.word, offsetMs: Math.max(0, w.offsetMs - ms) };
            })
            .filter(function (w) {
                return w.offsetMs != null;
            });
    }

    function frameRms(frame) {
        let s = 0;
        for (let i = 0; i < frame.length; i++) {
            s += frame[i] * frame[i];
        }
        return Math.sqrt(s / frame.length);
    }

    function autocorrPitch(frame, sampleRate) {
        const n = frame.length;
        const rms = frameRms(frame);
        if (rms < 0.005) return null;

        const minLag = Math.floor(sampleRate / 500);
        const maxLag = Math.min(Math.floor(sampleRate / 60), Math.floor(n / 2) - 1);
        if (maxLag <= minLag) return null;

        let energy0 = 0;
        for (let i = 0; i < n; i++) {
            energy0 += frame[i] * frame[i];
        }
        if (energy0 < 1e-8) return null;

        let bestLag = -1;
        let bestCorr = 0;

        for (let lag = minLag; lag <= maxLag; lag++) {
            let sum = 0;
            let energyLag = 0;
            for (let i = 0; i < n - lag; i++) {
                sum += frame[i] * frame[i + lag];
                energyLag += frame[i + lag] * frame[i + lag];
            }
            const corr = sum / (Math.sqrt(energy0 * energyLag) + 1e-10);
            if (corr > bestCorr) {
                bestCorr = corr;
                bestLag = lag;
            }
        }
        if (bestLag < 0 || bestCorr < 0.28) return null;
        const hz = sampleRate / bestLag;
        if (hz < 55 || hz > 520) return null;
        return hz;
    }

    function extractPitchContour(samples, sampleRate) {
        const frameSize = 1024;
        const hop = 256;
        const minFrame = 384;
        const points = [];
        for (let start = 0; start < samples.length; start += hop) {
            const end = Math.min(start + frameSize, samples.length);
            const len = end - start;
            if (len < minFrame) break;
            let frame;
            if (len < frameSize) {
                frame = new Float32Array(frameSize);
                frame.set(samples.subarray(start, end));
            } else {
                frame = samples.subarray(start, end);
            }
            const f0 = autocorrPitch(frame, sampleRate);
            const t = (start + len / 2) / sampleRate;
            points.push({ t: t, hz: f0 });
        }
        return points;
    }

    function extractEnvelopeContour(samples, sampleRate) {
        const frameSize = 512;
        const hop = 128;
        const minFrame = 192;
        const rmsList = [];
        for (let start = 0; start < samples.length; start += hop) {
            const end = Math.min(start + frameSize, samples.length);
            const len = end - start;
            if (len < minFrame) break;
            const frame = samples.subarray(start, end);
            rmsList.push({ t: (start + len / 2) / sampleRate, rms: frameRms(frame) });
        }
        if (!rmsList.length) return [];
        const peak = Math.max.apply(
            null,
            rmsList.map(function (p) {
                return p.rms;
            })
        );
        if (peak < 1e-6) return [];
        return rmsList.map(function (p) {
            const norm = p.rms / peak;
            return { t: p.t, semi: norm > 0.02 ? norm * 5 - 2.5 : null };
        });
    }

    function countVoicedSemi(points) {
        let n = 0;
        for (let i = 0; i < points.length; i++) {
            if (points[i].semi != null) n++;
        }
        return n;
    }

    function fillShortGaps(points, maxGapFrames) {
        const out = points.map(function (p) {
            return { t: p.t, semi: p.semi };
        });
        let i = 0;
        while (i < out.length) {
            if (out[i].semi != null) {
                i++;
                continue;
            }
            let j = i;
            while (j < out.length && out[j].semi == null) j++;
            const gap = j - i;
            if (gap > 0 && gap <= maxGapFrames && i > 0 && j < out.length) {
                const a = out[i - 1].semi;
                const b = out[j].semi;
                for (let k = i; k < j; k++) {
                    const f = (k - i + 1) / (gap + 1);
                    out[k].semi = a + (b - a) * f;
                }
            }
            i = j;
        }
        return out;
    }

    function extendPointsToDuration(points, speechDur) {
        if (!points.length || speechDur <= 0) return points;
        let lastSemi = null;
        for (let i = points.length - 1; i >= 0; i--) {
            if (points[i].semi != null) {
                lastSemi = points[i].semi;
                break;
            }
        }
        const out = points.slice();
        const lastT = out[out.length - 1].t;
        if (lastSemi != null && lastT < speechDur - 0.04) {
            out.push({ t: speechDur, semi: lastSemi });
        }
        return out;
    }

    /** 음량은 끝까지, 피치는 잡히는 구간만 — 문장 끝이 비어 보이지 않게 */
    function mergePitchAndEnvelope(pitchPts, envPts, speechDur) {
        const map = new Map();
        envPts.forEach(function (p) {
            if (p.semi == null) return;
            map.set(Math.round(p.t * 250), { t: p.t, semi: p.semi });
        });
        pitchPts.forEach(function (p) {
            if (p.semi == null) return;
            map.set(Math.round(p.t * 250), { t: p.t, semi: p.semi });
        });
        const merged = Array.from(map.values()).sort(function (a, b) {
            return a.t - b.t;
        });
        return extendPointsToDuration(merged, speechDur);
    }

    function interpolateSemi(points, t) {
        if (!points.length) return null;
        if (t <= points[0].t) return points[0].semi;
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const next = points[i];
            if (t <= next.t) {
                if (prev.semi == null) return next.semi;
                if (next.semi == null) return prev.semi;
                if (next.t === prev.t) return next.semi;
                const f = (t - prev.t) / (next.t - prev.t);
                return prev.semi + (next.semi - prev.semi) * f;
            }
        }
        return points[points.length - 1].semi;
    }

    /** 모범 윤곽과 겹침 정도 (0~100). align=true면 길이를 모범에 맞춰 비교 */
    function computeModelSimilarity(modelPts, userPts, refDur, userSpeechDur, align) {
        if (!modelPts.length || !userPts.length || refDur <= 0) return null;
        const hop = 0.03;
        const ms = [];
        const us = [];
        for (let t = 0; t <= refDur + hop * 0.5; t += hop) {
            const tUser =
                align && userSpeechDur > 0 ? t * (userSpeechDur / refDur) : t;
            const m = interpolateSemi(modelPts, t);
            const u = interpolateSemi(userPts, Math.min(tUser, userSpeechDur));
            if (m == null || u == null) continue;
            ms.push(m);
            us.push(u);
        }
        if (ms.length < 5) return null;
        let meanM = 0;
        let meanU = 0;
        for (let i = 0; i < ms.length; i++) {
            meanM += ms[i];
            meanU += us[i];
        }
        meanM /= ms.length;
        meanU /= ms.length;
        let num = 0;
        let denM = 0;
        let denU = 0;
        for (let i = 0; i < ms.length; i++) {
            const dm = ms[i] - meanM;
            const du = us[i] - meanU;
            num += dm * du;
            denM += dm * dm;
            denU += du * du;
        }
        const denom = Math.sqrt(denM * denU);
        if (denom < 1e-8) return null;
        const r = num / denom;
        return Math.round(Math.max(0, Math.min(100, (r + 1) * 50)));
    }

    function formatSimilarityDelta(latestScore, firstScore) {
        if (latestScore == null || firstScore == null) return '';
        const d = latestScore - firstScore;
        const sign = d >= 0 ? '+' : '';
        return sign + d + '%p';
    }

    /** 문장 끝까지 곡선이 이어지게 — 모범 TTS 끝이 평평하게 끊기는 현상 완화 */
    function ensureDenseCoverage(points, speechDur) {
        const hop = 0.03;
        const dense = [];
        let carry = null;
        for (let t = 0; t <= speechDur; t += hop) {
            const v = interpolateSemi(points, t);
            if (v != null) carry = v;
            if (carry == null) continue;
            dense.push({ t: t, semi: carry });
        }
        if (carry != null && (!dense.length || dense[dense.length - 1].t < speechDur - 0.02)) {
            dense.push({ t: speechDur, semi: carry });
        }
        return dense;
    }

    function buildDisplayContour(samples, sampleRate) {
        const speechDur = samples.length / sampleRate;
        const envPts = smoothContour(
            fillShortGaps(extractEnvelopeContour(samples, sampleRate), 20),
            2
        );
        const pitchPts = smoothContour(
            fillShortGaps(contourToSemitones(extractPitchContour(samples, sampleRate)), 20),
            2
        );
        const merged = extendPointsToDuration(
            mergePitchAndEnvelope(pitchPts, envPts, speechDur),
            speechDur
        );
        const dense = ensureDenseCoverage(merged, speechDur);
        const voiced = countVoicedSemi(pitchPts);
        return {
            points: dense,
            mode: voiced >= 6 ? 'pitch' : 'envelope',
        };
    }

    function sortWordsByOffset(words) {
        if (!words || !words.length) return [];
        return words.slice().sort(function (a, b) {
            return (a.offsetMs || 0) - (b.offsetMs || 0);
        });
    }

    function contourToSemitones(points) {
        const voiced = points
            .map(function (p) {
                return p.hz;
            })
            .filter(function (hz) {
                return hz != null && hz > 60 && hz < 500;
            });
        if (!voiced.length) {
            return points.map(function (p) {
                return { t: p.t, semi: null };
            });
        }
        const sorted = voiced.slice().sort(function (a, b) {
            return a - b;
        });
        const refHz = sorted[Math.floor(sorted.length / 2)];
        return points.map(function (p) {
            if (p.hz == null) return { t: p.t, semi: null };
            return { t: p.t, semi: 12 * Math.log2(p.hz / refHz) };
        });
    }

    function smoothContour(points, win) {
        const w = win || 3;
        return points.map(function (p, i) {
            if (p.semi == null) return p;
            let sum = 0;
            let n = 0;
            for (let j = i - w; j <= i + w; j++) {
                if (j >= 0 && j < points.length && points[j].semi != null) {
                    sum += points[j].semi;
                    n++;
                }
            }
            return { t: p.t, semi: n ? sum / n : null };
        });
    }

    async function analyzeUserBlob(blob) {
        const mono = await blobToMono(await blob.arrayBuffer());
        const trim = trimSpeechBounds(mono.samples, mono.sampleRate);
        const ds = downsample(trim.samples, mono.sampleRate, 8000);
        const contour = buildDisplayContour(ds.samples, ds.sampleRate);
        return {
            pts: contour.points,
            speechDur: trim.speechDur,
            playSamples: trim.samples,
            playRate: mono.sampleRate,
            trimOffsetSec: trim.offsetSec,
            mode: contour.mode,
        };
    }

    function buildSvgPaths(modelPts, refSpeechDur, userTracks, words, alignUser, refText) {
        const W = 560;
        const H = 120;
        const pad = { l: 8, r: 8, t: 10, b: 18 };
        const iw = W - pad.l - pad.r;
        const ih = H - pad.t - pad.b;
        const refDur = refSpeechDur || 0.1;
        const latestTrack = userTracks.length ? userTracks[userTracks.length - 1] : null;
        const latestSpeechDur = latestTrack ? latestTrack.speechDur : refDur;
        const sortedWords = filterWordsToStressedOnly(sortWordsByOffset(words), refText || '');

        let axisDur = refDur;
        if (alignUser) {
            axisDur = refDur;
        } else {
            userTracks.forEach(function (tr) {
                axisDur = Math.max(axisDur, tr.speechDur || 0);
            });
            sortedWords.forEach(function (w) {
                if (w.offsetMs != null) {
                    axisDur = Math.max(axisDur, w.offsetMs / 1000 + 0.12);
                }
            });
        }
        axisDur = Math.max(axisDur, 0.1);

        function chartTime(rawSec, speechDurForTrack) {
            if (!alignUser || !speechDurForTrack || speechDurForTrack <= 0) return rawSec;
            return rawSec * (refDur / speechDurForTrack);
        }

        function xAt(t) {
            return pad.l + (Math.min(t, axisDur) / axisDur) * iw;
        }

        function yAt(semi) {
            const clamped = Math.max(-6, Math.min(6, semi));
            return pad.t + ih * (1 - (clamped + 6) / 12);
        }

        function pathFrom(points, speechDurForTrack) {
            const scale = alignUser && speechDurForTrack > 0 ? refDur / speechDurForTrack : 1;
            let d = '';
            let started = false;
            let silentStreak = 0;
            const maxSilent = 20;
            let lastSemi = null;
            points.forEach(function (p) {
                if (p.semi == null) {
                    silentStreak++;
                    if (silentStreak > maxSilent) started = false;
                    return;
                }
                silentStreak = 0;
                lastSemi = p.semi;
                const t = Math.min(p.t * scale, axisDur);
                const x = xAt(t);
                const y = yAt(p.semi);
                d += (started ? ' L' : ' M') + x.toFixed(1) + ' ' + y.toFixed(1);
                started = true;
            });
            return d;
        }

        function hasPath(d) {
            return d && d.indexOf('L') !== -1;
        }

        let wordMarks = '';
        if (sortedWords.length) {
            sortedWords.forEach(function (w) {
                if (w.offsetMs == null) return;
                const t = chartTime(w.offsetMs / 1000, latestSpeechDur);
                if (t > axisDur + 0.05) return;
                const x = xAt(t);
                wordMarks +=
                    '<line class="pitch-word-line" x1="' +
                    x.toFixed(1) +
                    '" y1="' +
                    pad.t +
                    '" x2="' +
                    x.toFixed(1) +
                    '" y2="' +
                    (H - pad.b) +
                    '"/>' +
                    '<text class="pitch-word-label" x="' +
                    x.toFixed(1) +
                    '" y="' +
                    (H - 4) +
                    '" text-anchor="middle">' +
                    escapeHtml(String(w.word || '').slice(0, 8)) +
                    '</text>';
            });
        }

        const modelPath = pathFrom(modelPts, refDur);
        let pathsHtml = '';
        let anyUser = false;
        userTracks.forEach(function (tr) {
            const d = pathFrom(tr.pts, tr.speechDur);
            if (hasPath(d)) {
                anyUser = true;
                pathsHtml +=
                    '<path class="pitch-line ' +
                    tr.lineClass +
                    '" d="' +
                    d +
                    '" fill="none" vector-effect="non-scaling-stroke"/>';
            }
        });

        let emptyHint = '';
        if (!hasPath(modelPath) && !anyUser) {
            emptyHint =
                '<text x="' +
                W / 2 +
                '" y="' +
                (pad.t + ih / 2) +
                '" text-anchor="middle" class="pitch-empty-hint" font-size="11" fill="#94A3B8">곡선을 그리지 못했습니다 · ▶ 재생으로 확인</text>';
        }

        return (
            '<svg class="pitch-chart-svg" viewBox="0 0 ' +
            W +
            ' ' +
            H +
            '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
            '<rect x="' +
            pad.l +
            '" y="' +
            pad.t +
            '" width="' +
            iw +
            '" height="' +
            ih +
            '" fill="#F8FAFC" rx="4"/>' +
            '<line x1="' +
            pad.l +
            '" y1="' +
            (pad.t + ih / 2) +
            '" x2="' +
            (W - pad.r) +
            '" y2="' +
            (pad.t + ih / 2) +
            '" stroke="#E2E8F0" stroke-width="1"/>' +
            wordMarks +
            (modelPath
                ? '<path class="pitch-line pitch-line-ref" d="' + modelPath + '" fill="none" vector-effect="non-scaling-stroke"/>'
                : '') +
            pathsHtml +
            emptyHint +
            '</svg>'
        );
    }

    function buildRhythmNodesSvg(modelPts, refSpeechDur, userTracks, refText, alignUser, showFirst, azureWords) {
        const W = 560;
        const H = 132;
        const pad = { l: 12, r: 12, t: 14, b: 28 };
        const iw = W - pad.l - pad.r;
        const ih = H - pad.t - pad.b;
        const refDur = refSpeechDur || 0.1;
        const beats = buildStressedWordPlan(refText || '', refDur, azureWords);
        const latestTrack = userTracks.length ? userTracks[userTracks.length - 1] : null;
        const firstTrack = userTracks.length > 1 ? userTracks[0] : null;

        function xAt(t) {
            return pad.l + (Math.min(t, refDur) / refDur) * iw;
        }

        function yAt(semi) {
            if (semi == null) return pad.t + ih / 2;
            const clamped = Math.max(-6, Math.min(6, semi));
            return pad.t + ih * (1 - (clamped + 6) / 12);
        }

        let nodesHtml = '';
        let labelsHtml = '';
        beats.forEach(function (beat) {
            const tm = beat.tCenter != null ? beat.tCenter : (beat.t0 + beat.t1) * 0.5;
            const x = xAt(tm);
            const mSemi = sampleSemiAt(modelPts, tm, refDur, false, refDur);
            const rModel = nodeRadiusFromStress(beat.stressScore);
            const yModel = yAt(mSemi);

            nodesHtml +=
                '<circle class="rn-node rn-node-model" cx="' +
                x.toFixed(1) +
                '" cy="' +
                yModel.toFixed(1) +
                '" r="' +
                rModel +
                '"/>';

            if (latestTrack) {
                const uSemi = sampleSemiAt(latestTrack.pts, tm, latestTrack.speechDur, alignUser, refDur);
                const yUser = yAt(uSemi);
                const rUser = Math.max(6, rModel - 2);
                const match =
                    mSemi != null && uSemi != null && Math.abs(mSemi - uSemi) < 1.35;
                if (match) {
                    nodesHtml +=
                        '<circle class="rn-node rn-node-match" cx="' +
                        x.toFixed(1) +
                        '" cy="' +
                        yUser.toFixed(1) +
                        '" r="' +
                        (rUser + 4) +
                        '"/>';
                }
                nodesHtml +=
                    '<circle class="rn-node rn-node-user" cx="' +
                    x.toFixed(1) +
                    '" cy="' +
                    yUser.toFixed(1) +
                    '" r="' +
                    rUser +
                    '"/>';
            }

            if (showFirst && firstTrack && firstTrack.label === 'first') {
                const fSemi = sampleSemiAt(firstTrack.pts, tm, firstTrack.speechDur, alignUser, refDur);
                nodesHtml +=
                    '<circle class="rn-node rn-node-first" cx="' +
                    x.toFixed(1) +
                    '" cy="' +
                    yAt(fSemi).toFixed(1) +
                    '" r="5"/>';
            }

            labelsHtml +=
                '<text class="rn-beat-label" x="' +
                x.toFixed(1) +
                '" y="' +
                (H - 6) +
                '" text-anchor="middle">' +
                beatCircledNum(beat.beatIndex) +
                '</text>';
        });

        return (
            '<svg class="pitch-chart-svg rhythm-nodes-svg" viewBox="0 0 ' +
            W +
            ' ' +
            H +
            '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
            '<rect x="' +
            pad.l +
            '" y="' +
            pad.t +
            '" width="' +
            iw +
            '" height="' +
            ih +
            '" fill="#F8FAFC" rx="6"/>' +
            '<line x1="' +
            pad.l +
            '" y1="' +
            (pad.t + ih / 2) +
            '" x2="' +
            (W - pad.r) +
            '" y2="' +
            (pad.t + ih / 2) +
            '" stroke="#E2E8F0" stroke-width="1"/>' +
            nodesHtml +
            labelsHtml +
            '</svg>'
        );
    }

    function buildChartForSession(session) {
        if (session.chartStyle === CHART_STYLES.line) {
            return buildSvgPaths(
                session.modelPts,
                session.refSpeechDur,
                session.userTracks,
                session.words,
                session.alignUser,
                session.refText
            );
        }
        const tracks = session.showFirstTrack
            ? session.userTracks
            : session.userTracks.filter(function (tr) {
                  return tr.label !== 'first';
              });
        return buildRhythmNodesSvg(
            session.modelPts,
            session.refSpeechDur,
            tracks.length ? tracks : session.userTracks.slice(-1),
            session.refText,
            session.alignUser,
            !!session.showFirstTrack,
            session.words
        );
    }

    async function getModelMp3Blob(refText) {
        if (typeof global.AzureTts === 'undefined' || !global.AzureTts.getModelEnBlob) return null;
        try {
            return await global.AzureTts.getModelEnBlob(refText);
        } catch (e) {
            console.warn('pitch model tts', e);
            return null;
        }
    }

    function fail(error) {
        return { html: '', error: error };
    }

    async function playTrimmedSamples(samples, sampleRate, rate) {
        if (!samples || !samples.length) return;
        if (typeof global.stopAllPlayback === 'function') {
            global.stopAllPlayback();
        } else {
            stopPlayback();
        }
        const ctx = new (global.AudioContext || global.webkitAudioContext)();
        pitchPlayCtx = ctx;
        const buffer = ctx.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples, 0);
        const src = ctx.createBufferSource();
        pitchPlaySource = src;
        src.buffer = buffer;
        src.playbackRate.value = Math.min(2, Math.max(0.5, rate || 1));
        src.connect(ctx.destination);
        src.onended = function () {
            stopPlayback();
        };
        src.start(0);
    }

    function findAzureWordTimeSec(words, clean) {
        const sorted = sortWordsByOffset(words || []);
        let i;
        for (i = 0; i < sorted.length; i++) {
            if (cleanAzureWord(sorted[i].word) === clean && sorted[i].offsetMs != null) {
                return sorted[i].offsetMs / 1000;
            }
        }
        return null;
    }

    /** 슬롯별 리듬 교정 (한글 코칭) */
    function evaluateStressSlots(plan, modelPts, userPts, refDur, userDur, alignUser, azureWords) {
        return (plan || []).map(function (slot) {
            const tm = slot.tCenter != null ? slot.tCenter : (slot.t0 + slot.t1) * 0.5;
            const mSemi = sampleSemiAt(modelPts, tm, refDur, false, refDur);
            const uSemi = sampleSemiAt(userPts, tm, userDur, alignUser, refDur);
            const userWordT = findAzureWordTimeSec(azureWords, slot.clean);
            let status = 'ok';
            let hintKo = 'OK';

            if (mSemi == null || uSemi == null) {
                status = 'weak';
                hintKo = (slot.word || '이 박자') + ' — 소리가 잘 안 잡혔어요. 다시 크게 말해 보세요';
            } else {
                const diff = uSemi - mSemi;
                if (userWordT != null && userWordT > tm + 0.28) {
                    status = 'late';
                    hintKo = (slot.word || '이 박자') + ' — 강세가 늦어요 · 더 앞에서 박';
                } else if (diff < -1.15) {
                    status = 'low';
                    hintKo = (slot.word || '여기') + ' — 톤을 더 올려 보세요';
                } else if (diff > 1.45) {
                    status = 'high';
                    hintKo = (slot.word || '여기') + ' — 톤이 너무 높아요 · 조금만 낮추기';
                } else if (Math.abs(diff) <= 1.35) {
                    status = 'ok';
                    hintKo = 'OK';
                } else {
                    status = 'weak';
                    hintKo = (slot.word || '이 박자') + ' — 모범과 리듬을 맞춰 보세요';
                }
            }

            return Object.assign({}, slot, {
                status: status,
                hintKo: hintKo,
                modelSemi: mSemi,
                userSemi: uSemi,
                userWordT: userWordT,
            });
        });
    }

    async function analyzePitchPair(opts) {
        opts = opts || {};
        const userWavBlob = opts.userWavBlob;
        const refText = String(opts.refText || '').trim();
        if (!userWavBlob || !refText) return fail('no_input');

        const modelBlob = await getModelMp3Blob(refText);
        if (!modelBlob) return fail('no_model_tts');

        const modelMono = await blobToMono(await modelBlob.arrayBuffer());
        const modelTrim = trimSpeechBounds(modelMono.samples, modelMono.sampleRate);
        const modelDs = downsample(modelTrim.samples, modelMono.sampleRate, 8000);
        const modelContour = buildDisplayContour(modelDs.samples, modelDs.sampleRate);
        const modelPts = modelContour.points;
        const refDur = modelTrim.speechDur;

        const latestData = await analyzeUserBlob(userWavBlob);
        const userDur = latestData.speechDur;
        if (refDur < 0.25 || userDur < 0.25) return fail('too_short');

        const shiftedWords = sortWordsByOffset(
            shiftWordOffsets(opts.words || [], latestData.trimOffsetSec)
        );
        const plan = buildStressedWordPlan(refText, refDur, shiftedWords);
        const alignCompare = true;
        const slots = evaluateStressSlots(
            plan,
            modelPts,
            latestData.pts,
            refDur,
            userDur,
            alignCompare,
            shiftedWords
        );

        plan = alignPlanToEnvelope(plan, modelTrim.samples, modelMono.sampleRate, refDur);

        let rhythmNotes = null;
        if (global.RhythmNotesBuilder && global.RhythmNotesBuilder.buildRhythmNotes) {
            rhythmNotes = global.RhythmNotesBuilder.buildRhythmNotes({
                refText: refText,
                refDur: refDur,
                plan: plan,
                modelPts: modelPts,
                slots: slots,
                azureWords: shiftedWords,
            });
        }

        return {
            error: null,
            refText: refText,
            refDur: refDur,
            userDur: userDur,
            modelPts: modelPts,
            userPts: latestData.pts,
            plan: plan,
            slots: slots,
            rhythmNotes: rhythmNotes,
            words: shiftedWords,
            alignUser: alignCompare,
            latestSimilarity: computeModelSimilarity(
                modelPts,
                latestData.pts,
                refDur,
                userDur,
                alignCompare
            ),
        };
    }

    async function buildCompareBlock(opts) {
        opts = opts || {};
        const userWavBlob = opts.userWavBlob;
        const firstUserWavBlob = opts.firstUserWavBlob || null;
        const refText = String(opts.refText || '').trim();
        if (!userWavBlob || !refText) return fail('no_input');

        const modelBlob = await getModelMp3Blob(refText);
        if (!modelBlob) return fail('no_model_tts');

        const modelMono = await blobToMono(await modelBlob.arrayBuffer());
        const modelTrim = trimSpeechBounds(modelMono.samples, modelMono.sampleRate);
        const modelDs = downsample(modelTrim.samples, modelMono.sampleRate, 8000);
        const modelContour = buildDisplayContour(modelDs.samples, modelDs.sampleRate);
        const modelPts = modelContour.points;
        const refDur = modelTrim.speechDur;

        const latestData = await analyzeUserBlob(userWavBlob);
        let firstData = null;
        if (firstUserWavBlob) {
            firstData = await analyzeUserBlob(firstUserWavBlob);
        }

        const userDur = latestData.speechDur;
        if (refDur < 0.25 || userDur < 0.25) return fail('too_short');

        const ratio = userDur / refDur;
        const useEnvelope =
            modelContour.mode === 'envelope' ||
            latestData.mode === 'envelope' ||
            (firstData && firstData.mode === 'envelope');
        const shiftedWords = sortWordsByOffset(
            shiftWordOffsets(opts.words || [], latestData.trimOffsetSec)
        );
        const trimNote =
            latestData.trimOffsetSec > 0.08
                ? ' · 앞 무음 ' + latestData.trimOffsetSec.toFixed(1) + 's 제거'
                : '';

        const alignCompare = true;
        const latestSimilarity = computeModelSimilarity(
            modelPts,
            latestData.pts,
            refDur,
            userDur,
            alignCompare
        );
        const firstSimilarity = firstData
            ? computeModelSimilarity(
                  modelPts,
                  firstData.pts,
                  refDur,
                  firstData.speechDur,
                  alignCompare
              )
            : null;
        const similarityDelta =
            latestSimilarity != null && firstSimilarity != null
                ? formatSimilarityDelta(latestSimilarity, firstSimilarity)
                : '';

        const userTracks = [];
        if (firstData) {
            userTracks.push({
                pts: firstData.pts,
                speechDur: firstData.speechDur,
                lineClass: 'pitch-line-first',
                label: 'first',
            });
        }
        userTracks.push({
            pts: latestData.pts,
            speechDur: latestData.speechDur,
            lineClass: 'pitch-line-user',
            label: 'latest',
        });

        const chartStyle = getPitchChartStyle();
        const isRhythm = chartStyle === CHART_STYLES['rhythm-nodes'];

        const id = 'pc' + ++sessionSeq;
        sessions[id] = {
            modelPlaySamples: modelTrim.samples,
            modelPlayRate: modelMono.sampleRate,
            latestPlaySamples: latestData.playSamples,
            latestPlayRate: latestData.playRate,
            firstPlaySamples: firstData ? firstData.playSamples : null,
            firstPlayRate: firstData ? firstData.playRate : 0,
            hasFirst: !!firstData,
            modelPts: modelPts,
            userTracks: userTracks,
            refSpeechDur: refDur,
            latestSpeechDur: userDur,
            firstSpeechDur: firstData ? firstData.speechDur : 0,
            words: shiftedWords,
            alignUser: true,
            chartStyle: chartStyle,
            refText: refText,
            showFirstTrack: !isRhythm && !!firstData,
        };

        const svg = buildChartForSession(sessions[id]);

        const firstMeta =
            firstData && (!isRhythm || sessions[id].showFirstTrack)
                ? ' · 최초 ' + firstData.speechDur.toFixed(1) + 's'
                : '';
        const legendFirst =
            firstData && sessions[id].showFirstTrack
                ? isRhythm
                    ? '<span class="pitch-legend-first">○ 최초</span>'
                    : '<span class="pitch-legend-first">╌ 최초</span>'
                : '';
        const btnFirst =
            firstData && sessions[id].showFirstTrack
                ? '<button type="button" class="pitch-play-first">▶ 최초</button>'
                : '';

        let scoreHtml = '';
        if (latestSimilarity != null) {
            scoreHtml =
                '<div class="pitch-score-row">' +
                '<span class="pitch-score-item">모범 유사도 <strong class="pitch-score-val">' +
                latestSimilarity +
                '%</strong></span>';
            if (similarityDelta) {
                const deltaClass =
                    latestSimilarity >= (firstSimilarity || 0) ? 'pitch-delta-up' : 'pitch-delta-down';
                scoreHtml +=
                    '<span class="pitch-score-item ' +
                    deltaClass +
                    '">최초 대비 <strong class="pitch-score-val">' +
                    similarityDelta +
                    '</strong></span>';
            }
            if (firstSimilarity != null) {
                scoreHtml +=
                    '<span class="pitch-score-item pitch-score-first-ref">최초 ' +
                    firstSimilarity +
                    '%</span>';
            }
            scoreHtml += '</div>';
        }

        const chartTitle = isRhythm
            ? '모범 vs 내 녹음 · 리듬 노드'
            : '모범 vs 내 녹음 · 피치 (최초·최근 겹침)';
        const legendHtml = isRhythm
            ? '<span class="pitch-legend-ref">● 모범</span>' +
              legendFirst +
              '<span class="pitch-legend-user">● 최근</span>' +
              '<span class="pitch-legend-match">◎ 일치</span>'
            : '<span class="pitch-legend-ref">━ 모범</span>' +
              legendFirst +
              '<span class="pitch-legend-user">━ 최근</span>';
        const showFirstCheck =
            isRhythm && firstData
                ? '<label class="pitch-align-label"><input type="checkbox" class="pitch-show-first-check" /> 최초 녹음 노드 표시</label>'
                : '';
        const alignLabel = isRhythm
            ? '길이를 모범에 맞춤'
            : '윤곽 맞춤 (길이를 모범에 맞춤)';

        return {
            html:
                '<div class="pitch-compare' +
                (isRhythm ? ' pitch-compare-rhythm' : '') +
                '" data-pitch-id="' +
                escapeHtml(id) +
                '">' +
                '<div class="pitch-compare-title">' +
                chartTitle +
                '</div>' +
                scoreHtml +
                '<div class="pitch-compare-meta">' +
                '모범 ' +
                refDur.toFixed(1) +
                's · 최근 ' +
                userDur.toFixed(1) +
                's' +
                firstMeta +
                (useEnvelope && !isRhythm ? ' · <span class="pitch-mode-tag">음량 윤곽</span>' : '') +
                (isRhythm ? ' · 강세 단어만 ①②③' : ' · 강세 단어 라벨만') +
                '</div>' +
                '<div class="pitch-chart-wrap">' +
                svg +
                '</div>' +
                '<div class="pitch-legend">' +
                legendHtml +
                '</div>' +
                '<div class="pitch-controls">' +
                showFirstCheck +
                '<label class="pitch-align-label"><input type="checkbox" class="pitch-align-check" checked /> ' +
                alignLabel +
                '</label>' +
                '<div class="pitch-play-row">' +
                '<button type="button" class="pitch-play-ref">▶ 모범</button>' +
                btnFirst +
                '<button type="button" class="pitch-play-user">▶ 최근</button>' +
                '</div>' +
                '</div>' +
                '</div>',
            error: null,
        };
    }

    function redrawChart(root, session) {
        const wrap = root.querySelector('.pitch-chart-wrap');
        if (!wrap) return;
        wrap.innerHTML = buildChartForSession(session);
    }

    function bind(root) {
        if (!root) return;
        const el = root.querySelector ? root.querySelector('.pitch-compare') : null;
        if (!el) return;
        const id = el.getAttribute('data-pitch-id');
        const session = sessions[id];
        if (!session) return;

        const alignCheck = el.querySelector('.pitch-align-check');
        const showFirstCheck = el.querySelector('.pitch-show-first-check');
        const btnRef = el.querySelector('.pitch-play-ref');
        const btnUser = el.querySelector('.pitch-play-user');
        const btnFirst = el.querySelector('.pitch-play-first');

        if (showFirstCheck) {
            showFirstCheck.checked = !!session.showFirstTrack;
            showFirstCheck.onchange = function () {
                session.showFirstTrack = !!showFirstCheck.checked;
                redrawChart(el, session);
            };
        }

        if (alignCheck) {
            alignCheck.checked = !!session.alignUser;
            alignCheck.onchange = function () {
                session.alignUser = !!alignCheck.checked;
                redrawChart(el, session);
            };
        }
        /* 모범: TTS가 설정 속도로 이미 합성됨 → 1.0×. 최근/최초: 원속 녹음 → 1.0× */
        if (btnRef) {
            btnRef.onclick = function () {
                playTrimmedSamples(session.modelPlaySamples, session.modelPlayRate, 1);
            };
        }
        if (btnUser) {
            btnUser.onclick = function () {
                playTrimmedSamples(session.latestPlaySamples, session.latestPlayRate, 1);
            };
        }
        if (btnFirst && session.firstPlaySamples) {
            btnFirst.onclick = function () {
                playTrimmedSamples(session.firstPlaySamples, session.firstPlayRate, 1);
            };
        }
    }

    global.PitchCompare = {
        CHART_STYLES: CHART_STYLES,
        getPitchChartStyle: getPitchChartStyle,
        buildStressedWordPlan: buildStressedWordPlan,
        buildModelListenTiming: buildModelListenTiming,
        alignPlanToEnvelope: alignPlanToEnvelope,
        evaluateStressSlots: evaluateStressSlots,
        analyzePitchPair: analyzePitchPair,
        buildCompareBlock: buildCompareBlock,
        sampleSemiAt: sampleSemiAt,
        bind: bind,
        stopPlayback: stopPlayback,
    };
})(window);
