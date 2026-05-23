/**
 * 끊음(chunks) + 강세(stress) 읽기 지도
 */
(function (global) {
    const GLUE_WORDS = new Set([
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'at', 'it', 'and', 'but', 'or', 'for', 'with', 'as', 'by', 'that', 'this',
        'i', 'my', 'our', 'we', 'he', 'she', 'they', 'me', 'us', 'him', 'her', 'them',
        'so', 'if', 'not', 'also', 'just', 'only', 'into', 'from', 'up', 'down', 'out', 'about', 'over', 'under', 'again',
    ]);

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function wordKey(w) {
        return String(w || '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');
    }

    function isGlueWord(clean) {
        if (!clean) return true;
        if (GLUE_WORDS.has(clean)) return true;
        if (clean.length <= 2 && clean !== 'nps') return true;
        return false;
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

    function renderToken(token, stressDict) {
        const m = token.match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
        if (!m) return escapeHtml(token);
        const clean = m[2].toLowerCase();
        const inner = stressDict && stressDict[clean] ? stressDict[clean] : escapeHtml(m[2]);
        return escapeHtml(m[1]) + inner + escapeHtml(m[3]);
    }

    function buildChunkRichHtml(chunkText, stressDict) {
        const tokens = chunkText.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return escapeHtml(chunkText);
        let html = '';
        let i = 0;
        while (i < tokens.length) {
            const clean = wordKey(tokens[i]);
            const glue = isGlueWord(clean);
            let j = i + 1;
            while (j < tokens.length) {
                const cj = wordKey(tokens[j]);
                if (isGlueWord(cj) !== glue) break;
                j++;
            }
            const group = tokens.slice(i, j);
            if (glue) {
                html += '<span class="rg-glue">' + group.map(function (t) { return escapeHtml(t); }).join(' ') + '</span>';
            } else {
                html +=
                    '<span class="rg-beat">' +
                    group.map(function (t) {
                        return renderToken(t, stressDict);
                    }).join(' ') +
                    '</span>';
            }
            if (j < tokens.length) html += ' ';
            i = j;
        }
        return html;
    }

    function buildChunksHtml(chunks, stressDict) {
        return chunks
            .map(function (c, i) {
                const pause =
                    c.pauseAfterSec > 0
                        ? ' <span class="rg-pause">⏸ ' + c.pauseAfterSec + 's</span>'
                        : '';
                return (
                    '<span class="rg-chunk">' +
                    buildChunkRichHtml(c.text, stressDict) +
                    pause +
                    (i < chunks.length - 1 ? ' ' : '') +
                    '</span>'
                );
            })
            .join('');
    }

    function buildStressHintLine(en, stressDict) {
        if (!stressDict || !en) return '';
        const words = en.split(/\s+/).filter(Boolean);
        const bits = [];
        words.forEach(function (w) {
            const key = wordKey(w);
            if (stressDict[key]) bits.push(stressDict[key]);
        });
        if (!bits.length) {
            return '<p class="rg-stress-line rg-stress-muted">강세 힌트: 사전에 없는 문장 · 위에서 <b>굵은 덩어리</b>만 세게</p>';
        }
        return (
            '<p class="rg-stress-line">강세 힌트(음절): ' +
            bits.slice(0, 6).join(' · ') +
            (bits.length > 6 ? ' …' : '') +
            '</p>'
        );
    }

    function buildReadingGuideHtml(sentence, stressDict) {
        const chunks = getChunks(sentence);
        const en = sentence.en || (Array.isArray(sentence) ? sentence[1] : '');
        let body = buildChunksHtml(chunks, stressDict);
        body += buildStressHintLine(en, stressDict);
        return (
            '<div class="reading-guide-title">📖 읽기 지도 (끊음 · 강세)</div>' +
            '<p class="reading-guide-legend">⏸ = 잠깐 멈춤 · <span class="rg-glue">작·회색</span> = 빠르게 · <span class="rg-beat">굵은 덩어리</span> = 세게</p>' +
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
