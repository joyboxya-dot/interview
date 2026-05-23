/**
 * 주제당 STAR 4컷 SVG — 그림만 (단계·한글 문장은 앱 UI)
 *
 * STAR 구성 (한 컷 = 한 역할, 같은 화면 반복 금지):
 *  1 상황 — 배경·맥락 (NPS, 합류, 프로젝트)
 *  2 문제 — 고통·비효율 (화면 2개, slow, 장애)
 *  3 행동 — 내가 한 일 (shell, UI+LOG 추가, 문서 작성…) ← logs 화면만 X
 *  4 결과 — 바뀐 세상 (2→1 통합, fast, std, 런칭…)
 */
import fs from 'fs';
import path from 'path';

const W = 200;
const H = 120;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** UI용 (JSON·접근성). SVG 안에는 넣지 않음 */
export const STEP_TAGS = ['1 상황', '2 문제', '3 행동', '4 결과'];

function collectKoSentences(topic) {
  let ko = (topic.sentences || []).map((s) => (Array.isArray(s) ? s[0] : s.ko) || '').filter(Boolean);
  if (!ko.length && topic.kor) {
    ko = String(topic.kor)
      .split(/(?<=[.!?。])\s+|[\n]+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 2);
  }
  return ko;
}

/** @deprecated — SVG·UI에 문장 캡션 넣지 않음 */
export function pickStarLabels() {
  return ['', '', '', ''];
}

export function extractTopicContext(topic) {
  const parts = [
    topic.title,
    topic.kor,
    topic.question,
    topic.altQuestion,
    ...(topic.sentences || []).flatMap((s) => (Array.isArray(s) ? s : [s.ko, s.en])),
  ];
  const all = parts.filter(Boolean).join(' ');
  return {
    nps: /NPS|고도화/.test(all),
    etl: /ETL/i.test(all),
    log: /로그|log/i.test(all),
    dual: /이중|두\s*번|dual|레거시.*(시스템|접속)|separate legacy/i.test(all),
    inefficient: /비효율|inefficient/i.test(all),
    ui: /\bUI\b|화면|interface/i.test(all),
    code: /shell|쉘|스크립트|script|Python|코드/i.test(all),
    night: /퇴근|야간|개인\s*시간|after work/i.test(all),
    team: /팀|협업|team/i.test(all),
    money: /800|억|결산|\$|dollar/i.test(all),
    doc: /문서|가이드|200\s*page/i.test(all),
    alert: /장애|배치|batch|개장/i.test(all),
    join: /합류|joined|운영|엔지니어/i.test(all),
    save: /절약|saved|시간|결과|없앴|stopped/i.test(all),
    mobile: /MTS|모바일|mobile/i.test(all),
    cloud: /AWS|Snowflake|클라우드/i.test(all),
    study: /문법|영어|학습|grammar/i.test(all),
    family: /가족|미국|정착|영주권/i.test(all),
    apiMany: /50.*API|40.*API|새 API|many API/i.test(all),
    splitApi: /작은 API|나눴|split|실패해도/i.test(all),
    noRecur: /재발|다시는|never again|not happen again/i.test(all),
    standard: /표준|standard|안정화|stabiliz/i.test(all),
    launch: /런칭|launch|출시/i.test(all),
  };
}

function getTopicTextBlob(topic) {
  const parts = [
    topic.title,
    topic.kor,
    topic.question,
    ...(topic.sentences || []).flatMap((s) => (Array.isArray(s) ? s : [s.ko, s.en])),
  ];
  return parts.filter(Boolean).join(' ');
}

