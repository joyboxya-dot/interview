/**
 * Azure Speech-to-Text REST API for short audio + pronunciation assessment
 */

export function buildPronunciationHeader(referenceText) {
  const params = {
    ReferenceText: (referenceText || '').replace(/\s+/g, ' ').trim(),
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    Dimension: 'Comprehensive',
    EnableMiscue: true,
    EnableProsodyAssessment: true,
  };
  return Buffer.from(JSON.stringify(params), 'utf8').toString('base64');
}

export function parseShortAudioResponse(json) {
  if (!json || json.RecognitionStatus !== 'Success') {
    return {
      ok: false,
      status: json?.RecognitionStatus || 'Error',
      message: json?.RecognitionStatus || 'recognition_failed',
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
