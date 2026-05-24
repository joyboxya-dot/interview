/**
 * 읽기 지도 — 설명 없이 시각만 (작·회색=빠르게, 굵기·음절=강세, ⏸=끊음)
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

    /** 사전 없을 때 — 앞 음절 작게, 뒤 강세 크게 */
    function renderTokenHeuristic(token) {
        const m = token.match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
        if (!m) return escapeHtml(token);
        const w = m[2];
        if (w.length <= 2) {
            return escapeHtml(m[1]) + '<span class="syllable-stress">' + escapeHtml(w.toUpperCase()) + '</span>' + escapeHtml(m[3]);
        }
        const cut = w.length <= 4 ? 1 : Math.max(1, Math.floor(w.length * 0.38));
        return (
            escapeHtml(m[1]) +
            '<span class="syllable-weak">' +
            escapeHtml(w.slice(0, cut)) +
            '</span><span class="syllable-stress">' +
            escapeHtml(w.slice(cut).toUpperCase()) +
            '</span>' +
            escapeHtml(m[3])
        );
    }

    function renderToken(token, stressDict) {
        const m = token.match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
        if (!m) return escapeHtml(token);
        const clean = m[2].toLowerCase();
        if (stressDict && stressDict[clean]) {
            return escapeHtml(m[1]) + stressDict[clean] + escapeHtml(m[3]);
        }
        return renderTokenHeuristic(token);
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
                    group
                        .map(function (t) {
                            return renderToken(t, stressDict);
                        })
                        .join(' ') +
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
                const pause = c.pauseAfterSec > 0 ? '<span class="rg-pause-mark" aria-hidden="true"></span>' : '';
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

    function buildReadingGuideHtml(sentence, stressDict) {
        const chunks = getChunks(sentence);
        const body = buildChunksHtml(chunks, stressDict);
        return '<div class="rg-chunks-line rg-visual-only">' + body + '</div>';
    }

    /** 체화 카드 1장 — 절·문단 분할 없이 en 전체를 한 덩어리 */
    function buildPracticeChunkGuideHtml(chunkEn, stressDict) {
        const text = String(chunkEn || '').trim();
        if (!text) return '';
        return (
            '<div class="rg-chunks-line rg-visual-only rg-chunk-single-line">' +
            '<span class="rg-chunk rg-chunk-single">' +
            buildChunkRichHtml(text, stressDict) +
            '</span></div>'
        );
    }

    global.ReadingGuide = {
        getChunks: getChunks,
        autoChunksFromEn: autoChunksFromEn,
        buildReadingGuideHtml: buildReadingGuideHtml,
        buildPracticeChunkGuideHtml: buildPracticeChunkGuideHtml,
        buildChunksHtml: buildChunksHtml,
    };
})(window);