/** 에피소드별 4컷 — 컷마다 유일한 kind (중복 generic problem 방지) */
export const TOPIC_PANEL_PLANS = {
  'topic-00': [
    { kind: 'situation_join_ops' },
    { kind: 'dual_etl_logs', left: 'ETL', right: 'logs', center: 'slow' },
    { kind: 'night_code' },
    { kind: 'result_unified', screen: 'UI', time: true },
  ],
  'topic-01': [
    { kind: 'situation_money_settle' },
    { kind: 'problem_no_doc' },
    { kind: 'doc_write' },
    { kind: 'result_doc_std' },
  ],
  'topic-02': [
    { kind: 'situation_mts_partner' },
    { kind: 'problem_fast_vs_mgmt' },
    { kind: 'action_lead_team' },
    { kind: 'result_mts_launch', count: '50' },
  ],
  'topic-03': [
    { kind: 'situation_one_big_api' },
    { kind: 'problem_spof_crash' },
    { kind: 'api_split_build', count: '40' },
    { kind: 'result_api_split' },
  ],
  'topic-04': [
    { kind: 'situation_vendor_file' },
    { kind: 'problem_file_space' },
    { kind: 'action_validation' },
    { kind: 'result_shield', title: 'BATCH' },
  ],
  'topic-05': [
    { kind: 'situation_interview_pressure' },
    { kind: 'problem_nervous' },
    { kind: 'action_double_check' },
    { kind: 'result_accuracy_cloud' },
  ],
  'topic-06': [
    { kind: 'situation_nps_batch' },
    { kind: 'problem_full_scan' },
    { kind: 'action_sql_index' },
    { kind: 'result_batch_fast' },
  ],
  'topic-07': [
    { kind: 'situation_family_us' },
    { kind: 'problem_resume_gap' },
    { kind: 'action_python_ai' },
    { kind: 'result_home_work' },
  ],
  'topic-08': [
    { kind: 'situation_roadmap' },
    { kind: 'problem_pipeline_tangle' },
    { kind: 'action_arch_design' },
    { kind: 'result_arch_mentor' },
  ],
  'topic-09': [
    { kind: 'situation_syntax_quiz' },
    { kind: 'problem_syntax_memory' },
    { kind: 'action_read_docs' },
    { kind: 'result_learn_fast' },
  ],
};

/** UI·접근성용 — 컷별 구분 키워드 (한글) */
export function extractDistinctiveKeywords(topic) {
  const id = topic?.id;
  const map = {
    'topic-00': [['NPS 합류', '운영'], ['ETL·로그', '이중·slow'], ['야간 shell'], ['UI 통합', '시간 절약']],
    'topic-01': [['$800B', 'NPS'], ['문서 없음', '결산 어려움'], ['200p 가이드'], ['표준·안정 결산']],
    'topic-02': [['MTS', '외부팀'], ['빠른 전송 vs 관리'], ['백엔드 리드'], ['50 API 런칭']],
    'topic-03': [['MTS', '1 BIG API'], ['SPOF·앱 전체'], ['40 API 분리'], ['뉴스X·매매OK']],
    'topic-04': [['업체 파일'], ['파일명 공백'], ['검증 로직'], ['재발 방지']],
    'topic-05': [['면접 압박'], ['긴장·순발력'], ['두 번 체크'], ['100%·AWS']],
    'topic-06': [['NPS 결산'], ['FULL SCAN'], ['인덱스·힌트'], ['배치 fast']],
    'topic-07': [['미국·가족'], ['이력 공백'], ['Python·AI'], ['100% 복귀']],
    'topic-08': [['5y·10y'], ['파이프라인 복잡'], ['아키텍트'], ['멘토링']],
    'topic-09': [['문법 질문'], ['syntax ???'], ['문서·코드'], ['빠른 학습 AWS']],
  };
  return map[id] || [[], [], [], []];
}

export function planPanelVisualForTopic(topic, stepIndex) {
  const id = topic?.id;
  const plans = id && TOPIC_PANEL_PLANS[id];
  if (plans && plans[stepIndex]) return { ...plans[stepIndex] };
  return planPanelVisualHeuristic(stepIndex, topic);
}

