/**
 * EvoLink OpenAI-compatible chat — 면접 스크립트 JSON 생성
 * https://docs.evolink.ai (POST /v1/chat/completions)
 */

const DEFAULT_BASE = 'https://api.evolink.ai/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

function getConfig() {
    const key = process.env.EVOLINK_API_KEY || process.env.OPENAI_API_KEY;
    const base = (process.env.EVOLINK_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
    const model = process.env.EVOLINK_MODEL || DEFAULT_MODEL;
    return { key, base, model };
}

function buildSystemPrompt() {
    return [
        'You write Korean–English interview answer scripts for a speaking-practice app.',
        'Return ONLY one JSON object. No markdown fences, no commentary.',
        'Required keys:',
        '- title: Korean short topic title',
        '- question: English main interview question',
        '- altQuestion: English alternate or pivot question',
        '- bridgeKo: Korean one-sentence bridge to start the answer',
        '- bridge: English one-sentence bridge (natural spoken English)',
        '- kor: Korean full answer paragraph (for recall hint)',
        '- sentences: array of [koreanSentence, englishSentence] pairs, 4–8 items',
        'Use professional tone (finance/IT). Spoken English, STAR-style when appropriate.',
        'English sentences must be speakable aloud; Korean should match the English meaning.',
    ].join('\n');
}

function buildUserPrompt({ userPrompt, existingScriptsSummary, currentDraft }) {
    const parts = ['## User request (create or revise the script)', String(userPrompt || '').trim(), ''];

    const hasDraft =
        currentDraft &&
        (currentDraft.title ||
            currentDraft.question ||
            currentDraft.kor ||
            (currentDraft.sentences && currentDraft.sentences.length));

    if (hasDraft) {
        parts.push('## Current draft JSON (revise using the user request above)');
        parts.push(JSON.stringify(currentDraft, null, 2));
        parts.push('');
        parts.push(
            'Task: REFINE the draft. Apply the user corrections. Keep structure and fields. Update only what must change.'
        );
    } else {
        parts.push('## Reference — existing scripts in the app (style and length only)');
        parts.push(existingScriptsSummary || '(none yet)');
        parts.push('');
        parts.push('Task: CREATE a new script from scratch based on the user request.');
    }

    return parts.join('\n');
}

function extractJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('empty_model_response');

    try {
        return JSON.parse(raw);
    } catch (e) {
        /* continue */
    }

    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
        return JSON.parse(fence[1].trim());
    }

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return JSON.parse(raw.slice(start, end + 1));
    }

    throw new Error('invalid_json');
}

function normalizeGeneratedTopic(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('invalid_topic_shape');

    const sentences = (obj.sentences || [])
        .map(function (s) {
            if (Array.isArray(s)) return [String(s[0] || '').trim(), String(s[1] || '').trim()];
            return [String(s.ko || s.korean || '').trim(), String(s.en || s.english || '').trim()];
        })
        .filter(function (s) {
            return s[0] || s[1];
        });

    const topic = {
        title: String(obj.title || '').trim(),
        question: String(obj.question || '').trim(),
        altQuestion: String(obj.altQuestion || obj.alt_question || '').trim(),
        bridgeKo: String(obj.bridgeKo || obj.bridge_ko || '').trim(),
        bridge: String(obj.bridge || '').trim(),
        kor: String(obj.kor || '').trim(),
        sentences: sentences,
    };

    if (!topic.title) throw new Error('missing_title');
    if (!topic.question) throw new Error('missing_question');
    if (!topic.altQuestion) throw new Error('missing_altQuestion');
    if (!topic.kor) throw new Error('missing_kor');
    if (!topic.sentences.length) throw new Error('missing_sentences');

    return topic;
}

export async function generateInterviewScript(body) {
    const { key, base, model } = getConfig();
    if (!key) {
        const err = new Error('evolink_not_configured');
        err.status = 503;
        throw err;
    }

    const userPrompt = body && body.userPrompt;
    if (!userPrompt || !String(userPrompt).trim()) {
        const err = new Error('user_prompt_required');
        err.status = 400;
        throw err;
    }

    const url = base + '/chat/completions';
    const payload = {
        model: model,
        messages: [
            { role: 'system', content: buildSystemPrompt() },
            {
                role: 'user',
                content: buildUserPrompt({
                    userPrompt: userPrompt,
                    existingScriptsSummary: body.existingScriptsSummary,
                    currentDraft: body.currentDraft,
                }),
            },
        ],
        temperature: 0.65,
        max_tokens: 4096,
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + key,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const data = await res.json().catch(function () {
        return null;
    });

    if (!res.ok) {
        const msg =
            (data && data.error && (data.error.message || data.error.code)) ||
            res.statusText ||
            'evolink_http_' + res.status;
        const err = new Error(msg);
        err.status = res.status;
        err.detail = data;
        throw err;
    }

    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    let parsed;
    try {
        parsed = extractJsonObject(content);
    } catch (e) {
        const err = new Error('invalid_json');
        err.status = 502;
        err.raw = String(content || '').slice(0, 500);
        throw err;
    }

    try {
        return { topic: normalizeGeneratedTopic(parsed), model: model };
    } catch (e) {
        const err = new Error(e.message || 'invalid_topic_shape');
        err.status = 502;
        throw err;
    }
}

export function evolinkConfigured() {
    return !!getConfig().key;
}
