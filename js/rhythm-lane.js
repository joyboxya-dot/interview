/**
 * 리듬 게임 스타일 레인 — 판정선 고정, 노트 이동, RAF + transform
 */
(function (global) {
    const DEFAULT_PPS = 200;
    const JUDGMENT_RATIO = 0.2;

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function shellHtml(opts) {
        const mode = opts.mode || 'listen';
        const title = mode === 'result' ? '리듬 맵 · 교정' : '리듬 맵 · 모범 듣기';
        const hint =
            mode === 'result'
                ? '판정선 통과 시 색 · 초록=OK · 주황=늦음 · 빨강=낮음'
                : '강세 노트가 판정선에 닿을 때 박을 맞춰 보세요';
        const coach =
            opts.coachHtml && mode === 'result'
                ? '<div class="rhythm-lane-coach" aria-live="polite">' + opts.coachHtml + '</div>'
                : '';
        return (
            '<div class="rhythm-lane rhythm-lane-mode-' +
            mode +
            '" data-mode="' +
            mode +
            '">' +
            '<div class="rhythm-lane-head">' +
            '<span class="rhythm-lane-title">' +
            escapeHtml(title) +
            '</span>' +
            '<button type="button" class="rhythm-lane-replay">▶ 모범</button>' +
            '</div>' +
            '<p class="rhythm-lane-hint">' +
            escapeHtml(hint) +
            '</p>' +
            '<div class="rhythm-lane-viewport">' +
            '<div class="rhythm-lane-grid" aria-hidden="true"></div>' +
            '<div class="rhythm-hit-line" aria-hidden="true"></div>' +
            '<div class="rhythm-hit-ripple" aria-hidden="true"></div>' +
            '<div class="rhythm-notes-layer"></div>' +
            '</div>' +
            coach +
            '</div>'
        );
    }

    function createLane(container, options) {
        options = options || {};
        const notes = options.notes || [];
        const mode = options.mode || 'listen';
        const pixelsPerSecond = options.pixelsPerSecond || DEFAULT_PPS;
        const onReplay = options.onReplay || null;

        container.innerHTML = shellHtml({
            mode: mode,
            coachHtml: options.coachHtml || '',
        });

        const laneEl = container.querySelector('.rhythm-lane');
        const viewport = container.querySelector('.rhythm-lane-viewport');
        const notesLayer = container.querySelector('.rhythm-notes-layer');
        const hitLine = container.querySelector('.rhythm-hit-line');
        const ripple = container.querySelector('.rhythm-hit-ripple');
        const replayBtn = container.querySelector('.rhythm-lane-replay');

        const noteItems = notes.map(function (note) {
            const el = document.createElement('div');
            el.className =
                'rhythm-note' +
                (note.stress ? ' is-stress' : ' is-weak') +
                (note.pitch ? ' pitch-' + note.pitch : '') +
                (note.status ? ' status-' + note.status : '');
            el.setAttribute('role', 'presentation');
            el.dataset.noteId = String(note.id);
            if (note.status && note.status !== 'ok') {
                el.setAttribute(
                    'aria-label',
                    '박자 ' + (note.slotIndex != null ? note.slotIndex + 1 : note.id)
                );
            }
            notesLayer.appendChild(el);
            return { note: note, el: el, hitFired: false };
        });

        let rafId = null;
        let audioTime = 0;
        let running = false;
        let judgmentX = 0;
        let viewportW = 0;
        let viewportH = 0;
        let finished = false;

        function measure() {
            const rect = viewport.getBoundingClientRect();
            viewportW = rect.width || 320;
            viewportH = rect.height || 140;
            judgmentX = viewportW * JUDGMENT_RATIO;
        }

        function semiToY(semi, pitch) {
            const padT = 14;
            const padB = 14;
            const ih = Math.max(40, viewportH - padT - padB);
            if (semi != null && isFinite(semi)) {
                const clamped = Math.max(-6, Math.min(6, semi));
                return padT + ih * (1 - (clamped + 6) / 12);
            }
            if (pitch === 'high') return padT + ih * 0.22;
            if (pitch === 'low') return padT + ih * 0.78;
            return padT + ih * 0.5;
        }

        function triggerLineRipple() {
            if (!ripple) return;
            ripple.classList.remove('is-active');
            void ripple.offsetWidth;
            ripple.classList.add('is-active');
        }

        function triggerNoteHit(el) {
            if (!el) return;
            el.classList.add('is-hit');
            triggerLineRipple();
            global.setTimeout(function () {
                el.classList.remove('is-hit');
            }, 420);
        }

        function updateNotesPositions() {
            measure();
            const isResult = mode === 'result';

            noteItems.forEach(function (item) {
                const n = item.note;
                let x;
                if (isResult) {
                    x = judgmentX;
                    if (n.status === 'late') x += 22;
                    else if (n.status === 'low' || n.status === 'weak') x -= 8;
                    else if (n.status === 'high') x -= 4;
                } else {
                    x = judgmentX + (n.startTime - audioTime) * pixelsPerSecond;
                }
                const y = semiToY(n.semi, n.pitch);
                const w = n.stress ? 28 : 10;
                const h = n.stress ? 28 : 10;
                item.el.style.transform =
                    'translate3d(' + (x - w / 2) + 'px,' + (y - h / 2) + 'px,0)';

                if (!isResult && (x < -48 || x > viewportW + 48)) {
                    item.el.style.visibility = 'hidden';
                } else {
                    item.el.style.visibility = 'visible';
                }

                if (
                    running &&
                    !item.hitFired &&
                    audioTime >= n.startTime &&
                    audioTime <= n.startTime + n.duration
                ) {
                    item.hitFired = true;
                    triggerNoteHit(item.el);
                }
            });
        }

        function frame() {
            if (!running) return;
            updateNotesPositions();
            rafId = global.requestAnimationFrame(frame);
        }

        function setNotes(newNotes) {
            notes.length = 0;
            Array.prototype.push.apply(notes, newNotes || []);
            notesLayer.innerHTML = '';
            noteItems.length = 0;
            (newNotes || []).forEach(function (note) {
                const el = document.createElement('div');
                el.className =
                    'rhythm-note' +
                    (note.stress ? ' is-stress' : ' is-weak') +
                    (note.pitch ? ' pitch-' + note.pitch : '') +
                    (note.status ? ' status-' + note.status : '');
                el.dataset.noteId = String(note.id);
                notesLayer.appendChild(el);
                noteItems.push({ note: note, el: el, hitFired: false });
            });
            resetHits();
            updateNotesPositions();
        }

        function setTime(t) {
            audioTime = typeof t === 'number' ? t : 0;
            if (!running) updateNotesPositions();
        }

        function start() {
            running = true;
            finished = false;
            measure();
            if (rafId) global.cancelAnimationFrame(rafId);
            rafId = global.requestAnimationFrame(frame);
        }

        function stop() {
            running = false;
            if (rafId) {
                global.cancelAnimationFrame(rafId);
                rafId = null;
            }
        }

        function resetHits() {
            noteItems.forEach(function (item) {
                item.hitFired = false;
                item.el.classList.remove('is-hit');
            });
        }

        function markDone() {
            finished = true;
            stop();
            if (laneEl) laneEl.classList.add('is-listen-done');
            updateNotesPositions();
        }

        function destroy() {
            stop();
            container.innerHTML = '';
        }

        if (replayBtn && onReplay) {
            replayBtn.onclick = function () {
                onReplay();
            };
        }

        if (mode === 'result') {
            audioTime = options.frozenTime != null ? options.frozenTime : refEndTime(notes);
            updateNotesPositions();
        } else {
            updateNotesPositions();
        }

        function refEndTime(notesList) {
            if (!notesList.length) return 0;
            let max = 0;
            notesList.forEach(function (n) {
                const end = n.startTime + (n.duration || 0);
                if (end > max) max = end;
            });
            return max;
        }

        return {
            el: laneEl,
            setTime: setTime,
            setNotes: setNotes,
            start: start,
            stop: stop,
            resetHits: resetHits,
            markDone: markDone,
            destroy: destroy,
            measure: measure,
        };
    }

    global.RhythmLane = {
        DEFAULT_PPS: DEFAULT_PPS,
        JUDGMENT_RATIO: JUDGMENT_RATIO,
        shellHtml: shellHtml,
        createLane: createLane,
    };
})(window);
