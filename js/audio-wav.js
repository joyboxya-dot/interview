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

    global.AudioWav = {
        blobTo16kMonoWav: blobTo16kMonoWav,
        getWavDurationSec: getWavDurationSec,
        trimWavToMaxSeconds: trimWavToMaxSeconds,
        TARGET_SAMPLE_RATE: TARGET_RATE,
    };
})(window);
