import assert from 'node:assert/strict';
import {mapLandingTraits, requiredSample, classifyRole, pearson} from '../src/domain/culture-model.js';
import {computeCultureMetrics} from '../src/application/culture-metrics.js';
import {buildCultureInforme} from '../src/application/culture-diagnosis.js';

assert.equal(requiredSample(50), 45);
assert.equal(requiredSample(200), 132);
assert.equal(classifyRole('directivo'), 'lider');
assert.equal(classifyRole('jefe'), 'lider');
assert.equal(classifyRole('profesional'), 'empleado');
assert.deepEqual(
  mapLandingTraits(['Colaborativa', 'Innovadora']).map((item) => item.valor_taleX),
  ['Trabajo en equipo', 'Innovación y riesgo'],
);
assert.ok(pearson([1, 2, 3], [1, 2, 3]) > 0.99);

const values = [
  {id: 'innovacion', dimension: 'Innovación y riesgo'},
  {id: 'estabilidad', dimension: 'Estabilidad'},
  {id: 'personas', dimension: 'Respeto por las personas'},
  {id: 'resultados', dimension: 'Orientación a resultados'},
  {id: 'detalle', dimension: 'Atención al detalle'},
  {id: 'equipo', dimension: 'Trabajo en equipo'},
  {id: 'competitividad', dimension: 'Competitividad'},
];
const needs = [
  {id: 'empleo', dimension: 'Estabilidad del empleo'},
  {id: 'formacion', dimension: 'Formación'},
  {id: 'flexibilidad', dimension: 'Flexibilidad'},
  {id: 'autonomia', dimension: 'Autonomía'},
  {id: 'pago', dimension: 'Pago por resultados'},
  {id: 'crecimiento', dimension: 'Crecimiento profesional'},
  {id: 'reconocimiento', dimension: 'Reconocimiento'},
  {id: 'claridad', dimension: 'Claridad del rol'},
  {id: 'feedback', dimension: 'Retroalimentación'},
  {id: 'proposito', dimension: 'Propósito'},
  {id: 'carga', dimension: 'Carga de trabajo sostenible'},
  {id: 'companeros', dimension: 'Relaciones con compañeros'},
];
const questions = [
  ...['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08'].map((code) => ({
    id: code,
    code,
    format: 'most_least',
    options: values,
    askForecast: ['C02', 'C03', 'C05'].includes(code),
  })),
  {
    id: 'D01',
    code: 'D01',
    format: 'value_coherence',
    items: mapLandingTraits(['Colaborativa', 'Innovadora']),
  },
  {id: 'O01', code: 'O01', format: 'pick_yes_no', options: needs, yesCount: 4, noCount: 3},
  {id: 'A01', code: 'A01', format: 'text'},
  {id: 'K01', code: 'K01', format: 'single', options: [{id: 'tecnologia', label: 'Tecnología'}]},
  {id: 'K02', code: 'K02', format: 'single', options: []},
  {id: 'K03', code: 'K03', format: 'single', options: []},
  {id: 'K04', code: 'K04', format: 'single', options: []},
];

function person(id, role, most = 'equipo', least = 'competitividad') {
  const answers = [];
  const sessionId = id;
  for (const code of ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08']) {
    answers.push({
      session_id: sessionId,
      question_code: code,
      format: 'most_least',
      value: {most, least, forecast: ['C02', 'C03', 'C05'].includes(code) ? 60 : null},
    });
  }
  answers.push({
    session_id: sessionId,
    question_code: 'D01',
    format: 'value_coherence',
    value: {
      ratings: {colaborativa: 'vive', innovadora: 'medias'},
      items: mapLandingTraits(['Colaborativa', 'Innovadora']),
    },
  });
  answers.push({
    session_id: sessionId,
    question_code: 'O01',
    format: 'pick_yes_no',
    value: {yes: ['empleo', 'formacion', 'flexibilidad', 'companeros'], no: ['pago', 'autonomia', 'carga']},
  });
  answers.push({
    session_id: sessionId,
    question_code: 'A01',
    format: 'text',
    value: {value_text: 'Aquí le va bien al que ayuda al equipo y le va mal al que solo busca ganar'},
  });
  answers.push({session_id: sessionId, question_code: 'K01', format: 'single', value: {value: 'tecnologia'}});
  answers.push({session_id: sessionId, question_code: 'K02', format: 'single', value: {value: role}});
  answers.push({session_id: sessionId, question_code: 'K03', format: 'single', value: {value: '1_3'}});
  answers.push({session_id: sessionId, question_code: 'K04', format: 'single', value: {value: 'presencial'}});
  return {
    session: {id: sessionId, status: 'completed', organization_id: 'org'},
    answers,
  };
}

const leaders = ['l1', 'l2', 'l3', 'l4', 'l5'].map((id) => person(id, 'directivo', 'resultados', 'equipo'));
const employees = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((id) => person(id, 'profesional', 'equipo', 'competitividad'));
const rows = [...leaders, ...employees];
const metrics = computeCultureMetrics({
  organization: {name: 'Demo'},
  lead: {perceived_culture: ['Colaborativa', 'Innovadora']},
  questions,
  sessions: rows.map((item) => item.session),
  answers: rows.flatMap((item) => item.answers),
  totalEmpleados: 20,
  plantilla: [{id: 'tecnologia', label: 'Tecnología', n: 20}],
  fechaCorte: '2026-10-25',
});
const informe = buildCultureInforme(metrics);

assert.equal(informe.version_informe, 'TaleX-Cultura-1.0');
assert.equal(informe.calidad_de_datos.respuestas_lideres, 5);
assert.equal(informe.calidad_de_datos.respuestas_empleados, 6);
assert.equal(informe.calidad_de_datos.muestra_requerida, 20);
assert.equal(informe.espejo_liderazgo.por_valor.length, 7);
assert.equal(informe.implicaciones_para_contratar.preguntas_de_entrevista.length, 5);
assert.equal(informe.resumen_ejecutivo.lo_que_debe_saber.length, 3);
assert.equal(informe.adn_cultural.valores_dominantes[0], 'Trabajo en equipo');
assert.ok(informe.sello_taleX.estado === 'no_validada' || informe.sello_taleX.estado === 'validada_con_reservas');
assert.equal(informe.implicaciones_para_contratar.perfil_de_referencia.fuente, 'empleados');
console.log('culture-diagnosis ok', informe.sello_taleX.estado, informe.adn_cultural.arquetipo);
