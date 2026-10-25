function normalizeRange(value) {
  return String(value || '')
    .trim()
    .replace(/\s*[-–—]\s*/g, ' – ')
    .replace(/\s+/g, ' ');
}

const RULES = {
  '1 – 50': {
    range: '1 – 50',
    estimate: 35,
    minimum: 20,
    needed: 20,
    title: 'Para una empresa de 1 a 50 personas',
    neededText:
      'Si son hasta 20 personas, debe responder todo el equipo. Si se acercan a 50, necesitamos al menos 45 respuestas (90 % – 100 %).',
    tip: 'Invita a todos.',
  },
  '51 – 200': {
    range: '51 – 200',
    estimate: 125,
    minimum: 46,
    needed: 88,
    title: 'Para una empresa de 51 a 200 personas',
    neededText:
      'Necesitamos entre 46 y 132 respuestas, según el tamaño exacto de tu equipo (90 % – 66 %).',
    tip: 'Apunta al menos al 70 %.',
  },
  '201 – 1.000': {
    range: '201 – 1.000',
    estimate: 500,
    minimum: 133,
    needed: 200,
    title: 'Para una empresa de 201 a 1.000 personas',
    neededText:
      'Necesitamos entre 133 y 278 respuestas, según el tamaño exacto de tu equipo (66 % – 28 %).',
    tip: 'Apunta al menos al 40 %.',
  },
  '1.001 – 5.000': {
    range: '1.001 – 5.000',
    estimate: 3000,
    minimum: 278,
    needed: 360,
    title: 'Para una empresa de 1.001 a 5.000 personas',
    neededText:
      'Necesitamos entre 278 y 357 respuestas, según el tamaño exacto de tu equipo (28 % – 7 %).',
    tip: 'Apunta al menos a 360 respuestas.',
  },
  'Más de 5.000': {
    range: 'Más de 5.000',
    estimate: 8000,
    minimum: 357,
    needed: 385,
    title: 'Para una empresa de más de 5.000 personas',
    neededText:
      'Necesitamos entre 357 y 384 respuestas (7 % o menos de tu equipo).',
    tip: 'Apunta al menos a 385 respuestas.',
  },
};

const ALIASES = {
  '1 – 10': {
    range: '1 – 10',
    estimate: 8,
    minimum: 8,
    needed: 8,
    title: 'Para una empresa de 1 a 10 personas',
    neededText: 'Debe responder todo el equipo (90 % – 100 %).',
    tip: 'Invita a todos.',
  },
  '11 – 50': '1 – 50',
  '201 – 500': '201 – 1.000',
  'Más de 500': '1.001 – 5.000',
};

const FALLBACK = {
  range: '1 – 50',
  estimate: 35,
  minimum: 20,
  needed: 20,
  title: 'Para tu empresa',
  neededText:
    'Necesitamos alcanzar el porcentaje mínimo de participación de tu equipo para elaborar el informe.',
  tip: 'Invita a la mayor parte de las personas que viven el día a día.',
};

export function participationFor(employeeRange) {
  const key = normalizeRange(employeeRange);
  const mapped = ALIASES[key];
  if (mapped && typeof mapped === 'object') return mapped;
  return RULES[mapped] || RULES[key] || FALLBACK;
}
