import {
  CULTURE_CODES,
  CULTURE_VALUES,
  FORECAST_CODES,
  classifyRole,
  d01Score,
  d01Verdict,
  forceLevel,
  gapState,
  landingTrait,
  pearson,
  requiredSample,
  round2,
  roundInt,
  sampleStd,
  stripIdentifying,
} from '../domain/culture-model.js';

const VALUE_KEYWORDS = {
  'Innovación y riesgo': ['innova', 'prueba', 'arriesg', 'cambia', 'aprend', 'idea nueva', 'experiment'],
  Estabilidad: ['proces', 'estable', 'siempre se ha', 'constan', 'seguro', 'norma'],
  'Respeto por las personas': ['persona', 'trato', 'respet', 'escuch', 'bienestar', 'cuidado'],
  'Orientación a resultados': ['resultado', 'meta', 'número', 'cumple', 'entrega', 'mide'],
  'Atención al detalle': ['detalle', 'revis', 'error', 'calidad', 'control'],
  'Trabajo en equipo': ['equipo', 'juntos', 'colabor', 'ayuda', 'entre todos'],
  Competitividad: ['competenc', 'ganar', 'primero', 'destaca', 'superar'],
};

function optionDimension(question, optionId) {
  const pool = [...(question.options || []), ...(question.items || [])];
  const match = pool.find((item) => item.id === optionId);
  return match?.dimension || match?.valor_taleX || null;
}

function emptyProfile() {
  return Object.fromEntries(CULTURE_VALUES.map((value) => [value, 0]));
}

function personValueProfile(answersByCode, questionsByCode) {
  const totals = emptyProfile();
  let counted = 0;
  for (const code of CULTURE_CODES) {
    const answer = answersByCode[code];
    const question = questionsByCode[code];
    if (!answer || !question) continue;
    counted += 1;
    const most = optionDimension(question, answer.most);
    const least = optionDimension(question, answer.least);
    if (most && most in totals) totals[most] += 1;
    if (least && least in totals) totals[least] -= 1;
  }
  if (!counted) return null;
  return Object.fromEntries(
    CULTURE_VALUES.map((value) => [value, totals[value] / counted]),
  );
}

function meanProfiles(profiles) {
  if (!profiles.length) return null;
  const sums = emptyProfile();
  for (const profile of profiles) {
    for (const value of CULTURE_VALUES) sums[value] += profile[value] || 0;
  }
  return Object.fromEntries(
    CULTURE_VALUES.map((value) => [value, sums[value] / profiles.length]),
  );
}

function vectorOf(profile) {
  return CULTURE_VALUES.map((value) => profile?.[value] ?? 0);
}

function classifyOpen(text) {
  const hay = String(text || '').toLowerCase();
  const hits = [];
  for (const [value, words] of Object.entries(VALUE_KEYWORDS)) {
    if (words.some((word) => hay.includes(word))) hits.push(value);
  }
  return hits[0] || null;
}

function splitOpen(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/le va bien al que\s*(.+?)\s*(?:y|,)\s*le va mal al que\s*(.+)/i);
  if (match) return {bien: match[1].trim(), mal: match[2].trim()};
  const parts = raw.split(/\s+y le va mal al que\s+/i);
  if (parts.length === 2) {
    return {
      bien: parts[0].replace(/^aquí le va bien al que\s*/i, '').trim(),
      mal: parts[1].trim(),
    };
  }
  return {bien: raw, mal: ''};
}

export function groupRespondents(sessions, answers, questions) {
  const questionsByCode = new Map(questions.map((item) => [item.code || item.id, item]));
  const answersBySession = new Map();
  for (const answer of answers) {
    const bag = answersBySession.get(answer.session_id) || {};
    bag[answer.question_code || answer.question_id] = {
      ...(answer.value && typeof answer.value === 'object' ? answer.value : {}),
      value_int: answer.value_int,
      value_text: answer.value_text,
      items: answer.value?.items || answer.items,
    };
    answersBySession.set(answer.session_id, bag);
  }
  return sessions
    .filter((session) => session.status === 'completed')
    .map((session) => {
      const bag = answersBySession.get(session.id) || {};
      const role = classifyRole(bag.K02?.value);
      return {
        sessionId: session.id,
        role,
        group: role === 'lider' ? 'lideres' : role === 'empleado' ? 'empleados' : 'sin_rol',
        area: bag.K01?.value || null,
        tenure: bag.K03?.value || null,
        modality: bag.K04?.value || null,
        answers: bag,
        profile: personValueProfile(bag, Object.fromEntries(questionsByCode)),
        questionsByCode,
      };
    });
}