/** 4번째 컷 — 에피소드별로 다른 결과 장면 */
export function planResultVisual(topic) {
  const ctx = extractTopicContext(topic);
  const all = getTopicTextBlob(topic);

  if (/이중.*없애|없애고|stopped the dual|no more dual/i.test(all)) {
    return { kind: 'result_unified', screen: ctx.ui ? 'UI' : 'SYS', time: /절약|saved|time/i.test(all) };
  }
  if (/재발|다시는|never again|not happen again/i.test(all)) {
    return { kind: 'result_shield', title: 'BATCH' };
  }
  if (/표준|standard|안정화|stabiliz/i.test(all) && ctx.doc) {
    return { kind: 'result_doc_std' };
  }
  if (/50.*API|새 API.*만들|launch|런칭|MTS/i.test(all) && (ctx.mobile || ctx.apiMany)) {
    return { kind: 'result_mts_launch', count: '50' };
  }
  if (/작은 API|나눴|실패해도|주식.*가능|news.*fail/i.test(all) || ctx.splitApi) {
    return { kind: 'result_api_split' };
  }
  if (/빠르|fast|안정.*끝|faster/i.test(all) && ctx.alert) {
    return { kind: 'result_batch_fast' };
  }
  if (/정착|100%.*일터|back to work|ready to return/i.test(all) || (ctx.family && ctx.save)) {
    return { kind: 'result_home_work' };
  }
  if (/아키텍|architect|10년|미래.*시스템/i.test(all)) {
    return { kind: 'result_arch_layers' };
  }
  if (/독학|AWS|Snowflake|빠르게 배울|learn.*fast|cloud/i.test(all) && ctx.cloud) {
    return { kind: 'result_cloud_up' };
  }
  if (ctx.dual && ctx.save) {
    return { kind: 'result_unified', screen: ctx.ui ? 'UI' : '1 SYS', time: true };
  }
  if (ctx.doc && ctx.standard) return { kind: 'result_doc_std' };
  if (ctx.mobile) return { kind: 'result_mts_launch', count: '50' };
  if (ctx.splitApi) return { kind: 'result_api_split' };
  if (ctx.alert) return { kind: 'result_batch_fast' };
  if (ctx.money) return { kind: 'result_money_stable' };
  if (ctx.cloud) return { kind: 'result_cloud_up' };
  if (ctx.family) return { kind: 'result_home_work' };
  if (ctx.etl && ctx.ui) return { kind: 'result_unified', screen: 'UI', time: false };

  return { kind: 'result_metric_up', title: 'OK' };
}

/** 3 행동 — 「내가 뭘 했는지」 (문제·결과와 다른 장면) */
export function planActionVisual(topic) {
  const ctx = extractTopicContext(topic);
  const all = getTopicTextBlob(topic);

  if (ctx.code && ctx.night) return { kind: 'night_code' };
  if (/가이드.*작성|200.*페이지|wrote.*guide|documentation/i.test(all) && ctx.doc) {
    return { kind: 'doc_write' };
  }
  if (/인덱스|쿼리|query|hint|실행 계획/i.test(all) && ctx.alert) {
    return { kind: 'one_screen', title: 'SQL' };
  }
  if (/검증|validation|추가.*로직/i.test(all) && ctx.alert) {
    return { kind: 'one_screen', title: 'check' };
  }
  if (/API.*만들|made.*API|mapping/i.test(all) && ctx.mobile) {
    return { kind: 'one_screen', title: 'API' };
  }
  if (/나눴|split.*API|작은 API/i.test(all)) {
    return { kind: 'api_split_build' };
  }
  if (ctx.ui && ctx.log) return { kind: 'ui_build', title: 'UI' };
  if (ctx.ui) return { kind: 'ui_build', title: 'UI' };
  if (ctx.code) return { kind: 'one_screen', title: 'shell' };
  if (ctx.cloud) return { kind: 'one_screen', title: 'cloud' };
  if (ctx.study) return { kind: 'one_screen', title: 'EN' };
  if (ctx.doc) return { kind: 'doc_write' };
  if (ctx.team) return { kind: 'one_screen', title: 'lead' };
  return { kind: 'one_screen', title: 'fix' };
}

export function planPanelVisualHeuristic(stepIndex, topic) {
  const ctx = extractTopicContext(topic);

  if (stepIndex === 0) {
    if (ctx.nps && ctx.join) return { kind: 'situation_join_ops' };
    if (ctx.nps) return { kind: 'nps' };
    if (ctx.money) return { kind: 'money' };
    if (ctx.doc) return { kind: 'doc' };
    if (ctx.mobile) return { kind: 'mobile' };
    return { kind: 'one_screen', title: 'CTX' };
  }

  if (stepIndex === 1) {
    return planProblemVisual(topic);
  }

  if (stepIndex === 2) {
    return planActionVisual(topic);
  }

  return planResultVisual(topic);
}

