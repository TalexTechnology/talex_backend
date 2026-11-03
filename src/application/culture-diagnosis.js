import {CULTURE_VALUES, round2, roundInt} from '../domain/culture-model.js';

function words(text, max) {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, max).join(' ');
}

function topValues(ranked, n = 2) {
  return ranked.slice(0, n).map((item) => item.valor);
}

function weakValues(ranked, n = 2) {
  return ranked.slice(-n).reverse().map((item) => item.valor);
}

function archetype(dominants) {
  const [first, second] = dominants;
  if (!first) return 'Cultura aún no caracterizada';
  const names = {
    'Innovación y riesgo': 'innovadora',
    Estabilidad: 'estable',
    'Respeto por las personas': 'cercana',
    'Orientación a resultados': 'ejecutora',
    'Atención al detalle': 'precisa',
    'Trabajo en equipo': 'colaborativa',
    Competitividad: 'competitiva',
  };
  const a = names[first] || first.toLowerCase();
  const b = names[second] || '';
  if (!b) return `Cultura ${a}`;
  return `Cultura ${a} y ${b}`;
}

function blindSpots(perValue, leadersN) {
  if (leadersN < 1) {
    return [{
      descripcion: 'No hay respuestas de liderazgo para contrastar con lo que viven los empleados.',
      evidencia: 'K02 no clasificó líderes (jefe o directivo) con perfil C01–C08.',
      impacto_en_contratacion: 'El perfil de referencia es solo el de empleados; no se puede advertir un relato oficial distinto.',
    }];
  }
  return perValue
    .filter((item) => item.estado === 'critica' || item.estado === 'moderada')
    .sort((a, b) => Math.abs(b.brecha || 0) - Math.abs(a.brecha || 0))
    .slice(0, 3)
    .map((item) => ({
      descripcion: `Los líderes ${item.brecha > 0 ? 'sobrestiman' : 'subestiman'} ${item.valor} frente a los empleados.`,
      evidencia: `${item.valor}: líderes ${item.lideres}, empleados ${item.empleados}, brecha ${item.brecha} (${item.estado}). ${item.evidencia}`,
      impacto_en_contratacion: item.brecha > 0
        ? 'Si se vende ese valor al candidato, el choque aparece en el día a día.'
        : 'Ese valor se vive más de lo que el liderazgo cree; no filtrar candidatos que lo traigan.',
    }));
}

function sealText(estado, nombre) {
  if (estado === 'validada') {
    return `TaleX valida la cultura de ${nombre} como referencia para evaluar candidatos durante 12 meses.`;
  }
  if (estado === 'validada_con_reservas') {
    return `TaleX reconoce la cultura de ${nombre} con reservas: puede usarse como referencia, con las condiciones pendientes a la vista.`;
  }
  return `TaleX no valida aún la cultura de ${nombre} como sello de referencia para contratar.`;
}

function pendingText(decision) {
  const map = {
    muestra_empleados_insuficiente: 'Falta alcanzar la muestra de empleados que exige el tamaño de la empresa.',
    alineacion_insuficiente: 'Falta alinear la lectura de líderes y empleados (índice < 70).',
    fuerza_cultural_insuficiente: 'Falta consenso entre empleados (fuerza cultural < 60).',
  };
  return decision.pending.map((item) => map[item] || item);
}