function offerMeans(people) {
  const sums = new Map();
  const counts = new Map();
  for (const person of people) {
    const yes = new Set(person.answers.O01?.yes || []);
    const no = new Set(person.answers.O01?.no || []);
    const question = person.questionsByCode.get('O01');
    for (const option of question?.options || []) {
      const key = option.dimension || option.label || option.id;
      if (!sums.has(key)) {
        sums.set(key, 0);
        counts.set(key, 0);
      }
      counts.set(key, counts.get(key) + 1);
      if (yes.has(option.id)) sums.set(key, sums.get(key) + 1);
      else if (no.has(option.id)) sums.set(key, sums.get(key) - 1);
    }
  }
  return [...sums.entries()].map(([necesidad, total]) => ({
    necesidad,
    puntaje: round2(total / (counts.get(necesidad) || 1)),
  })).sort((a, b) => b.puntaje - a.puntaje || a.necesidad.localeCompare(b.necesidad));
}

function coherence(people) {
  const scores = [];
  for (const person of people) {
    const ratings = person.answers.D01?.ratings || {};
    const items = person.answers.D01?.items || person.questionsByCode.get('D01')?.items || [];
    const values = Object.values(ratings).map(d01Score).filter((item) => item != null);
    if (!values.length) continue;
    scores.push(values.reduce((sum, item) => sum + item, 0) / values.length);
    person._d01Items = items;
    person._d01Ratings = ratings;
  }
  if (!scores.length) return null;
  return scores.reduce((sum, item) => sum + item, 0) / scores.length;
}

function declaredRows(people) {
  const byId = new Map();
  for (const person of people) {
    const ratings = person.answers.D01?.ratings || {};
    const items = person.answers.D01?.items || person.questionsByCode.get('D01')?.items || [];
    const itemById = new Map(items.map((item) => [item.id, item]));
    for (const [id, raw] of Object.entries(ratings)) {
      const score = d01Score(raw);
      if (score == null) continue;
      const item = itemById.get(id);
      const trait = landingTrait(item) || landingTrait(item?.label) || {
        id,
        label: item?.label || id,
        valorTaleX: item?.dimension || item?.valor_taleX || null,
      };
      if (!byId.has(id)) {
        byId.set(id, {
          valor_declarado: trait.label,
          valor_taleX: trait.valorTaleX || trait.dimension || null,
          lideres: [],
          empleados: [],
        });
      }
      const row = byId.get(id);
      if (person.group === 'lideres') row.lideres.push(score);
      if (person.group === 'empleados') row.empleados.push(score);
    }
  }
  return [...byId.values()].map((row) => {
    const lideres = row.lideres.length
      ? round2(row.lideres.reduce((sum, item) => sum + item, 0) / row.lideres.length)
      : null;
    const empleados = row.empleados.length
      ? round2(row.empleados.reduce((sum, item) => sum + item, 0) / row.empleados.length)
      : null;
    const basis = empleados ?? lideres;
    return {
      valor_declarado: row.valor_declarado,
      valor_taleX: row.valor_taleX,
      lideres,
      empleados,
      veredicto: d01Verdict(basis),
    };
  });
}

function forceIndex(profiles) {
  if (profiles.length < 2) return null;
  const stds = CULTURE_VALUES.map((value) => sampleStd(profiles.map((item) => item[value] || 0)));
  const known = stds.filter((item) => item != null);
  if (!known.length) return null;
  const meanStd = known.reduce((sum, item) => sum + item, 0) / known.length;
  return Math.max(0, Math.min(100, 100 * (1 - meanStd)));
}

