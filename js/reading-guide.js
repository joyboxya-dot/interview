/**
 * 끊음(chunks) + 강세(stress) 읽기 지도
 */
(function (global) {
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function autoChunksFromEn(en) {
        const parts = String(en || '').split(/([,.!?;])\s*/);
        const chunks = [];
        let buf = '';
        for (let i = 0; i < parts.length; i++) {
            buf += parts[i];
            if (/^[,.!?;]$/.test(parts[i])) {
                if (buf.trim()) chunks.push({ text: buf.trim(), pauseAfterSec: 0.45 });
                buf = '';
            }
        }
        if (buf.trim()) chunks.push({ text: buf.trim(), pauseAfterSec: 0 });
        if (!chunks.length && en) chunks.push({ text: en, pauseAfterSec: 0 });
        return chunks;
    }

    function getChunks(sentence) {
        if (sentence.chunks && sentence.chunks.length) return sentence.chunks;
        const en = sentence.en || (Array.isArray(sentence) ? sentence[1] : '');
        return autoChunksFromEn(en);
    }

    function buildChunksHtml(chunks) {
        return chunks
            .map(function (c, i) {
                const pause =
                    c.pauseAfterSec > 0
                        ? ' <span class="rg-pause">⏸ ' + c.pauseAfterSec + 's</span>'
                        : '';
                return (
                    '<span class="rg-chunk">' +
                    escapeHtml(c.text) +
                    pause +
                    (i < chunks.length - 1 ? ' ' : '') +
                    '</span>'
                );
            })
            .join('');
    }

    /**
     * stressDict: word -> html from index.html stressDict
     */
    function buildReadingGuideHtml(sentence, stressDict) {
        const chunks = getChunks(sentence);
        const en = sentence.en || '';
        let body = buildChunksHtml(chunks);
        if (stressDict && en) {
            const words = en.split(/\s+/).filter(Boolean);
            const stressBits = words
                .slice(0, 8)
                .map(function (w) {
                    const key = w.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (stressDict[key]) return stressDict[key];
                    return escapeHtml(w);
                })
                .join(' · ');
            body +=
                '<p class="rg-stress-line">강세 힌트: ' +
                stressBits +
                (words.length > 8 ? ' …' : '') +
                '</p>';
        }
        return (
            '<div class="reading-guide-title">📖 읽기 지도 (끊음 · 강세)</div>' +
            '<p class="reading-guide-legend">⏸ = 여기서 잠깐 멈춘 뒤 이어서 말하기</p>' +
            '<div class="rg-chunks-line">' +
            body +
            '</div>'
        );
    }

    global.ReadingGuide = {
        getChunks: getChunks,
        autoChunksFromEn: autoChunksFromEn,
        buildReadingGuideHtml: buildReadingGuideHtml,
        buildChunksHtml: buildChunksHtml,
    };
})(window);