export function buildCultureInforme(metrics) {
  const {
    empresa,
    leaders,
    employees,
    required,
    alignment,
    force,
    forceNivel,
    decision,
    perValue,
    rankedEmployees,
    coherenceLeaders,
    coherenceEmployees,
    declaredRows,
    offerEmployees,
    promises,
    sincerity,
    representativeness,
    subcultures,
    voiceBien,
    voiceMal,
    coveragePct,
  } = metrics;
  const nombre = empresa.nombre || 'la empresa';
  const dominants = topValues(rankedEmployees);
  const weaks = weakValues(rankedEmployees);
  const offered = offerEmployees.filter((item) => item.puntaje > 0).slice(0, 4).map((item) => item.necesidad);
  const missing = offerEmployees.filter((item) => item.puntaje < 0).slice(0, 4).map((item) => item.necesidad);
  const critica = perValue
    .filter((item) => item.brecha != null)
    .sort((a, b) => Math.abs(b.brecha) - Math.abs(a.brecha))[0];
  const verdad = critica
    ? `En ${critica.valor} la brecha líderes–empleados es ${critica.brecha} (${critica.estado}): los empleados puntúan ${critica.empleados} y los líderes ${critica.lideres}.`
    : 'Aún no hay suficientes líderes y empleados para señalar una diferencia de percepción.';
  const titular = words(
    rankedEmployees[0]
      ? `Aquí se vive ${dominants[0].toLowerCase()}${dominants[1] ? `, no tanto ${weaks[0]?.toLowerCase()}` : ''}`
      : 'Aún no hay suficientes respuestas de empleados para describir la cultura real',
    20,
  );
  const limitaciones = [];
  if (empresa.total_empleados == null) limitaciones.push('No hay N (total de empleados); la muestra requerida quedó en null.');
  if (!representativeness.length) limitaciones.push('No hay plantilla por área; la representatividad no se calculó.');
  if (leaders.length < 5) limitaciones.push('Hay menos de 5 líderes; el espejo de liderazgo se interpreta con reserva.');
  if (employees.length < 5) limitaciones.push('Hay menos de 5 empleados; no se reportan subgrupos y el consenso es frágil.');
  if (!declaredRows.length) limitaciones.push('D01 no pudo mapearse a rasgos de la landing (faltan ítems en la respuesta o el lead).');
  if (alignment == null) limitaciones.push('No se calculó alineación: falta perfil de líderes o de empleados.');
  if (force == null) limitaciones.push('No se calculó fuerza cultural: se necesitan al menos 2 perfiles de empleados.');

  const alertas = [];
  if (employees.length < (required || 0)) alertas.push(`Empleados ${employees.length} de ${required} requeridos.`);
  if (leaders.length === 0) alertas.push('Ningún respondente se clasificó como jefe o directivo.');
  for (const area of representativeness) {
    if (area.estado !== 'adecuada') alertas.push(`${area.area} está ${area.estado}.`);
  }

  const confianza = decision.estado === 'validada' ? 'alto' : decision.estado === 'validada_con_reservas' ? 'medio' : 'bajo';
  const spots = blindSpots(perValue, leaders.length);
  const risks = [];
  if (critica?.estado === 'critica') {
    risks.push({
      riesgo: `Contratar desde el relato de liderazgo en ${critica.valor}`,
      probabilidad: 'alta',
      evidencia: verdad,
      mitigacion: 'Use el perfil de empleados como filtro y contrasté el valor en entrevista.',
    });
  }
  if (promises[0]) {
    risks.push({
      riesgo: `Prometer ${promises[0].necesidad} en el proceso`,
      probabilidad: 'alta',
      evidencia: `Brecha de promesa ${promises[0].brecha} en ${promises[0].necesidad}.`,
      mitigacion: 'Describa la oferta real de los empleados, no la de los líderes.',
    });
  }
  if (force != null && force < 60) {
    risks.push({
      riesgo: 'La cultura está fragmentada: el “fit” depende del área',
      probabilidad: 'media',
      evidencia: `Fuerza cultural ${force} (${forceNivel}).`,
      mitigacion: 'Si hay subculturas con n≥5, compare también contra el perfil del área.',
    });
  }
  if (decision.estado === 'no_validada') {
    risks.push({
      riesgo: 'Usar este informe como sello de referencia',
      probabilidad: 'alta',
      evidencia: pendingText(decision).join(' '),
      mitigacion: 'Siga recolectando respuestas de empleados y líderes antes de sellar.',
    });
  }
  const interviewValues = [...dominants, ...weaks].filter(Boolean).slice(0, 5);
  while (interviewValues.length < 5) {
    const extra = CULTURE_VALUES.find((value) => !interviewValues.includes(value));
    if (!extra) break;
    interviewValues.push(extra);
  }
  const preguntas = interviewValues.slice(0, 5).map((valor) => ({
    pregunta: `Cuénteme de una vez en la que ${valor.toLowerCase()} chocó con otra prioridad. ¿Qué hizo?`,
    que_revela: `Si la persona se siente cómoda operando donde ${valor} es ${dominants.includes(valor) ? 'central' : 'secundario'}.`,
    valor,
  }));
  const prospers = rankedEmployees[0]
    ? `Quien se mueve bien con ${dominants.join(' y ').toLowerCase()}, y no espera que ${weaks[0] || 'otros valores'} manden el día a día.`
    : 'Aún no hay perfil de empleados para describir quién prospera.';
  const atRisk = weaks[0]
    ? `Quien necesita ${weaks[0].toLowerCase()} como condición para rendir, o a quien le vendan una cultura de ${critica?.valor?.toLowerCase() || dominants[0]?.toLowerCase()} que aquí no se vive así.`
    : 'Aún no hay datos para señalar un perfil en riesgo.';
  const honest = offered.length
    ? `Aquí se vive ${dominants.join(' y ').toLowerCase()}. Lo que sí aparece en la oferta cotidiana es ${offered.join(', ').toLowerCase()}${missing.length ? `; no espere ${missing.join(', ').toLowerCase()}` : ''}.`
    : 'Todavía no hay suficientes empleados para describir con honestidad qué se ofrece de verdad.';

  return {
    version_informe: 'TaleX-Cultura-1.0',
    empresa: {
      nombre,
      fecha_corte: empresa.fecha_corte,
      total_empleados: empresa.total_empleados,
    },
    resumen_ejecutivo: {
      titular,
      veredicto_validacion: decision.estado,
      lo_que_debe_saber: [
        `Cultura real (empleados n=${employees.length}): ${dominants.join(' y ') || 'sin perfil'} como valores dominantes.`,
        `Alineación líderes–empleados: ${alignment ?? 'null'}. Fuerza cultural: ${force ?? 'null'} (${forceNivel || 'sin dato'}).`,
        `Sello: ${decision.estado}. Muestra empleados ${employees.length} / requerida ${required ?? 'null'}.`,
      ],
      verdad_incomoda: verdad,
    },
    calidad_de_datos: {
      respuestas_lideres: leaders.length,
      respuestas_empleados: employees.length,
      muestra_requerida: required,
      cobertura_muestra_pct: coveragePct,
      representatividad_por_area: representativeness,
      alertas,
      nivel_confianza: confianza,
    },
    adn_cultural: {
      arquetipo: archetype(dominants),
      descripcion: rankedEmployees[0]
        ? `Los empleados describen un lugar donde prima ${dominants.join(' y ').toLowerCase()}. ${weaks[0] ? `${weaks[0]} queda en segundo plano.` : ''} El liderazgo se contrasta contra esa lectura, no al revés.`
        : 'No hay aún un perfil de empleados para describir cómo se trabaja aquí.',
      valores_dominantes: dominants.length === 2 ? dominants : [dominants[0] || CULTURE_VALUES[0], dominants[1] || CULTURE_VALUES[1]],
      valores_debiles: weaks.length === 2 ? weaks : [weaks[0] || CULTURE_VALUES[6], weaks[1] || CULTURE_VALUES[5]],
      fuerza_cultural: {
        indice: force,
        nivel: forceNivel || 'fragmentada',
        lectura: force == null
          ? 'No se puede leer el consenso con menos de dos empleados.'
          : forceNivel === 'fuerte'
            ? 'Los empleados coinciden en cómo se trabaja.'
            : forceNivel === 'moderada'
              ? 'Hay un centro cultural, con variación relevante entre personas.'
              : 'Las lecturas de los empleados están dispersas; la cultura está fragmentada.',
      },
    },
    espejo_liderazgo: {
      indice_alineacion: alignment,
      lectura: alignment == null
        ? 'No hay espejo: falta un perfil de líderes o de empleados.'
        : alignment >= 70
          ? 'Líderes y empleados describen la misma cultura en lo esencial.'
          : alignment >= 50
            ? 'Hay un relato compartido, pero con distorsiones que importan al contratar.'
            : 'Los líderes describen una cultura que los empleados no reconocen.',
      por_valor: perValue.map((item) => ({
        ...item,
        lideres: item.lideres ?? 0,
        empleados: item.empleados ?? 0,
        brecha: item.brecha ?? 0,
      })),
      puntos_ciegos: spots.slice(0, 3),
    },
    dicho_vs_hecho: {
      coherencia_lideres: roundInt((coherenceLeaders ?? 0) * 100),
      coherencia_empleados: roundInt((coherenceEmployees ?? 0) * 100),
      por_valor_declarado: declaredRows,
      lectura: declaredRows.length
        ? `Los empleados sitúan los rasgos declarados en ${declaredRows.filter((item) => item.veredicto === 'se_vive').length} como “se vive” y ${declaredRows.filter((item) => item.veredicto === 'solo_en_la_pared').length} como “solo en la pared”.`
        : 'No hay calificaciones D01 mapeables a los rasgos de la landing.',
    },
    propuesta_de_valor_real: {
      lo_que_si_se_ofrece: offered,
      lo_que_no_se_ofrece: missing,
      promesas_no_confirmadas: promises,
    },
    lectura_de_sinceridad: {
      sobreestimacion_de_consenso: sincerity.sobreestimacion_de_consenso,
      normas_silenciosas: sincerity.normas_silenciosas,
      lectura: sincerity.sobreestimacion_de_consenso
        ? 'Los líderes creen que hay más consenso del que muestran C02, C03 y C05.'
        : sincerity.normas_silenciosas.length
          ? 'Hay normas que el grupo practica más de lo que cree compartir.'
          : 'Los pronósticos no muestran una sobreestimación clara de consenso.',
    },
    subculturas: subcultures,
    voz_de_los_empleados: {
      le_va_bien_al_que: employees.length < 5 ? [] : voiceBien,
      le_va_mal_al_que: employees.length < 5 ? [] : voiceMal,
    },
    implicaciones_para_contratar: {
      perfil_de_referencia: {
        fuente: 'empleados',
        valores: CULTURE_VALUES.map((valor) => ({
          valor,
          puntaje: perValue.find((item) => item.valor === valor)?.empleados ?? 0,
        })),
        oferta: offerEmployees,
      },
      candidato_que_prospera: prospers,
      candidato_en_riesgo: atRisk,
      riesgos_de_contratacion: risks.slice(0, 4),
      preguntas_de_entrevista: preguntas,
      mensaje_honesto_para_candidatos: honest,
    },
    recomendaciones: [
      {
        prioridad: 1,
        accion: decision.estado === 'validada'
          ? 'Use el perfil de empleados como filtro de candidatos durante 12 meses.'
          : pendingText(decision)[0] || 'Complete N, plantilla y más respuestas de empleados antes de sellar.',
        responsable_sugerido: 'Dirección de talento',
        plazo: '30_dias',
        indicador_de_exito: decision.estado === 'validada'
          ? 'Vacantes nuevas usan el perfil de empleados en el brief.'
          : `Empleados ≥ ${required ?? 'muestra requerida'} y sello distinto de no_validada.`,
      },
      {
        prioridad: 2,
        accion: spots[0]
          ? `Trabaje el punto ciego: ${spots[0].descripcion}`
          : 'Sume respuestas de jefes y directivos para poder contrastar.',
        responsable_sugerido: 'Comité de liderazgo',
        plazo: '90_dias',
        indicador_de_exito: 'Brechas críticas C01–C08 por debajo de 0,30.',
      },
      {
        prioridad: 3,
        accion: promises[0]
          ? `Deje de vender ${promises[0].necesidad} si los empleados no la confirman.`
          : 'Alinee el mensaje de atracción con la oferta que sí marcan los empleados en O01.',
        responsable_sugerido: 'Talento / marca empleadora',
        plazo: '90_dias',
        indicador_de_exito: 'El anuncio de vacante cita solo necesidades con puntaje de empleados > 0.',
      },
    ],
    sello_taleX: {
      estado: decision.estado,
      condiciones_cumplidas: decision.conditions,
      condiciones_pendientes: pendingText(decision),
      vigencia_meses: 12,
      texto_del_sello: sealText(decision.estado, nombre),
    },
    limitaciones,
  };
}

export function informeSections(informe) {
  return [
    {code: 'cultura', title: 'Cultura vivida', summary: informe.adn_cultural.descripcion},
    {code: 'liderazgo', title: 'Espejo de liderazgo', summary: informe.espejo_liderazgo.lectura},
    {code: 'trabajo', title: 'Dicho contra hecho', summary: informe.dicho_vs_hecho.lectura},
    {code: 'personas', title: 'Oferta real', summary: informe.implicaciones_para_contratar.mensaje_honesto_para_candidatos},
    {code: 'apertura', title: 'Implicaciones para contratar', summary: informe.implicaciones_para_contratar.candidato_que_prospera},
  ];
}

export {round2, roundInt};