/** 2 문제 — 문장·주제 시그니처 (커스텀 주제용) */
export function planProblemVisual(topic) {
  const all = getTopicTextBlob(topic);
  const s2 = collectKoSentences(topic)[1] || '';
  const blob = s2 + ' ' + all;

  if (/문서화.*없|never documented|no.*document/i.test(blob)) return { kind: 'problem_no_doc' };
  if (/빠른 전송|fast data|관리 부담|management burden/i.test(blob)) return { kind: 'problem_fast_vs_mgmt' };
  if (/앱 전체|whole app crash|한 부분이 실패/i.test(blob)) return { kind: 'problem_spof_crash' };
  if (/공백|space in the file|파일명/i.test(blob)) return { kind: 'problem_file_space' };
  if (/긴장|nervous|순발력|quick thinker/i.test(blob)) return { kind: 'problem_nervous' };
  if (/풀 테이블|Full Table Scan|실행 계획/i.test(blob)) return { kind: 'problem_full_scan' };
  if (/공백기|gap|직장이 없/i.test(blob)) return { kind: 'problem_resume_gap' };
  if (/파이프라인|pipeline|go-to person/i.test(blob)) return { kind: 'problem_pipeline_tangle' };
  if (/문법|syntax|기억나지/i.test(blob)) return { kind: 'problem_syntax_memory' };
  if (/ETL/i.test(blob) && (/비효율|inefficient|이중|dual/i.test(blob))) {
    return { kind: 'dual_etl_logs', left: 'ETL', right: 'logs', center: 'slow' };
  }
  const ctx = extractTopicContext(topic);
  if (ctx.alert) return { kind: 'alert' };
  if (ctx.inefficient) return { kind: 'dual_etl_logs', center: 'slow' };
  return { kind: 'problem', title: '!' };
}

export function planPanelVisual(stepIndex, topic) {
  return planPanelVisualForTopic(topic, stepIndex);
}

function monitor(x, y, w, h, title, accent = '#6366F1') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#E2E8F0" stroke="#94A3B8" stroke-width="2"/>
  <rect x="${x + 8}" y="${y + 8}" width="${w - 16}" height="${h - 20}" rx="4" fill="#FFFFFF"/>
  <text x="${x + w / 2}" y="${y + 28}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="800" fill="${accent}">${esc(title)}</text>`;
}

function logLinesInside(x, y, w, h) {
  let lines = '';
  for (let i = 0; i < 4; i++) {
    const ly = y + 36 + i * 10;
    lines += `<rect x="${x + 12}" y="${ly}" width="${w - 24}" height="5" rx="2" fill="#CBD5E1"/>`;
  }
  return lines;
}

/** 짧은 영문만 (화면 라벨·아이콘) */
function tag(x, y, text, bg = '#FEE2E2', fg = '#B91C1C') {
  const tw = Math.max(32, text.length * 9 + 14);
  return `<rect x="${x}" y="${y}" width="${tw}" height="22" rx="11" fill="${bg}"/>
  <text x="${x + tw / 2}" y="${y + 16}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="800" fill="${fg}">${esc(text)}</text>`;
}

