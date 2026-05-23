/**
 * 모범 TTS vs 내 녹음 — 피치 곡선 겹침 + 재생 속도 슬라이더
 * · 앞뒤 무음 자동 트림 후 비교 · Web Audio 재생 속도
 */
(function (global) {
    const sessions = {};
    let sessionSeq = 0;
    let pitchPlayCtx = null;
    let pitchPlaySource = null;

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

    function buildSvgPaths(modelPts, refSpeechDur, userTracks, words, alignUser) {
        const W = 560;
        const H = 120;
        const pad = { l: 8, r: 8, t: 10, b: 18 };
        const iw = W - pad.l - pad.r;
        const ih = H - pad.t - pad.b;
        const refDur = refSpeechDur || 0.1;
        const latestTrack = userTracks.length ? userTracks[userTracks.length - 1] : null;
        const latestSpeechDur = latestTrack ? latestTrack.speechDur : refDur;
        const sortedWords = sortWordsByOffset(words);

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

    function suggestPlaybackRate(refDur, userDur) {
        if (!userDur || userDur < 0.2) return 1;
        return Math.min(1.5, Math.max(0.5, refDur / userDur));
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
        const suggestRate = suggestPlaybackRate(refDur, userDur);
        const shiftedWords = sortWordsByOffset(
            shiftWordOffsets(opts.words || [], latestData.trimOffsetSec)
        );
        const trimNote =
            latestData.trimOffsetSec > 0.08
                ? ' · 앞 무음 ' + latestData.trimOffsetSec.toFixed(1) + 's 제거'
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
            suggestRate: suggestRate,
            playbackRateDefault: 1,
        };

        const svg = buildSvgPaths(modelPts, refDur, userTracks, shiftedWords, true);

        const firstMeta = firstData
            ? ' · 최초 ' + firstData.speechDur.toFixed(1) + 's'
            : '';
        const legendFirst = firstData
            ? '<span class="pitch-legend-first">╌ 최초</span>'
            : '';
        const btnFirst = firstData
            ? '<button type="button" class="pitch-play-first">▶ 최초</button>'
            : '';

        return {
            html:
                '<div class="pitch-compare" data-pitch-id="' +
                escapeHtml(id) +
                '">' +
                '<div class="pitch-compare-title">모범 vs 내 녹음 · 피치 (최초·최근 겹침)</div>' +
                '<div class="pitch-compare-meta">' +
                '말한 구간 · 모범 ' +
                refDur.toFixed(1) +
                's · 최근 ' +
                userDur.toFixed(1) +
                's' +
                firstMeta +
                (ratio > 1.05 ? ' · 최근이 ' + ratio.toFixed(2) + '× 길음' : ratio < 0.95 ? ' · 최근이 ' + (1 / ratio).toFixed(2) + '× 빠름' : '') +
                trimNote +
                (useEnvelope ? ' · <span class="pitch-mode-tag">음량 윤곽</span>' : '') +
                '</div>' +
                '<div class="pitch-chart-wrap">' +
                svg +
                '</div>' +
                '<div class="pitch-legend">' +
                '<span class="pitch-legend-ref">━ 모범</span>' +
                legendFirst +
                '<span class="pitch-legend-user">━ 최근</span>' +
                '</div>' +
                '<div class="pitch-controls">' +
                '<label class="pitch-slider-label">최근 말 느리게/빠르게 <input type="range" class="pitch-rate-slider" min="0.5" max="1.5" step="0.05" value="1" /> <span class="pitch-rate-val">1.0×</span>' +
                (Math.abs(suggestRate - 1) > 0.08
                    ? ' <span class="pitch-slider-hint">(▶ 최근 = 실제 속도 1.0× · 차트 길이 맞춤은 ' +
                      suggestRate.toFixed(2) +
                      '×)</span>'
                    : ' <span class="pitch-slider-hint">(▶ 최근 = 실제 녹음 속도)</span>') +
                '</label>' +
                '<label class="pitch-align-label"><input type="checkbox" class="pitch-align-check" checked /> 윤곽 맞춤 (길이를 모범에 맞춤)</label>' +
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
        wrap.innerHTML = buildSvgPaths(
            session.modelPts,
            session.refSpeechDur,
            session.userTracks,
            session.words,
            session.alignUser
        );
    }

    function bind(root) {
        if (!root) return;
        const el = root.querySelector ? root.querySelector('.pitch-compare') : null;
        if (!el) return;
        const id = el.getAttribute('data-pitch-id');
        const session = sessions[id];
        if (!session) return;

        const slider = el.querySelector('.pitch-rate-slider');
        const rateVal = el.querySelector('.pitch-rate-val');
        const alignCheck = el.querySelector('.pitch-align-check');
        const btnRef = el.querySelector('.pitch-play-ref');
        const btnUser = el.querySelector('.pitch-play-user');
        const btnFirst = el.querySelector('.pitch-play-first');

        function currentRate() {
            return slider ? parseFloat(slider.value) || 1 : session.playbackRateDefault || 1;
        }

        if (slider && rateVal) {
            slider.value = String(session.playbackRateDefault || 1);
            rateVal.textContent = currentRate().toFixed(2) + '×';
            slider.oninput = function () {
                rateVal.textContent = currentRate().toFixed(2) + '×';
            };
        }
        if (alignCheck) {
            alignCheck.checked = !!session.alignUser;
            alignCheck.onchange = function () {
                session.alignUser = !!alignCheck.checked;
                redrawChart(el, session);
            };
        }
        if (btnRef) {
            btnRef.onclick = function () {
                playTrimmedSamples(session.modelPlaySamples, session.modelPlayRate, 1);
            };
        }
        if (btnUser) {
            btnUser.onclick = function () {
                const rate = currentRate();
                playTrimmedSamples(session.latestPlaySamples, session.latestPlayRate, rate);
            };
        }
        if (btnFirst && session.firstPlaySamples) {
            btnFirst.onclick = function () {
                playTrimmedSamples(session.firstPlaySamples, session.firstPlayRate, 1);
            };
        }
    }

    global.PitchCompare = {
        buildCompareBlock: buildCompareBlock,
        bind: bind,
        stopPlayback: stopPlayback,
    };
})(window);
