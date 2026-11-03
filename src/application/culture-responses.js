import {findMany, findOne} from '../domain/store.js';
import {classifyRole, stripIdentifying} from '../domain/culture-model.js';
import {loadCompanyCultureQuestions} from './culture-employee-survey.js';

function optionOf(question, id) {
  const pool = [...(question?.options || []), ...(question?.items || [])];
  return pool.find((item) => item.id === id) || null;
}

function labelOf(question, id) {
  const option = optionOf(question, id);
  if (!option) return id || null;
  return option.dimension ? `${option.label} (${option.dimension})` : option.label;
}

function lectura(question, value) {
  if (!value || typeof value !== 'object') return value ?? null;
  if (question?.format === 'most_least') {
    const forecast = Number.isInteger(value.forecast) ? ` Pronóstico ${value.forecast}%.` : '';
    return `Más probable: ${labelOf(question, value.most)}. Menos probable: ${labelOf(question, value.least)}.${forecast}`;
  }
  if (question?.format === 'value_coherence') {
    const items = value.items || question.items || [];
    const parts = Object.entries(value.ratings || {}).map(([id, raw]) => {
      const item = items.find((row) => row.id === id);
      const mark = raw === 'vive' ? 'Se vive' : raw === 'medias' ? 'A medias' : raw === 'pared' ? 'Solo en la pared' : raw;
      return `${item?.label || id}: ${mark}`;
    });
    return parts.join('; ') || null;
  }
  if (question?.format === 'pick_yes_no') {
    const yes = (value.yes || []).map((id) => labelOf(question, id)).join(', ');
    const no = (value.no || []).map((id) => labelOf(question, id)).join(', ');
    return `Sí ofrece: ${yes || '—'}. No espere: ${no || '—'}.`;
  }
  if (question?.format === 'text') {
    return stripIdentifying(value.value_text || value.value || '');
  }
  if (question?.format === 'single') {
    return labelOf(question, value.value);
  }
  return value;
}

export async function listCultureResponses(organizationId) {
  const organization = await findOne('organizations', {id: organizationId});
  if (!organization) return null;
  const leads = await findMany(
    'culture_leads',
    {organization_id: organizationId},
    {sort: {created_at: 1}, limit: 1},
  );
  const survey = await loadCompanyCultureQuestions(organization, leads[0] || null);
  const questionsByCode = new Map(survey.questions.map((item) => [item.code || item.id, item]));
  const sessions = await findMany(
    'survey_sessions',
    {organization_id: organizationId, purpose: 'culture_perception'},
    {sort: {completed_at: -1, started_at: -1}, limit: 5000},
  );
  const answers = sessions.length
    ? await findMany(
        'survey_answers',
        {session_id: {$in: sessions.map((item) => item.id)}},
        {limit: 5000},
      )
    : [];
  const bySession = new Map();
  for (const answer of answers) {
    const bag = bySession.get(answer.session_id) || [];
    bag.push(answer);
    bySession.set(answer.session_id, bag);
  }
  const respondentes = sessions.map((session, index) => {
    const rows = (bySession.get(session.id) || []).sort((a, b) =>
      String(a.question_code).localeCompare(String(b.question_code)),
    );
    const mapped = rows.map((answer) => {
      const question = questionsByCode.get(answer.question_code || answer.question_id);
      const value = answer.value && typeof answer.value === 'object' ? answer.value : {value: answer.value};
      return {
        code: answer.question_code || answer.question_id,
        name: question?.name || null,
        statement: question?.statement || answer.statement_a || null,
        format: answer.format || question?.format || null,
        value,
        lectura: lectura(question, value),
      };
    });
    const k02 = mapped.find((item) => item.code === 'K02')?.value?.value;
    const k01 = mapped.find((item) => item.code === 'K01')?.value?.value;
    return {
      respondente: `persona_${index + 1}`,
      sessionId: session.id,
      status: session.status,
      completedAt: session.completed_at || session.completedAt || null,
      grupo: classifyRole(k02) === 'lider' ? 'lider' : classifyRole(k02) === 'empleado' ? 'empleado' : 'sin_rol',
      rol: k02 || null,
      area: k01 || null,
      respuestas: mapped,
    };
  });
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    totalSesiones: respondentes.length,
    totalCompletadas: respondentes.filter((item) => item.status === 'completed').length,
    totalRespuestas: answers.length,
    lideres: respondentes.filter((item) => item.grupo === 'lider').length,
    empleados: respondentes.filter((item) => item.grupo === 'empleado').length,
    respondentes,
  };
}