function drawPlanned(plan) {
  const k = plan.kind;
  switch (k) {
    case 'nps':
      return monitor(40, 18, 120, 84, 'NPS', '#4338CA');
    case 'dual_etl_logs': {
      const left = plan.left || 'ETL';
      const right = plan.right || 'logs';
      const center = plan.center || 'slow';
      const cx = 100 - (center.length * 9 + 14) / 2;
      return (
        monitor(6, 28, 84, 68, left, '#D97706') +
        monitor(110, 28, 84, 68, right, '#2563EB') +
        tag(cx, 8, center, '#FEE2E2', '#B91C1C')
      );
    }
    case 'log_screen':
      return monitor(18, 14, 164, 92, plan.title || 'logs', '#D97706') + logLinesInside(18, 14, 164, 92);
    case 'one_screen':
      return monitor(28, 16, 144, 88, plan.title || '—', '#059669');
    case 'ui_build':
      return (
        monitor(18, 20, 120, 78, plan.title || 'UI', '#059669') +
        tag(100, 14, '+LOG', '#FEF3C7', '#D97706') +
        '<path d="M142 58 L158 58 M158 58 L152 52 M158 58 L152 64" stroke="#D97706" stroke-width="2.5" fill="none"/>'
      );
    case 'doc_write':
      return monitor(40, 16, 120, 88, 'DOC', '#7C3AED') + tag(118, 10, '+200p', '#EDE9FE', '#5B21B6');
    case 'api_split_build': {
      const n = plan.count || '40';
      return (
        tag(12, 18, '1', '#DBEAFE', '#1D4ED8') +
        tag(52, 18, '2', '#DBEAFE', '#1D4ED8') +
        tag(92, 18, '…', '#DBEAFE', '#1D4ED8') +
        tag(128, 18, n, '#DBEAFE', '#1D4ED8') +
        '<path d="M100 88 L100 102" stroke="#059669" stroke-width="2.5"/>' +
        tag(58, 96, 'split', '#D1FAE5', '#047857')
      );
    }
    case 'situation_join_ops':
      return monitor(28, 18, 100, 80, 'NPS', '#4338CA') + tag(118, 28, 'OPS', '#E0E7FF', '#3730A3');
    case 'situation_money_settle':
      return tag(22, 38, '$800B', '#D1FAE5', '#047857') + monitor(88, 18, 100, 84, 'SETTLE', '#059669');
    case 'situation_mts_partner':
      return (
        monitor(8, 24, 72, 72, 'MTS', '#059669') +
        monitor(120, 24, 72, 72, 'ext', '#2563EB') +
        '<path d="M82 60 H116" stroke="#64748B" stroke-width="2.5" marker-end="url(#a)"/>' +
        tag(78, 8, 'partner', '#DBEAFE', '#1D4ED8')
      );
    case 'situation_one_big_api':
      return monitor(36, 14, 128, 88, 'MTS', '#059669') + tag(52, 6, '1 BIG API', '#FEE2E2', '#B91C1C');
    case 'situation_vendor_file':
      return (
        monitor(12, 30, 70, 60, 'FILE', '#D97706') +
        '<path d="M86 60 H108" stroke="#64748B" stroke-width="2.5"/>' +
        monitor(112, 30, 76, 60, 'BATCH', '#059669') +
        tag(24, 18, 'daily', '#FEF3C7', '#D97706')
      );
    case 'situation_interview_pressure':
      return (
        '<text x="36" y="58" font-size="28">🎤</text>' +
        monitor(72, 22, 108, 76, 'Q', '#DC2626') +
        tag(118, 12, 'pressure', '#FEE2E2', '#B91C1C')
      );
    case 'situation_nps_batch':
      return monitor(24, 18, 88, 80, 'NPS', '#4338CA') + monitor(118, 28, 72, 68, 'BATCH', '#D97706');
    case 'situation_family_us':
      return (
        '<rect x="24" y="32" width="52" height="44" rx="6" fill="#E0E7FF" stroke="#6366F1" stroke-width="2"/>' +
        '<path d="M36 68 L50 52 L64 68 Z" fill="#6366F1"/>' +
        tag(88, 28, 'US', '#DBEAFE', '#1D4ED8') +
        tag(118, 48, 'GC', '#D1FAE5', '#047857')
      );
    case 'situation_roadmap':
      return tag(28, 42, '5y', '#E0E7FF', '#3730A3') + tag(88, 42, '10y', '#E0E7FF', '#3730A3') + tag(58, 18, 'vision', '#D1FAE5', '#047857');
    case 'situation_syntax_quiz':
      return monitor(32, 18, 136, 84, 'syntax?', '#7C3AED') + tag(118, 8, 'quiz', '#EDE9FE', '#5B21B6');
    case 'problem_no_doc':
      return (
        monitor(36, 20, 88, 72, 'DOC', '#94A3B8') +
        tag(118, 24, 'empty', '#FEE2E2', '#B91C1C') +
        tag(42, 6, 'no doc', '#FEE2E2', '#B91C1C') +
        tag(128, 78, 'SETTLE?', '#FEF3C7', '#D97706')
      );
    case 'problem_fast_vs_mgmt':
      return tag(24, 44, 'FAST', '#DBEAFE', '#1D4ED8') + tag(88, 28, 'vs', '#F1F5F9', '#64748B') + tag(128, 44, 'MGMT', '#FEF3C7', '#D97706');
    case 'problem_spof_crash':
      return (
        monitor(8, 28, 72, 64, '1 API', '#DC2626') +
        '<path d="M82 60 H98" stroke="#DC2626" stroke-width="2.5"/>' +
        monitor(102, 22, 90, 76, 'app', '#DC2626') +
        tag(128, 8, 'SPOF', '#FEE2E2', '#B91C1C')
      );
    case 'problem_file_space':
      return (
        monitor(20, 24, 100, 56, 'a b.txt', '#D97706') +
        tag(28, 8, 'space', '#FEE2E2', '#B91C1C') +
        monitor(128, 36, 64, 52, 'BATCH', '#DC2626') +
        tag(138, 22, 'FAIL', '#FEE2E2', '#B91C1C')
      );
    case 'problem_nervous':
      return (
        '<text x="32" y="56" font-size="24">😰</text>' +
        monitor(72, 22, 108, 76, 'spot', '#DC2626') +
        tag(118, 10, 'nerves', '#FEE2E2', '#B91C1C')
      );
    case 'problem_full_scan':
      return monitor(28, 18, 144, 80, 'SQL', '#DC2626') + tag(72, 6, 'FULL SCAN', '#FEE2E2', '#B91C1C');
    case 'problem_resume_gap':
      return (
        '<rect x="20" y="52" width="40" height="8" rx="2" fill="#94A3B8"/>' +
        '<rect x="80" y="52" width="100" height="8" rx="2" fill="#94A3B8"/>' +
        tag(48, 36, 'GAP', '#FEE2E2', '#B91C1C') +
        tag(118, 28, '5yr', '#E0E7FF', '#3730A3')
      );
    case 'problem_pipeline_tangle':
      return (
        '<path d="M30 80 C60 20 90 100 120 40 S160 90 180 50" stroke="#DC2626" stroke-width="3" fill="none"/>' +
        tag(68, 12, 'pipeline', '#FEE2E2', '#B91C1C') +
        tag(118, 78, 'complex', '#FEF3C7', '#D97706')
      );
    case 'problem_syntax_memory':
      return (
        monitor(24, 20, 152, 76, '{ ??? }', '#7C3AED') +
        tag(118, 8, 'syntax', '#EDE9FE', '#5B21B6')
      );
    case 'action_lead_team':
      return monitor(32, 18, 136, 80, 'LEAD', '#059669') + tag(72, 6, '3mo', '#D1FAE5', '#047857');
    case 'action_validation':
      return monitor(24, 18, 152, 80, 'check', '#059669') + tag(88, 6, 'validate', '#D1FAE5', '#047857');
    case 'action_double_check':
      return (
        '<path d="M68 48 L78 58 L98 38" stroke="#059669" stroke-width="3" fill="none"/>' +
        '<path d="M108 48 L118 58 L138 38" stroke="#059669" stroke-width="3" fill="none"/>' +
        tag(62, 72, '2x check', '#D1FAE5', '#047857')
      );
    case 'action_sql_index':
      return monitor(28, 18, 144, 80, 'SQL', '#059669') + tag(72, 6, '+INDEX', '#D1FAE5', '#047857');
    case 'action_python_ai':
      return monitor(20, 22, 80, 72, 'Py', '#2563EB') + monitor(108, 22, 80, 72, 'AI', '#7C3AED');
    case 'action_arch_design':
      return (
        '<rect x="48" y="70" width="104" height="16" rx="3" fill="#94A3B8"/>' +
        '<rect x="56" y="52" width="88" height="16" rx="3" fill="#64748B"/>' +
        '<rect x="64" y="34" width="72" height="16" rx="3" fill="#334155"/>' +
        tag(58, 12, 'design', '#E0E7FF', '#3730A3')
      );
    case 'action_read_docs':
      return monitor(16, 22, 80, 76, 'DOC', '#7C3AED') + monitor(108, 22, 80, 76, 'code', '#059669');
    case 'result_accuracy_cloud':
      return tag(32, 32, '100%', '#D1FAE5', '#047857') + tag(108, 32, 'AWS', '#DBEAFE', '#1D4ED8');
    case 'result_arch_mentor':
      return (
        '<rect x="48" y="70" width="104" height="16" rx="3" fill="#334155"/>' +
        '<rect x="56" y="52" width="88" height="16" rx="3" fill="#64748B"/>' +
        '<rect x="64" y="34" width="72" height="16" rx="3" fill="#94A3B8"/>' +
        tag(68, 12, 'arch', '#E0E7FF', '#3730A3') +
        tag(118, 78, 'mentor', '#D1FAE5', '#047857')
      );
    case 'result_learn_fast':
      return (
        tag(28, 36, 'AWS', '#DBEAFE', '#1D4ED8') +
        '<path d="M88 72 L88 36 M88 36 L76 48 M88 36 L100 48" stroke="#059669" stroke-width="3" fill="none"/>' +
        tag(108, 28, 'fast', '#D1FAE5', '#047857')
      );
    case 'night_code':
      return (
        '<text x="22" y="52" font-size="26">🌙</text>' +
        monitor(52, 22, 128, 78, 'shell', '#059669')
      );
    case 'result_unified': {
      const screen = plan.screen || 'UI';
      let s =
        monitor(4, 36, 50, 52, 'ETL', '#CBD5E1') +
        monitor(58, 36, 50, 52, 'logs', '#CBD5E1') +
        '<path d="M112 62 H124 M124 62 L119 57 M124 62 L119 67" stroke="#64748B" stroke-width="2.5" fill="none"/>' +
        `<rect x="130" y="22" width="66" height="86" rx="8" fill="#ECFDF5" stroke="#059669" stroke-width="3"/>` +
        monitor(134, 26, 58, 78, screen, '#059669');
      if (plan.time) s += tag(148, 6, '-time', '#D1FAE5', '#047857');
      return s;
    }
    case 'result_doc_std':
      return (
        `<rect x="42" y="14" width="116" height="92" rx="8" fill="#F5F3FF" stroke="#059669" stroke-width="3"/>` +
        monitor(46, 18, 108, 84, 'DOC', '#7C3AED') +
        tag(128, 8, 'std', '#D1FAE5', '#047857')
      );
    case 'result_mts_launch':
      return (
        monitor(38, 18, 124, 78, 'MTS', '#059669') +
        tag(52, 8, (plan.count || '50') + ' API', '#DBEAFE', '#1D4ED8')
      );
    case 'result_api_split':
      return (
        monitor(8, 22, 88, 48, 'trade', '#059669') +
        monitor(104, 22, 88, 48, 'user', '#059669') +
        monitor(8, 76, 88, 38, 'news', '#94A3B8') +
        tag(72, 78, 'X', '#FEE2E2', '#B91C1C') +
        monitor(104, 76, 88, 38, 'price', '#059669') +
        tag(130, 78, 'OK', '#D1FAE5', '#047857')
      );
    case 'result_shield':
      return (
        monitor(36, 22, 128, 76, plan.title || 'BATCH', '#059669') +
        `<path d="M100 38 L118 48 V68 L100 78 L82 68 V48 Z" fill="#DCFCE7" stroke="#059669" stroke-width="2.5"/>` +
        '<text x="100" y="64" text-anchor="middle" font-size="16" font-weight="900" fill="#059669">✓</text>'
      );
    case 'result_batch_fast':
      return monitor(32, 18, 136, 80, 'BATCH', '#059669') + tag(72, 8, 'fast', '#D1FAE5', '#047857');
    case 'result_home_work':
      return (
        '<rect x="28" y="28" width="56" height="48" rx="6" fill="#E0E7FF" stroke="#6366F1" stroke-width="2"/>' +
        '<path d="M40 64 L56 48 L72 64 Z" fill="#6366F1"/>' +
        '<rect x="44" y="64" width="24" height="14" fill="#6366F1"/>' +
        '<rect x="108" y="32" width="64" height="52" rx="6" fill="#ECFDF5" stroke="#059669" stroke-width="2"/>' +
        '<text x="140" y="58" text-anchor="middle" font-size="22" font-weight="800" fill="#059669">work</text>' +
        tag(118, 18, '100%', '#D1FAE5', '#047857')
      );
    case 'result_arch_layers':
      return (
        '<rect x="48" y="70" width="104" height="18" rx="4" fill="#94A3B8"/>' +
        '<rect x="56" y="50" width="88" height="18" rx="4" fill="#64748B"/>' +
        '<rect x="64" y="30" width="72" height="18" rx="4" fill="#334155"/>' +
        tag(68, 8, 'arch', '#E0E7FF', '#3730A3')
      );
    case 'result_cloud_up':
      return (
        '<ellipse cx="72" cy="52" rx="40" ry="26" fill="#E0F2FE" stroke="#0EA5E9" stroke-width="2"/>' +
        '<text x="72" y="58" text-anchor="middle" font-size="14" font-weight="800" fill="#0369A1">cloud</text>' +
        '<path d="M118 62 L148 42 M148 42 L138 42 M148 42 L148 52" stroke="#059669" stroke-width="3" fill="none"/>' +
        tag(118, 24, 'AWS', '#DBEAFE', '#1D4ED8')
      );
    case 'result_money_stable':
      return (
        tag(28, 28, '$800B', '#D1FAE5', '#047857') +
        '<path d="M100 78 L100 38 M100 38 L88 50 M100 38 L112 50" stroke="#059669" stroke-width="3" fill="none"/>' +
        tag(118, 32, 'stable', '#D1FAE5', '#047857')
      );
    case 'result_metric_up':
      return (
        '<rect x="52" y="72" width="24" height="28" fill="#94A3B8" rx="2"/>' +
        '<rect x="82" y="56" width="24" height="44" fill="#64748B" rx="2"/>' +
        '<rect x="112" y="40" width="24" height="60" fill="#059669" rx="2"/>' +
        tag(78, 12, plan.title || 'up', '#D1FAE5', '#047857')
      );
    case 'money':
      return tag(36, 42, '$800B', '#D1FAE5', '#047857') + monitor(95, 22, 90, 76, 'SYS', '#059669');
    case 'doc':
      return monitor(48, 16, 104, 88, 'DOC', '#7C3AED');
    case 'mobile':
      return monitor(52, 10, 96, 100, 'MTS', '#059669');
    case 'alert':
      return monitor(36, 20, 128, 80, 'BATCH', '#DC2626') + tag(82, 6, '!', '#FEE2E2', '#B91C1C');
    case 'problem':
      return monitor(52, 22, 96, 76, '!', '#DC2626');
    default:
      return monitor(40, 18, 120, 84, '—', '#94A3B8');
  }
}

