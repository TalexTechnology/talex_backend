import {renderCultureReportPdf} from '../src/application/culture-report-pdf.js';

const informe = {
  version_informe: 'TaleX-Cultura-1.0',
  empresa: {nombre: 'EMpresa de Prueba', fecha_corte: '2026-10-26', total_empleados: 50},
  resumen_ejecutivo: {
    titular: 'Aqui se vive respeto por las personas, no tanto orientacion a resultados',
    lo_que_debe_saber: ['Cultura real: respeto e innovacion.', 'Alineacion 88.'],
    verdad_incomoda: 'En innovacion la brecha lideres-empleados es 0.25.',
  },
  calidad_de_datos: {respuestas_lideres: 5, respuestas_empleados: 15},
  adn_cultural: {
    arquetipo: 'Cultura cercana y innovadora',
    descripcion: 'Los empleados describen un lugar donde prima el respeto.',
    valores_dominantes: ['Respeto por las personas', 'Innovacion y riesgo'],
    valores_debiles: ['Orientacion a resultados', 'Estabilidad'],
    fuerza_cultural: {indice: 56, nivel: 'fragmentada', lectura: 'Hay dispersion.'},
  },
  espejo_liderazgo: {
    indice_alineacion: 88,
    lectura: 'Lideres y empleados describen la misma cultura.',
    por_valor: [{valor: 'Innovacion y riesgo', lideres: 0.3, empleados: 0.1, brecha: 0.2, estado: 'moderada'}],
    puntos_ciegos: [{descripcion: 'Los lideres sobrestiman innovacion.'}],
  },
  dicho_vs_hecho: {
    coherencia_lideres: 60,
    coherencia_empleados: 62,
    lectura: 'Flexible se vive; exigente es de pared.',
    por_valor_declarado: [
      {valor_declarado: 'Flexible', valor_taleX: 'Innovacion y riesgo', lideres: 1, empleados: 0.9, veredicto: 'se_vive'},
    ],
  },
  propuesta_de_valor_real: {
    lo_que_si_se_ofrece: ['Autonomia'],
    lo_que_no_se_ofrece: ['Formacion'],
    promesas_no_confirmadas: [{necesidad: 'Reconocimiento', riesgo: 'Los lideres lo prometen.'}],
  },
  voz_de_los_empleados: {
    le_va_bien_al_que: [{tema: 'trata bien a todos', frecuencia_pct: 20}],
    le_va_mal_al_que: [{tema: 'solo mira el numero', frecuencia_pct: 15}],
  },
  implicaciones_para_contratar: {
    candidato_que_prospera: 'Quien se mueve bien con respeto.',
    candidato_en_riesgo: 'Quien necesita resultados como unica brujula.',
    mensaje_honesto_para_candidatos: 'Aqui se vive respeto e innovacion.',
    preguntas_de_entrevista: [{pregunta: 'Cuenteme de una vez en la que el trato choco con una meta.'}],
  },
  recomendaciones: [{prioridad: 1, accion: 'Use el perfil de empleados.'}],
  sello_taleX: {
    estado: 'no_validada',
    texto_del_sello: 'TaleX no valida aun esta cultura.',
    condiciones_pendientes: ['Falta muestra de empleados.'],
  },
  limitaciones: ['Hay menos de 5 lideres.'],
};

const pdf = await renderCultureReportPdf({
  organizationName: 'EMpresa de Prueba',
  informe,
  coverage: {respondents: 20},
});

import {PDFDocument} from 'pdf-lib';
if (pdf.slice(0, 4).toString() !== '%PDF') {
  throw new Error('PDF header missing');
}
const loaded = await PDFDocument.load(pdf);
if (loaded.getPageCount() < 3) {
  throw new Error(`too few pages: ${loaded.getPageCount()}`);
}
console.log(`ok pdf ${pdf.length} bytes pages=${loaded.getPageCount()}`);
