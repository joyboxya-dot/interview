/**
 * 주제당 4컷 1세트 — 1~3단계 동일 표시, 4~6단계 숨김
 */
(function (global) {
    function escapeAttr(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    function resolvePanelUrl(url) {
        const u = String(url || '').trim();
        if (!u) return u;
        if (u.indexOf('data:') === 0 || u.indexOf('http://') === 0 || u.indexOf('https://') === 0) {
            return u;
        }
        if (u.indexOf('/') === 0 && global.location && global.location.origin && global.location.protocol !== 'file:') {
            return global.location.origin + u;
        }
        return u;
    }

    /** @returns {{ panels: string[], captionKo: string } | null} */
    function normalizeComicItem(item) {
        if (!item) return null;
        let panels = [];
        let captionKo = '';
        if (typeof item === 'string') {
            panels = [item];
        } else if (Array.isArray(item)) {
            panels = item.slice();
        } else if (typeof item === 'object') {
            panels = item.panels || item.urls || [];
            captionKo = String(item.captionKo || item.caption || '').trim();
        }
        panels = panels.map(function (u) {
            return String(u || '').trim();
        });
        if (panels.length === 1 && panels[0].indexOf(',') >= 0) {
            panels = panels[0].split(',').map(function (s) {
                return s.trim();
            });
        }
        panels = panels.filter(Boolean);
        if (panels.length < 4) return null;
        return {
            panels: panels.slice(0, 4).map(resolvePanelUrl),
            captionKo: captionKo,
        };
    }

    function getTopicComic(data) {
        if (!data) return null;
        return normalizeComicItem(data.topicComic);
    }

    function hide() {
        const strip = document.getElementById('ui-comic-strip');
        const grid = document.getElementById('ui-comic-panels');
        const label = document.getElementById('ui-comic-label');
        if (strip) {
            strip.style.display = 'none';
            strip.setAttribute('aria-hidden', 'true');
        }
        if (grid) grid.innerHTML = '';
        if (label) {
            label.textContent = '';
            label.style.display = 'none';
        }
    }

    function show(comic, opts) {
        const strip = document.getElementById('ui-comic-strip');
        const grid = document.getElementById('ui-comic-panels');
        const label = document.getElementById('ui-comic-label');
        if (!strip || !grid) return;
        if (!comic || !comic.panels || comic.panels.length < 4) {
            hide();
            return;
        }
        opts = opts || {};
        const labelText = opts.label || '';
        if (label) {
            label.textContent = labelText;
            label.style.display = labelText ? 'block' : 'none';
        }
        grid.innerHTML = comic.panels
            .map(function (url, i) {
                const alt =
                    (comic.captionKo ? comic.captionKo + ' · ' : '답변 4컷 · ') +
                    (i + 1) +
                    '/4';
                return (
                    '<figure class="comic-panel">' +
                    '<img src="' +
                    escapeAttr(url) +
                    '" alt="' +
                    escapeAttr(alt) +
                    '" loading="eager" decoding="sync" width="200" height="150" />' +
                    '<figcaption class="comic-panel-num">' +
                    (i + 1) +
                    '</figcaption></figure>'
                );
            })
            .join('');
        strip.style.display = 'block';
        strip.setAttribute('aria-hidden', 'false');
    }

    function labelWithCaption(prefix, comic) {
        if (!comic) return '';
        let s = prefix;
        if (comic.captionKo) s += ' · ' + comic.captionKo;
        return s;
    }

    /** topicComic 없으면 API 또는 브라우저 폴백으로 생성 */
    async function ensureTopicComic(topic) {
        if (!topic) return topic;
        if (getTopicComic(topic)) return topic;
        if (global.ComicGenerator && global.ComicGenerator.attachTopicComic) {
            try {
                return await global.ComicGenerator.attachTopicComic(Object.assign({}, topic));
            } catch (e) {
                console.warn('ensureTopicComic api', e);
            }
        }
        if (global.ComicGeneratorFallback && global.ComicGeneratorFallback.generateTopicComic) {
            const r = global.ComicGeneratorFallback.generateTopicComic(topic);
            return Object.assign({}, topic, { topicComic: r.topicComic });
        }
        return topic;
    }

    async function showForPhase(data, phase) {
        if (!data) {
            hide();
            return data;
        }
        const p = Number(phase);
        if (p >= 1 && p <= 3) {
            let topic = data;
            if (!getTopicComic(topic)) {
                topic = await ensureTopicComic(topic);
            }
            const c = getTopicComic(topic);
            const prefixes = {
                1: '📖 답변 흐름 (4컷)',
                2: '🗣️ 답변 흐름 (4컷)',
                3: '💭 답변 흐름 (4컷)',
            };
            show(c, { label: labelWithCaption(prefixes[p] || '📖 답변 흐름', c) });
            return topic;
        }
        hide();
        return data;
    }

    function preloadTopicComic(data) {
        const c = getTopicComic(data);
        if (!c) return;
        c.panels.forEach(function (url) {
            const img = new Image();
            img.src = url;
        });
    }

    global.ComicHint = {
        hide: hide,
        show: show,
        showForPhase: showForPhase,
        ensureTopicComic: ensureTopicComic,
        getTopicComic: getTopicComic,
        preloadTopicComic: preloadTopicComic,
        normalizeComicItem: normalizeComicItem,
        resolvePanelUrl: resolvePanelUrl,
    };
})(typeof window !== 'undefined' ? window : global);