/** 그림만 — 단계·한글 캡션 없음 */
export function buildPanelSvg(stepIndex, topic) {
  const plan = planPanelVisualForTopic(topic || {}, stepIndex);
  const visual = drawPlanned(plan);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">
  <rect width="${W}" height="${H}" fill="#F8FAFC" rx="8"/>
  ${visual}
</svg>`;
}

export function buildSvgPanels(topic) {
  return STEP_TAGS.map((stepTag, i) => ({
    stepTag,
    svg: buildPanelSvg(i, topic),
  }));
}

export function svgToDataUri(svg) {
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

export function generateTopicComic(topic, opts = {}) {
  const topicId = topic.id || 'topic-custom';
  const panelsBuilt = buildSvgPanels(topic);
  const captionKo = '';
  const panelKeywords = extractDistinctiveKeywords(topic);

  const contentRoot = opts.contentRoot;
  const preferFiles = opts.preferFiles !== false && contentRoot;

  if (preferFiles) {
    const dir = path.join(contentRoot, 'comics', topicId);
    fs.mkdirSync(dir, { recursive: true });
    const urls = panelsBuilt.map((p, i) => {
      const fname = `panel-${i + 1}.svg`;
      fs.writeFileSync(path.join(dir, fname), p.svg, 'utf8');
      return `/content/comics/${topicId}/${fname}`;
    });
    return {
      topicComic: { captionKo, panels: urls, panelKeywords },
      wroteFiles: true,
    };
  }

  const urls = panelsBuilt.map((p) => svgToDataUri(p.svg));
  return { topicComic: { captionKo, panels: urls, panelKeywords }, wroteFiles: false };
}

export function writeTopicComicFiles(topic, contentRoot) {
  return generateTopicComic(topic, { contentRoot, preferFiles: true });
}
