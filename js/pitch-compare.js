/**
 * 모범 TTS vs 내 녹음 — 피치 곡선 겹침 + 재생 속도 슬라이더
 */
(function (global) {
    const sessions = {};
    let sessionSeq = 0;

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    function autocorrPitch(frame, sampleRate) {
        const n = frame.length;
        let rms = 0;
        for (let i = 0; i < n; i++) {
            rms += frame[i] * frame[i];
        }
        rms = Math.sqrt(rms / n);
        if (rms < 0.012) return null;

        const minLag = Math.floor(sampleRate / 450);
        const maxLag = Math.min(Math.floor(sampleRate / 70), Math.floor(n / 2));
        let bestLag = -1;
        let bestCorr = 0;

        for (let lag = minLag; lag <= maxLag; lag++) {
            let sum = 0;
            for (let i = 0; i < n - lag; i++) {
                sum += frame[i] * frame[i + lag];
            }
            const corr = sum / (n - lag);
            if (corr > bestCorr) {
                bestCorr = corr;
                bestLag = lag;
            }
        }
        if (bestLag < 0 || bestCorr < 0.2) return null;
        return sampleRate / bestLag;
    }

    function extractPitchContour(samples, sampleRate) {
        const frameSize = 1024;
        const hop = 256;
        const points = [];
        for (let start = 0; start + frameSize < samples.length; start += hop) {
            const frame = samples.subarray(start, start + frameSize);
            const f0 = autocorrPitch(frame, sampleRate);
            const t = (start + frameSize / 2) / sampleRate;
            points.push({ t: t, hz: f0 });
        }
        return points;
    }

    function contourToSemitones(points) {
        const voiced = points.map(function (p) {
            return p.hz;
        }).filter(function (hz) {
            return hz != null && hz > 60 && hz < 500;
        });
        if (!voiced.length) return points.map(function (p) {
            return { t: p.t, semi: null };
        });
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

    function durationSec(points) {
        if (!points.length) return 0;
        return points[points.length - 1].t;
    }

    function buildSvgPaths(modelPts, userPts, totalSec, words, alignUser) {
        const W = 560;
        const H = 100;
        const pad = { l: 8, r: 8, t: 10, b: 18 };
        const iw = W - pad.l - pad.r;
        const ih = H - pad.t - pad.b;
        const refDur = durationSec(modelPts) || totalSec;
        const userDur = durationSec(userPts) || totalSec;
        const axisDur = Math.max(refDur, userDur, 0.1);

        function xAt(t, dur) {
            return pad.l + (t / axisDur) * iw;
        }

        function yAt(semi) {
            const clamped = Math.max(-6, Math.min(6, semi));
            return pad.t + ih * (1 - (clamped + 6) / 12);
        }

        function pathFrom(points, dur, stretch) {
            const scale = stretch && userDur > 0 ? refDur / userDur : 1;
            let d = '';
            let started = false;
            points.forEach(function (p) {
                if (p.semi == null) {
                    started = false;
                    return;
                }
                const t = p.t * scale;
                const x = xAt(t, dur);
                const y = yAt(p.semi);
                d += (started ? ' L' : ' M') + x.toFixed(1) + ' ' + y.toFixed(1);
                started = true;
            });
            return d;
        }

        let wordMarks = '';
        if (words && words.length) {
            words.forEach(function (w) {
                if (w.offsetMs == null) return;
                const x = xAt(w.offsetMs / 1000, axisDur);
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

        const modelPath = pathFrom(modelPts, refDur, false);
        const userPath = pathFrom(userPts, userDur, alignUser);

        return (
            '<svg class="pitch-chart-svg" viewBox="0 0 ' +
            W +
            ' ' +
            H +
            '" preserveAspectRatio="none" aria-hidden="true">' +
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
                ? '<path class="pitch-line pitch-line-ref" d="' + modelPath + '" fill="none"/>'
                : '') +
            (userPath
                ? '<path class="pitch-line pitch-line-user" d="' + userPath + '" fill="none"/>'
                : '') +
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

    async function buildCompareBlock(opts) {
        opts = opts || {};
        const userWavBlob = opts.userWavBlob;
        const refText = String(opts.refText || '').trim();
        if (!userWavBlob || !refText) return '';

        const modelBlob = await getModelMp3Blob(refText);
        if (!modelBlob) return '';

        const [userMono, modelMono] = await Promise.all([
            blobToMono(await userWavBlob.arrayBuffer()),
            blobToMono(await modelBlob.arrayBuffer()),
        ]);

        const userDs = downsample(userMono.samples, userMono.sampleRate, 8000);
        const modelDs = downsample(modelMono.samples, modelMono.sampleRate, 8000);

        let modelPts = smoothContour(contourToSemitones(extractPitchContour(modelDs.samples, modelDs.sampleRate)));
        let userPts = smoothContour(contourToSemitones(extractPitchContour(userDs.samples, userDs.sampleRate)));

        const refDur = durationSec(modelPts);
        const userDur = durationSec(userPts);
        if (refDur < 0.3 || userDur < 0.3) return '';

        const ratio = userDur / refDur;
        const id = 'pc' + ++sessionSeq;
        sessions[id] = {
            modelBlob: modelBlob,
            userBlob: userWavBlob,
            modelPts: modelPts,
            userPts: userPts,
            refDur: refDur,
            userDur: userDur,
            words: opts.words || [],
            alignUser: false,
        };

        const svg = buildSvgPaths(modelPts, userPts, Math.max(refDur, userDur), sessions[id].words, false);

        return (
            '<div class="pitch-compare" data-pitch-id="' +
            escapeHtml(id) +
            '">' +
            '<div class="pitch-compare-title">피치 비교 · 모범(파랑) vs 내 말(주황)</div>' +
            '<div class="pitch-compare-meta">' +
            '모범 ' +
            refDur.toFixed(1) +
            's · 내 말 ' +
            userDur.toFixed(1) +
            's' +
            (ratio > 1.05 ? ' · 내 말이 ' + ratio.toFixed(2) + '× 길음' : ratio < 0.95 ? ' · 내 말이 ' + (1 / ratio).toFixed(2) + '× 빠름' : '') +
            '</div>' +
            '<div class="pitch-chart-wrap">' +
            svg +
            '</div>' +
            '<div class="pitch-legend">' +
            '<span class="pitch-legend-ref">━ 모범</span>' +
            '<span class="pitch-legend-user">━ 내 말</span>' +
            '</div>' +
            '<div class="pitch-controls">' +
            '<label class="pitch-slider-label">내 말 재생 속도 <input type="range" class="pitch-rate-slider" min="0.5" max="1.5" step="0.05" value="1" /> <span class="pitch-rate-val">1.0×</span></label>' +
            '<label class="pitch-align-label"><input type="checkbox" class="pitch-align-check" /> 윤곽 맞춤 (내 말 시간만 모범 길이에 맞춤)</label>' +
            '<div class="pitch-play-row">' +
            '<button type="button" class="pitch-play-ref">▶ 모범</button>' +
            '<button type="button" class="pitch-play-user">▶ 내 말</button>' +
            '</div>' +
            '</div>' +
            '</div>'
        );
    }

    function playBlob(blob, rate) {
        if (!blob || typeof global.stopAllPlayback !== 'function') return;
        global.stopAllPlayback();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = rate || 1;
        if (typeof global.registerActiveAudio === 'function') {
            global.registerActiveAudio(audio);
        }
        audio.onended = function () {
            URL.revokeObjectURL(url);
        };
        audio.onerror = function () {
            URL.revokeObjectURL(url);
        };
        audio.play().catch(function () {
            URL.revokeObjectURL(url);
        });
    }

    function redrawChart(root, session) {
        const wrap = root.querySelector('.pitch-chart-wrap');
        if (!wrap) return;
        wrap.innerHTML = buildSvgPaths(
            session.modelPts,
            session.userPts,
            Math.max(session.refDur, session.userDur),
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

        if (slider && rateVal) {
            slider.oninput = function () {
                rateVal.textContent = parseFloat(slider.value).toFixed(2) + '×';
            };
        }
        if (alignCheck) {
            alignCheck.onchange = function () {
                session.alignUser = !!alignCheck.checked;
                redrawChart(el, session);
            };
        }
        if (btnRef) {
            btnRef.onclick = function () {
                playBlob(session.modelBlob, 1);
            };
        }
        if (btnUser) {
            btnUser.onclick = function () {
                const rate = slider ? parseFloat(slider.value) || 1 : 1;
                playBlob(session.userBlob, rate);
            };
        }
    }

    global.PitchCompare = {
        buildCompareBlock: buildCompareBlock,
        bind: bind,
    };
})(window);
