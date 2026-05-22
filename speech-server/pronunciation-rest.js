/**
 * Azure Speech-to-Text REST API for short audio + pronunciation assessment
 */

/** @see https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short */
export function buildPronunciationHeader(referenceText) {
  const params = {
    ReferenceText: (referenceText || '').replace(/\s+/g, ' ').trim(),
    GradingSystem: 'HundredMark',
    Granularity: 'Word',
    Dimension: 'Comprehensive',
    EnableMiscue: 'True',
    EnableProsodyAssessment: 'True',
  };
  return Buffer.from(JSON.stringify(params), 'utf8').toString('base64');
}

export function validateWav16kMono(buffer) {
  if (!buffer || buffer.length < 44) {
    return { ok: false, error: 'wav_too_short', detail: '녹음이 너무 짧습니다.' };
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { ok: false, error: 'wav_invalid', detail: 'WAV 변환 실패 — 브라우저를 새로고침 후 다시 녹음하세요.' };
  }
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  if (channels !== 1) {
    return { ok: false, error: 'wav_not_mono', detail: `channels=${channels}` };
  }
  if (sampleRate !== 16000) {
    return { ok: false, error: 'wav_wrong_rate', detail: `rate=${sampleRate} (need 16000)` };
  }
  const dataBytes = buffer.length - 44;
  if (dataBytes < 3200) {
    return { ok: false, error: 'wav_too_short', detail: '1초 이상 말한 뒤 종료하세요.' };
  }
  return { ok: true };
}

export function parseShortAudioResponse(json) {
  if (!json || json.RecognitionStatus !== 'Success') {
    const status = json?.RecognitionStatus || 'Error';
    const hints = {
      InitialSilenceTimeout: '말소리가 없습니다. 마이크를 확인하고 1초 이상 말하세요.',
      BabbleTimeout: '노이즈만 감지되었습니다. 조용한 곳에서 다시 시도하세요.',
      Error: 'Azure 인식 오류',
    };
    return {
      ok: false,
      status,
      message: status,
      detail: hints[status] || json?.DisplayText || status,
    };
  }

  const nbest = json.NBest && json.NBest[0];
  const text = (nbest && (nbest.Display || nbest.Lexical)) || json.DisplayText || '';

  if (!nbest) {
    return {
      ok: true,
      text,
      accuracyScore: 0,
      fluencyScore: 0,
      completenessScore: 0,
      prosodyScore: null,
      pronunciationScore: null,
      words: [],
      raw: json,
    };
  }

  const words = (nbest.Words || []).map((w) => ({
    word: w.Word || '',
    accuracyScore: w.AccuracyScore,
    errorType: w.ErrorType || 'None',
    offset: w.Offset,
    duration: w.Duration,
    phonemes: w.Phonemes || [],
    syllables: w.Syllables || [],
  }));

  return {
    ok: true,
    text,
    accuracyScore: nbest.AccuracyScore ?? 0,
    fluencyScore: nbest.FluencyScore ?? 0,
    completenessScore: nbest.CompletenessScore ?? 0,
    prosodyScore: nbest.ProsodyScore != null ? nbest.ProsodyScore : null,
    pronunciationScore: nbest.PronScore != null ? nbest.PronScore : null,
    words,
    raw: json,
  };
}

export async function assessShortAudioPronunciation({
  speechKey,
  region,
  referenceText,
  audioBuffer,
  contentType = 'audio/wav; codecs=audio/pcm; samplerate=16000',
}) {
  const regionHost = region.toLowerCase();
  const url =
    `https://${regionHost}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
    '?language=en-US&format=detailed';

  const pronHeader = buildPronunciationHeader(referenceText);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': speechKey,
      'Content-Type': contentType,
      Accept: 'application/json',
      'Pronunciation-Assessment': pronHeader,
    },
    body: audioBuffer,
  });

  const bodyText = await res.text();
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return {
      ok: false,
      httpStatus: res.status,
      message: 'invalid_json',
      detail: bodyText.slice(0, 500),
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      httpStatus: res.status,
      message: json?.RecognitionStatus || 'http_error',
      detail: bodyText.slice(0, 500),
      raw: json,
    };
  }

  const parsed = parseShortAudioResponse(json);
  parsed.httpStatus = res.status;
  return parsed;
}