function voice(people, side) {
  const bag = new Map();
  for (const person of people) {
    const text = person.answers.A01?.value_text || person.answers.A01?.value || '';
    const parts = splitOpen(text);
    const chunk = stripIdentifying(parts[side]);
    if (!chunk) continue;
    const value = classifyOpen(chunk) || 'sin_clasificar';
    const key = chunk.toLowerCase();
    if (!bag.has(key)) bag.set(key, {tema: chunk, valor: value, n: 0, cita: chunk});
    bag.get(key).n += 1;
  }
  const total = people.length || 1;
  return [...bag.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map((item) => ({
      tema: item.tema.slice(0, 80),
      valor: item.valor === 'sin_clasificar' ? CULTURE_VALUES[0] : item.valor,
      frecuencia_pct: roundInt((item.n / total) * 100),
      cita_anonima: item.cita.slice(0, 180),
    }));
}

function sincerity(people, questionsByCode) {
  let leaderOver = false;
  const silent = [];
  for (const code of FORECAST_CODES) {
    const question = questionsByCode.get(code);
    if (!question) continue;
    const rows = people.filter((person) => person.answers[code]?.most);
    if (!rows.length) continue;
    const counts = new Map();
    for (const person of rows) {
      const most = person.answers[code].most;
      counts.set(most, (counts.get(most) || 0) + 1);
    }
    const forecasts = rows
      .map((person) => Number(person.answers[code].forecast))
      .filter((item) => Number.isInteger(item));
    const predicted = forecasts.length
      ? forecasts.reduce((sum, item) => sum + item, 0) / forecasts.length
      : null;
    const leaders = rows.filter((person) => person.group === 'lideres');
    if (leaders.length) {
      const leaderForecasts = leaders
        .map((person) => Number(person.answers[code].forecast))
        .filter((item) => Number.isInteger(item));
      if (leaderForecasts.length) {
        const meanForecast = leaderForecasts.reduce((sum, item) => sum + item, 0) / leaderForecasts.length;
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        const real = top ? (top[1] / rows.length) * 100 : 0;
        if (meanForecast - real > 20) leaderOver = true;
      }
    }
    for (const [optionId, count] of counts.entries()) {
      const realPct = (count / rows.length) * 100;
      if (predicted == null || realPct - predicted < 20 || realPct < 40) continue;
      const option = (question.options || []).find((item) => item.id === optionId);
      silent.push({
        pregunta: code,
        opcion: option?.label || optionId,
        valor: option?.dimension || null,
        real_pct: roundInt(realPct),
        pronosticado_pct: roundInt(predicted),
        lectura: `En ${code}, "${option?.label || optionId}" fue más frecuente de lo que el grupo creyó compartir.`,
      });
    }
  }
  return {sobreestimacion_de_consenso: leaderOver, normas_silenciosas: silent};
}

function representativeness(people, plantilla, totalEmpleados) {
  if (!plantilla?.length || !totalEmpleados) return [];
  const withArea = people.filter((person) => person.area);
  const n = withArea.length || 1;
  return plantilla.map((area) => {
    const responses = withArea.filter((person) => person.area === area.id).length;
    const pctRespuestas = (responses / n) * 100;
    const pctPlantilla = (area.n / totalEmpleados) * 100;
    const diff = pctRespuestas - pctPlantilla;
    let estado = 'adecuada';
    if (diff > 5) estado = 'sobrerrepresentada';
    else if (diff < -5) estado = 'subrepresentada';
    return {
      area: area.label,
      pct_plantilla: roundInt(pctPlantilla),
      pct_respuestas: roundInt(pctRespuestas),
      estado,
    };
  });
}

function subcultures(employees, globalProfile, areas) {
  const areaById = new Map((areas || []).map((item) => [item.id, item.label]));
  const byArea = new Map();
  for (const person of employees) {
    if (!person.area || !person.profile) continue;
    if (!byArea.has(person.area)) byArea.set(person.area, []);
    byArea.get(person.area).push(person);
  }
  const rows = [];
  for (const [area, group] of byArea.entries()) {
    if (group.length < 5) continue;
    const profile = meanProfiles(group.map((item) => item.profile).filter(Boolean));
    const r = pearson(vectorOf(profile), vectorOf(globalProfile));
    if (r == null || r >= 0.5) continue;
    const gaps = CULTURE_VALUES.map((value) => ({
      value,
      gap: (profile[value] || 0) - (globalProfile[value] || 0),
    })).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    rows.push({
      grupo: areaById.get(area) || area,
      n: group.length,
      correlacion_con_global: round2(r),
      diferencia_principal: `Se aparta sobre todo en ${gaps[0].value}.`,
      implicacion: 'Conviene evaluar candidatos también contra el perfil de esta área.',
    });
  }
  return rows;
}

function validation({employeeN, required, alignment, force}) {
  const coverage = required ? employeeN / required : null;
  const alignmentOk = alignment != null && alignment >= 70;
  const forceOk = force != null && force >= 60;
  const sampleOk = required != null && employeeN >= required;
  const nearSample = required != null && employeeN >= 0.8 * required;
  const conditions = [];
  const pending = [];
  if (sampleOk) conditions.push('muestra_empleados_suficiente');
  else pending.push('muestra_empleados_insuficiente');
  if (alignmentOk) conditions.push('alineacion_lideres_empleados');
  else pending.push('alineacion_insuficiente');
  if (forceOk) conditions.push('fuerza_cultural');
  else pending.push('fuerza_cultural_insuficiente');

  if (required == null || !nearSample || (alignment != null && alignment < 50) || (force != null && force < 50)) {
    return {estado: 'no_validada', conditions, pending, coverage};
  }
  if (sampleOk && alignmentOk && forceOk) {
    return {estado: 'validada', conditions, pending, coverage};
  }
  return {estado: 'validada_con_reservas', conditions, pending, coverage};
}

export function computeCultureMetrics({
  organization,
  lead,
  questions,
  sessions,
  answers,
  totalEmpleados,
  plantilla,
  fechaCorte,
}) {
  const people = groupRespondents(sessions, answers, questions);
  const leaders = people.filter((item) => item.group === 'lideres' && item.profile);
  const employees = people.filter((item) => item.group === 'empleados' && item.profile);
  const leaderProfile = meanProfiles(leaders.map((item) => item.profile));
  const employeeProfile = meanProfiles(employees.map((item) => item.profile));
  const required = requiredSample(totalEmpleados);
  const alignmentR = leaderProfile && employeeProfile
    ? pearson(vectorOf(leaderProfile), vectorOf(employeeProfile))
    : null;
  const alignment = alignmentR == null ? null : Math.max(0, alignmentR) * 100;
  const force = forceIndex(employees.map((item) => item.profile));
  const decision = validation({
    employeeN: employees.length,
    required,
    alignment,
    force,
  });
  const questionsByCode = new Map(questions.map((item) => [item.code || item.id, item]));
  const offerEmployees = offerMeans(employees);
  const offerLeaders = offerMeans(leaders);
  const offerMap = new Map(offerLeaders.map((item) => [item.necesidad, item.puntaje]));
  const promises = offerEmployees
    .map((item) => {
      const lideres = offerMap.get(item.necesidad);
      if (lideres == null) return null;
      const brecha = round2(lideres - item.puntaje);
      if (brecha == null || brecha <= 0.4) return null;
      return {
        necesidad: item.necesidad,
        lideres,
        empleados: item.puntaje,
        brecha,
        riesgo: 'Los líderes describen una oferta que los empleados no confirman.',
      };
    })
    .filter(Boolean);
  const perValue = CULTURE_VALUES.map((valor) => {
    const lideres = leaderProfile ? round2(leaderProfile[valor]) : null;
    const empleados = employeeProfile ? round2(employeeProfile[valor]) : null;
    const brecha = lideres != null && empleados != null ? round2(lideres - empleados) : null;
    return {
      valor,
      lideres,
      empleados,
      brecha,
      estado: brecha == null ? 'alineado' : gapState(Math.abs(brecha)),
      evidencia: `C01–C08. Líderes n=${leaders.length}; empleados n=${employees.length}.`,
    };
  });
  const rankedEmployees = [...(perValue || [])]
    .filter((item) => item.empleados != null)
    .sort((a, b) => b.empleados - a.empleados);
  const sinc = sincerity(people, questionsByCode);
  const areas = plantilla?.length
    ? plantilla.map((item) => ({id: item.id, label: item.label}))
    : [];
  return {
    empresa: {
      nombre: organization?.name || lead?.company_name || null,
      fecha_corte: fechaCorte,
      total_empleados: totalEmpleados ?? null,
    },
    people,
    leaders,
    employees,
    leaderProfile,
    employeeProfile,
    required,
    alignment: alignment == null ? null : roundInt(alignment),
    force: force == null ? null : roundInt(force),
    forceNivel: forceLevel(force),
    decision,
    perValue,
    rankedEmployees,
    coherenceLeaders: coherence(leaders),
    coherenceEmployees: coherence(employees),
    declaredRows: declaredRows(people),
    offerEmployees,
    promises,
    sincerity: sinc,
    representativeness: representativeness(people, plantilla, totalEmpleados),
    subcultures: employeeProfile ? subcultures(employees, employeeProfile, areas) : [],
    voiceBien: voice(employees, 'bien'),
    voiceMal: voice(employees, 'mal'),
    coveragePct: required ? roundInt((employees.length / required) * 100) : null,
    leadTraits: lead?.perceived_culture || organization?.declared_values || [],
  };
}
