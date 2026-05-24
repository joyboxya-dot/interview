/**
 * 브라우저 녹음(webm 등) → Azure Short Audio용 WAV PCM 16kHz mono
 */
(function (global) {
    const TARGET_RATE = 16000;

    function encodeWavPcm16(samples, sampleRate) {
        const numChannels = 1;
        const bytesPerSample = 2;
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = samples.length * bytesPerSample;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        function writeStr(offset, str) {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        }

        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);
        writeStr(36, 'data');
        view.setUint32(40, dataSize, true);

        let o = 44;
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            o += 2;
        }
        return new Blob([buffer], { type: 'audio/wav' });
    }

    function mixToMono(buffer) {
        if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
        const len = buffer.length;
        const out = new Float32Array(len);
        for (let c = 0; c < buffer.numberOfChannels; c++) {
            const ch = buffer.getChannelData(c);
            for (let i = 0; i < len; i++) out[i] += ch[i] / buffer.numberOfChannels;
        }
        return out;
    }

    function resampleFloat(samples, fromRate, toRate) {
        if (fromRate === toRate) return samples;
        const ratio = fromRate / toRate;
        const newLen = Math.round(samples.length / ratio);
        const out = new Float32Array(newLen);
        for (let i = 0; i < newLen; i++) {
            const src = i * ratio;
            const idx = Math.floor(src);
            const frac = src - idx;
            const a = samples[idx] || 0;
            const b = samples[idx + 1] || a;
            out[i] = a + (b - a) * frac;
        }
        return out;
    }

    async function decodeBlobToBuffer(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        try {
            return await ctx.decodeAudioData(arrayBuffer.slice(0));
        } finally {
            try { await ctx.close(); } catch (e) {}
        }
    }

    async function audioBufferTo16kWavBlob(buffer) {
        const mono = mixToMono(buffer);
        const resampled = resampleFloat(mono, buffer.sampleRate, TARGET_RATE);
        return encodeWavPcm16(resampled, TARGET_RATE);
    }

    async function blobTo16kMonoWav(blob) {
        if (!blob || !blob.size) throw new Error('empty_audio');
        if (blob.type && blob.type.indexOf('wav') !== -1) return blob;
        const audioBuffer = await decodeBlobToBuffer(blob);
        return audioBufferTo16kWavBlob(audioBuffer);
    }

    function getWavDurationSec(wavBlob) {
        return wavBlob.arrayBuffer().then(function (ab) {
            const view = new DataView(ab);
            if (ab.byteLength < 44) return 0;
            if (String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)) !== 'WAVE') {
                return 0;
            }
            const byteRate = view.getUint32(28, true);
            const dataSize = view.getUint32(40, true);
            if (!byteRate) return 0;
            return dataSize / byteRate;
        });
    }

    async function trimWavToMaxSeconds(wavBlob, maxSec) {
        const ab = await wavBlob.arrayBuffer();
        const view = new DataView(ab);
        if (ab.byteLength < 44) return wavBlob;
        const sampleRate = view.getUint32(24, true);
        const byteRate = view.getUint32(28, true);
        const dataSize = view.getUint32(40, true);
        const maxDataBytes = Math.floor(byteRate * maxSec);
        if (dataSize <= maxDataBytes) return wavBlob;

        const newDataSize = maxDataBytes - (maxDataBytes % 2);
        const newSize = 44 + newDataSize;
        const out = new ArrayBuffer(newSize);
        const outView = new DataView(out);
        const srcBytes = new Uint8Array(ab);
        const dstBytes = new Uint8Array(out);
        dstBytes.set(srcBytes.slice(0, 44));
        outView.setUint32(4, 36 + newDataSize, true);
        outView.setUint32(40, newDataSize, true);
        dstBytes.set(srcBytes.slice(44, 44 + newDataSize), 44);
        return new Blob([out], { type: 'audio/wav' });
    }

    function readWavPcm16(ab) {
        const view = new DataView(ab);
        if (ab.byteLength < 44) return null;
        if (
            String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)) !==
            'WAVE'
        ) {
            return null;
        }
        const sampleRate = view.getUint32(24, true);
        const dataSize = view.getUint32(40, true);
        const numSamples = Math.floor(dataSize / 2);
        const samples = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            samples[i] = view.getInt16(44 + i * 2, true) / 32768;
        }
        return { samples: samples, sampleRate: sampleRate, dataSize: dataSize };
    }

    function frameRms(samples, start, frameSize) {
        let sum = 0;
        const end = Math.min(start + frameSize, samples.length);
        const n = end - start;
        if (n <= 0) return 0;
        for (let i = start; i < end; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / n);
    }

    /** 말소리 시작 전까지(무음·키 클릭)만 제거 — 고정 N초 자르지 않음 */
    function findLeadingSpeechSample(samples, sampleRate, opts) {
        opts = opts || {};
        const frameSize = Math.max(64, Math.floor(sampleRate * 0.02));
        const hop = Math.max(16, Math.floor(sampleRate * 0.005));
        const gate = opts.gate != null ? opts.gate : 0.01;
        const needFrames = opts.needFrames != null ? opts.needFrames : 4;

        let streak = 0;
        let onset = -1;
        for (let start = 0; start + frameSize <= samples.length; start += hop) {
            const rms = frameRms(samples, start, frameSize);
            if (rms >= gate) {
                if (streak === 0) onset = start;
                streak++;
                if (streak >= needFrames) {
                    return onset;
                }
            } else {
                streak = 0;
                onset = -1;
            }
        }
        return -1;
    }

    function sliceWavFromSample(ab, skipSamples) {
        const view = new DataView(ab);
        const byteRate = view.getUint32(28, true);
        const dataSize = view.getUint32(40, true);
        let skipBytes = skipSamples * 2;
        skipBytes -= skipBytes % 2;
        if (skipBytes <= 0) return { blob: new Blob([ab], { type: 'audio/wav' }), trimmedSec: 0 };
        if (skipBytes >= dataSize - 64) {
            return { blob: new Blob([ab], { type: 'audio/wav' }), trimmedSec: 0 };
        }
        const newDataSize = dataSize - skipBytes;
        const out = new ArrayBuffer(44 + newDataSize);
        const outView = new DataView(out);
        const srcBytes = new Uint8Array(ab);
        const dstBytes = new Uint8Array(out);
        dstBytes.set(srcBytes.slice(0, 44));
        outView.setUint32(4, 36 + newDataSize, true);
        outView.setUint32(40, newDataSize, true);
        dstBytes.set(srcBytes.slice(44 + skipBytes, 44 + dataSize), 44);
        return { blob: new Blob([out], { type: 'audio/wav' }), trimmedSec: skipBytes / byteRate };
    }

    /**
     * 앞쪽 무음·키 소리만 제거 (말하기 시작 직전까지).
     * @returns {Promise<{blob: Blob, trimmedSec: number}>}
     */
    async function trimWavLeadingSilence(wavBlob, options) {
        options = options || {};
        const maxTrimSec = options.maxTrimSec != null ? options.maxTrimSec : 1.2;
        const padBeforeSpeechSec = options.padBeforeSpeechSec != null ? options.padBeforeSpeechSec : 0.03;
        const fallbackTrimSec = options.fallbackTrimSec != null ? options.fallbackTrimSec : 0.12;

        const ab = await wavBlob.arrayBuffer();
        const pcm = readWavPcm16(ab);
        if (!pcm || !pcm.samples.length) {
            return { blob: wavBlob, trimmedSec: 0 };
        }

        const speechOnset = findLeadingSpeechSample(pcm.samples, pcm.sampleRate, options);
        let skipSamples = 0;

        if (speechOnset > 0) {
            skipSamples = Math.max(
                0,
                speechOnset - Math.floor(pcm.sampleRate * padBeforeSpeechSec)
            );
        } else if (speechOnset === 0) {
            skipSamples = 0;
        } else {
            skipSamples = Math.floor(pcm.sampleRate * fallbackTrimSec);
        }

        const maxSkip = Math.floor(pcm.sampleRate * maxTrimSec);
        skipSamples = Math.min(skipSamples, maxSkip);

        const sliced = sliceWavFromSample(ab, skipSamples);
        return sliced;
    }

    global.AudioWav = {
        blobTo16kMonoWav: blobTo16kMonoWav,
        getWavDurationSec: getWavDurationSec,
        trimWavToMaxSeconds: trimWavToMaxSeconds,
        trimWavLeadingSilence: trimWavLeadingSilence,
        TARGET_SAMPLE_RATE: TARGET_RATE,
    };
})(window);
