import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument, rgb} from 'pdf-lib';

const PAGE = {width: 595.28, height: 841.89};
const MARGIN = 40;
const NAVY = hex('#0B1528');
const WHITE = hex('#FFFFFF');
const INK = hex('#0B1528');
const MUTED = hex('#5B6B7C');
const LINE = hex('#E6EBF1');
const TRACK = hex('#EEF2F6');
const CARD = hex('#F7F9FC');
const BLUE = hex('#3573DE');
const COMPANY = hex('#4F8BF0');
const SLATE = hex('#7E94B3');
const LIME = hex('#A4E765');
const GOOD = hex('#2F7D32');
const WARN = hex('#C4841A');
const WARN_BG = hex('#FFF6E4');
const GOOD_BG = hex('#F3FBE8');
const BLUE_BG = hex('#EEF4FF');

function hex(value) {
  const n = Number.parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function textOf(value) {
  return String(value ?? '')
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrap(text, font, size, maxWidth) {
  const words = textOf(text).split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function num(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(value).toLocaleString('es-CO', {maximumFractionDigits: digits});
}

function livePct(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(0.96, Math.max(0.04, (n + 0.45) / 0.9));
}

function liveLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'Sin dato';
  if (n >= 0.2) return 'Se vive mucho';
  if (n >= 0.08) return 'Se vive';
  if (n > -0.08) return 'Ni mucho ni poco';
  return 'Se vive poco';
}

function verdictLabel(value) {
  const key = String(value || '').toLowerCase();
  if (key.includes('vive') && !key.includes('pared') && !key.includes('papel')) return 'Se vive';
  if (key.includes('media')) return 'A medias';
  if (key.includes('pared') || key.includes('papel')) return 'Solo en el papel';
  return textOf(value).replaceAll('_', ' ') || 'Sin dato';
}

function asset(...parts) {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', ...parts);
}

function readAsset(...parts) {
  try {
    return readFileSync(asset(...parts));
  } catch {
    return null;
  }
}

function box(page, {x, y, w, h, color, borderColor, borderWidth = 1}) {
  if (color) page.drawRectangle({x, y, width: w, height: h, color});
  if (borderColor) {
    page.drawRectangle({x, y, width: w, height: h, borderColor, borderWidth});
  }
}

class Report {
  constructor(doc, fonts, logo) {
    this.doc = doc;
    this.fonts = fonts;
    this.logo = logo;
    this.pages = [];
    this.page = null;
    this.y = 0;
    this.width = PAGE.width - MARGIN * 2;
  }

  addPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.page.drawRectangle({x: 0, y: 0, width: PAGE.width, height: PAGE.height, color: WHITE});
    const headerH = 68;
    const headerY = PAGE.height - headerH;
    this.page.drawRectangle({x: 0, y: headerY, width: PAGE.width, height: headerH, color: NAVY});
    this.page.drawRectangle({x: 0, y: headerY - 3, width: PAGE.width, height: 3, color: LIME});
    if (this.logo) {
      const height = 42;
      const width = this.logo.width * (height / this.logo.height);
      const logoY = headerY + (headerH - height) / 2;
      this.page.drawImage(this.logo, {x: MARGIN, y: logoY, width, height});
      this.text(this.fonts.semi, 'Informe cultural', 10, MARGIN + width + 14, logoY + height / 2 - 4, WHITE);
    } else {
      this.text(this.fonts.bold, 'TaleX', 13, MARGIN, headerY + headerH / 2 - 5, WHITE);
      this.text(this.fonts.semi, 'Informe cultural', 10, MARGIN + 52, headerY + headerH / 2 - 4, WHITE);
    }
    this.y = headerY - 22;
  }

  ensure(height) {
    if (!this.page || this.y - height < 52) this.addPage();
  }

  text(font, value, size, x, y, color = INK) {
    this.page.drawText(textOf(value), {x, y, size, font, color});
  }

  lines(font, value, size, lineHeight, color = INK, width = this.width) {
    const rows = wrap(value, font, size, width);
    this.ensure(rows.length * lineHeight + 4);
    for (const row of rows) {
      this.text(font, row, size, MARGIN, this.y - size, color);
      this.y -= lineHeight;
    }
    return rows.length;
  }

  gap(n = 10) {
    this.y -= n;
  }

  eyebrow(label) {
    this.ensure(18);
    this.text(this.fonts.bold, String(label || '').toUpperCase(), 8, MARGIN, this.y - 8, hex('#3D7A1F'));
    this.y -= 16;
  }

  title(label, size = 20) {
    this.ensure(size + 18);
    this.page.drawRectangle({x: MARGIN, y: this.y - 4, width: 18, height: 4, color: LIME});
    this.y -= 10;
    this.lines(this.fonts.bold, label, size, size + 5, INK);
    this.gap(6);
  }

  body(value) {
    if (!textOf(value)) return;
    this.lines(this.fonts.regular, value, 10.5, 15, MUTED);
    this.gap(8);
  }

  chipWidth(label) {
    return this.fonts.semi.widthOfTextAtSize(textOf(label), 8) + 16;
  }

  chip(label, x, y, tone = 'neutral') {
    const tones = {
      neutral: {bg: TRACK, ink: MUTED},
      good: {bg: GOOD_BG, ink: GOOD},
      warn: {bg: WARN_BG, ink: WARN},
      blue: {bg: BLUE_BG, ink: BLUE},
    };
    const palette = tones[tone] || tones.neutral;
    const width = this.chipWidth(label);
    box(this.page, {x, y, w: width, h: 16, color: palette.bg});
    this.text(this.fonts.semi, label, 8, x + 8, y + 5, palette.ink);
    return width;
  }

  chipRight(label, y, tone = 'neutral') {
    return this.chip(label, PAGE.width - MARGIN - this.chipWidth(label), y, tone);
  }

  chipRow(items, tone = 'neutral') {
    const max = PAGE.width - MARGIN;
    let x = MARGIN;
    this.ensure(22);
    this.y -= 4;
    for (const item of items || []) {
      const width = this.chipWidth(item);
      if (x + width > max) {
        this.y -= 22;
        this.ensure(22);
        x = MARGIN;
      }
      this.chip(item, x, this.y - 16, tone);
      x += width + 8;
    }
    this.y -= 26;
  }

  card(height, draw) {
    this.ensure(height + 8);
    box(this.page, {
      x: MARGIN,
      y: this.y - height,
      w: this.width,
      h: height,
      color: CARD,
      borderColor: LINE,
      borderWidth: 1,
    });
    const top = this.y;
    draw(top);
    this.y -= height + 12;
  }

  progress(label, percent, note) {
    const value = Math.min(100, Math.max(0, Number(percent) || 0));
    const height = 46;
    this.ensure(height + 8);
    this.text(this.fonts.regular, label, 10, MARGIN, this.y - 10, MUTED);
    const mark = `${Math.round(value)}%`;
    this.text(
      this.fonts.bold,
      mark,
      10,
      PAGE.width - MARGIN - this.fonts.bold.widthOfTextAtSize(mark, 10),
      this.y - 10,
      INK,
    );
    const trackY = this.y - 28;
    this.page.drawRectangle({x: MARGIN, y: trackY, width: this.width, height: 10, color: TRACK});
    if (value > 0) {
      this.page.drawRectangle({
        x: MARGIN,
        y: trackY,
        width: Math.max(12, (this.width * value) / 100),
        height: 10,
        color: value >= 75 ? hex('#64A82F') : BLUE,
      });
    }
    this.y -= 36;
    if (note) {
      this.lines(this.fonts.regular, note, 9, 13, MUTED);
      this.gap(6);
    }
  }

  finish(company) {
    this.pages.forEach((page, index) => {
      page.drawRectangle({x: 0, y: 0, width: PAGE.width, height: 34, color: NAVY});
      page.drawText(textOf(company).slice(0, 42) || 'TaleX', {
        x: MARGIN,
        y: 13,
        size: 8,
        font: this.fonts.regular,
        color: hex('#C5D0DC'),
      });
      const mark = `${index + 1} / ${this.pages.length}`;
      page.drawText(mark, {
        x: PAGE.width - MARGIN - this.fonts.regular.widthOfTextAtSize(mark, 8),
        y: 13,
        size: 8,
        font: this.fonts.regular,
        color: hex('#C5D0DC'),
      });
    });
  }
}

function highlightItems(informe) {
  const resumen = informe?.resumen_ejecutivo || {};
  const adn = informe?.adn_cultural || {};
  const espejo = informe?.espejo_liderazgo || {};
  const calidad = informe?.calidad_de_datos || {};
  const items = [];
  if (adn.valores_dominantes?.length) {
    items.push(`Lo que más se vive: ${adn.valores_dominantes.join(' y ')}.`);
  }
  if (espejo.indice_alineacion != null) {
    items.push(`Líderes y equipo coinciden en un ${Math.round(espejo.indice_alineacion)}%.`);
  }
  if (adn.fuerza_cultural?.lectura) items.push(adn.fuerza_cultural.lectura);
  if (calidad.respuestas_empleados != null && calidad.muestra_requerida != null) {
    items.push(`Para una lectura más firme faltan respuestas: van ${calidad.respuestas_empleados} de ${calidad.muestra_requerida} del equipo.`);
  }
  return items.length ? items : resumen.lo_que_debe_saber || [];
}

export async function renderCultureReportPdf({organizationName, informe, coverage}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Informe cultural · ${organizationName || 'TaleX'}`);
  doc.setAuthor('TaleX');
  doc.setCreator('TaleX');
  const fonts = {
    regular: await doc.embedFont(readAsset('fonts', 'Inter-Regular.ttf')),
    semi: await doc.embedFont(readAsset('fonts', 'Inter-SemiBold.ttf')),
    bold: await doc.embedFont(readAsset('fonts', 'Inter-Bold.ttf')),
  };
  const logoBytes = readAsset('talex_logo_horizontal_fondo_oscuro.png');
  const logo = logoBytes ? await doc.embedPng(logoBytes) : null;
  const layout = new Report(doc, fonts, logo);
  const resumen = informe?.resumen_ejecutivo || {};
  const calidad = informe?.calidad_de_datos || {};
  const adn = informe?.adn_cultural || {};
  const espejo = informe?.espejo_liderazgo || {};
  const dicho = informe?.dicho_vs_hecho || {};
  const oferta = informe?.propuesta_de_valor_real || {};
  const voz = informe?.voz_de_los_empleados || {};
  const contratar = informe?.implicaciones_para_contratar || {};
  const highlights = highlightItems(informe);
  const employees = calidad.respuestas_empleados ?? 0;
  const leaders = calidad.respuestas_lideres ?? 0;
  const needed = calidad.muestra_requerida ?? coverage?.needed ?? 0;
  const respondents = coverage?.respondents ?? employees + leaders;
  const samplePct = needed ? Math.round((employees / needed) * 100) : coverage?.percent ?? 0;

  layout.addPage();
  layout.eyebrow('Informe de cultura');
  layout.title(organizationName || 'Empresa', 28);
  layout.body('Así describe tu equipo la cultura que vive hoy. Úsalo para conversar y decidir mejor: el fit informa, la persona decide.');

  const innerW = layout.width - 36;
  const titleLines = wrap(resumen.titular || 'Así se vive la cultura hoy', fonts.bold, 15, innerW);
  const bulletBlocks = highlights.slice(0, 4).map((item) => wrap(`•  ${item}`, fonts.regular, 10, innerW));
  const note = resumen.verdad_incomoda;
  const noteLines = note ? wrap(note, fonts.regular, 9, innerW - 16) : [];
  const noteH = noteLines.length ? 28 + noteLines.length * 13 : 0;
  const highlightHeight =
    52 + titleLines.length * 19 + 22 + bulletBlocks.reduce((sum, rows) => sum + rows.length * 15, 0) + (noteH ? noteH + 16 : 12);
  layout.card(highlightHeight, (top) => {
    layout.page.drawRectangle({x: MARGIN, y: top - highlightHeight, width: 4, height: highlightHeight, color: LIME});
    layout.chip('Lectura preliminar', MARGIN + 16, top - 28, 'neutral');
    let cursor = top - 50;
    for (const row of titleLines) {
      layout.text(fonts.bold, row, 15, MARGIN + 16, cursor, INK);
      cursor -= 19;
    }
    cursor -= 6;
    layout.text(fonts.bold, 'LO MÁS IMPORTANTE', 8, MARGIN + 16, cursor, MUTED);
    cursor -= 16;
    for (const rows of bulletBlocks) {
      for (const row of rows) {
        layout.text(fonts.regular, row, 10, MARGIN + 16, cursor, INK);
        cursor -= 15;
      }
    }
    if (noteLines.length) {
      cursor -= 6;
      box(layout.page, {
        x: MARGIN + 12,
        y: cursor - noteH + 8,
        w: layout.width - 24,
        h: noteH,
        color: WHITE,
        borderColor: LINE,
      });
      layout.text(fonts.semi, 'Un punto para conversar', 9, MARGIN + 22, cursor, INK);
      cursor -= 16;
      for (const row of noteLines) {
        layout.text(fonts.regular, row, 9, MARGIN + 22, cursor, MUTED);
        cursor -= 13;
      }
    }
  });

  const kpiW = (layout.width - 16) / 3;
  layout.ensure(78);
  [
    {value: `${Math.min(100, samplePct)}%`, label: `${respondents} de ${needed || respondents} respuestas`},
    {value: String(leaders), label: 'Líderes'},
    {value: String(employees), label: 'Empleados'},
  ].forEach((item, index) => {
    const x = MARGIN + index * (kpiW + 8);
    box(layout.page, {x, y: layout.y - 70, w: kpiW, h: 70, color: CARD, borderColor: LINE, borderWidth: 1});
    layout.text(fonts.bold, item.value, 22, x + 16, layout.y - 36, INK);
    layout.text(fonts.regular, item.label, 9, x + 16, layout.y - 54, MUTED);
  });
  layout.y -= 84;

  layout.title('En pocas palabras', 18);
  const summaries = [
    ['Cultura vivida', adn.descripcion],
    ['Espejo de liderazgo', espejo.lectura],
    ['Dicho contra hecho', dicho.lectura],
    ['Oferta real', contratar.mensaje_honesto_para_candidatos],
    ['Qué significa para contratar', contratar.candidato_que_prospera],
  ];
  for (const [title, text] of summaries) {
    if (!text) continue;
    const rows = wrap(text, fonts.regular, 10, layout.width - 36);
    const height = 32 + rows.length * 14;
    layout.ensure(height + 8);
    box(layout.page, {x: MARGIN, y: layout.y - height, w: layout.width, h: height, color: CARD, borderColor: LINE});
    layout.page.drawRectangle({x: MARGIN, y: layout.y - height, width: 3, height, color: BLUE});
    layout.text(fonts.semi, title, 11, MARGIN + 14, layout.y - 16, INK);
    let cursor = layout.y - 32;
    for (const row of rows) {
      layout.text(fonts.regular, row, 10, MARGIN + 14, cursor, MUTED);
      cursor -= 14;
    }
    layout.y -= height + 8;
  }

  layout.title('Sobre estas respuestas', 18);
  layout.progress(
    `Van ${employees} de ${needed || employees} respuestas del equipo.`,
    samplePct,
    (calidad.representatividad_por_area || [])
      .map((item) => `${item.area}: ${item.pct_plantilla}% de la plantilla · ${item.pct_respuestas}% de las respuestas`)
      .join('  ·  ') || 'Las respuestas se leen de forma agregada y anónima.',
  );

  layout.title('Así es la cultura hoy', 18);
  layout.text(fonts.bold, adn.arquetipo || 'Cultura en construcción', 16, MARGIN, layout.y - 16, hex('#3D7A1F'));
  layout.y -= 24;
  layout.body(adn.descripcion);
  if (adn.valores_dominantes?.length) {
    layout.text(fonts.bold, 'LO QUE MÁS SE VIVE', 8, MARGIN, layout.y - 8, MUTED);
    layout.y -= 14;
    layout.chipRow(adn.valores_dominantes, 'good');
  }
  if (adn.valores_debiles?.length) {
    layout.text(fonts.bold, 'LO QUE MENOS SE VIVE', 8, MARGIN, layout.y - 8, MUTED);
    layout.y -= 14;
    layout.chipRow(adn.valores_debiles, 'neutral');
  }
  layout.progress(
    'Qué tan compartida es',
    adn.fuerza_cultural?.indice ?? 0,
    adn.fuerza_cultural?.lectura || 'Cada persona o equipo la puede vivir distinto.',
  );

  layout.title('¿Líderes y equipo ven lo mismo?', 18);
  layout.body('Comparamos cómo describen la cultura los líderes y el resto del equipo. Azul = líderes. Gris = empleados.');
  layout.progress('Qué tanto coinciden', espejo.indice_alineacion ?? 0, espejo.lectura);
  layout.text(fonts.regular, 'Líderes', 8, MARGIN + 14, layout.y - 8, COMPANY);
  layout.page.drawCircle({x: MARGIN + 6, y: layout.y - 5, size: 3, color: COMPANY});
  layout.text(fonts.regular, 'Empleados', 8, MARGIN + 78, layout.y - 8, SLATE);
  layout.page.drawCircle({x: MARGIN + 70, y: layout.y - 5, size: 3, color: SLATE});
  layout.y -= 18;

  for (const item of espejo.por_valor || []) {
    const aligned = item.estado === 'alineado';
    const badge = aligned ? 'Coinciden' : 'Lo ven distinto';
    const badgeW = layout.chipWidth(badge);
    const nameW = layout.width - badgeW - 16;
    const nameLines = wrap(item.valor, fonts.semi, 10, nameW);
    const height = 20 + nameLines.length * 14 + 28;
    layout.ensure(height + 6);
    let cursor = layout.y - 12;
    for (const row of nameLines) {
      layout.text(fonts.semi, row, 10, MARGIN, cursor, INK);
      cursor -= 14;
    }
    layout.chipRight(badge, layout.y - 16, aligned ? 'good' : 'blue');
    const barW = layout.width - 130;
    const trackY1 = cursor - 6;
    const trackY2 = cursor - 20;
    layout.page.drawRectangle({x: MARGIN, y: trackY1, width: barW, height: 9, color: TRACK});
    layout.page.drawRectangle({x: MARGIN, y: trackY2, width: barW, height: 9, color: TRACK});
    layout.page.drawRectangle({x: MARGIN, y: trackY1, width: Math.max(10, barW * livePct(item.lideres)), height: 9, color: COMPANY});
    layout.page.drawRectangle({x: MARGIN, y: trackY2, width: Math.max(10, barW * livePct(item.empleados)), height: 9, color: SLATE});
    layout.text(fonts.regular, liveLabel(item.lideres), 8, MARGIN + barW + 8, trackY1 + 1, MUTED);
    layout.text(fonts.regular, liveLabel(item.empleados), 8, MARGIN + barW + 8, trackY2 + 1, MUTED);
    layout.y -= height;
  }
  layout.gap(8);

  if (espejo.puntos_ciegos?.length) {
    layout.title('Dónde el liderazgo lo ve distinto', 18);
    for (const item of espejo.puntos_ciegos) {
      const rows = wrap(item.impacto_en_contratacion || item.evidencia || '', fonts.regular, 10, layout.width - 28);
      const height = 28 + rows.length * 14;
      layout.card(height, (top) => {
        layout.text(fonts.semi, item.descripcion, 11, MARGIN + 14, top - 18, INK);
        let cursor = top - 34;
        for (const row of rows) {
          layout.text(fonts.regular, row, 10, MARGIN + 14, cursor, MUTED);
          cursor -= 14;
        }
      });
    }
  }

  layout.title('Lo que se dice y lo que se vive', 18);
  layout.body('Revisamos si los valores que declara la empresa se sienten en el día a día.');
  const half = (layout.width - 12) / 2;
  layout.ensure(52);
  [
    ['Coincidencia · Líderes', dicho.coherencia_lideres],
    ['Coincidencia · Empleados', dicho.coherencia_empleados],
  ].forEach((item, index) => {
    const x = MARGIN + index * (half + 12);
    const pct = Math.min(100, Math.max(0, Number(item[1]) || 0));
    layout.text(fonts.regular, item[0], 9, x, layout.y - 10, MUTED);
    layout.text(fonts.bold, `${num(item[1]) ?? '—'}%`, 9, x + half - 36, layout.y - 10, INK);
    layout.page.drawRectangle({x, y: layout.y - 26, width: half, height: 8, color: TRACK});
    layout.page.drawRectangle({x, y: layout.y - 26, width: Math.max(8, (half * pct) / 100), height: 8, color: index ? SLATE : COMPANY});
  });
  layout.y -= 40;
  layout.body(dicho.lectura);
  for (const item of dicho.por_valor_declarado || []) {
    const label = verdictLabel(item.veredicto);
    const tone = label === 'Se vive' ? 'good' : label === 'A medias' ? 'blue' : 'warn';
    const badgeW = layout.chipWidth(label);
    const textW = layout.width - badgeW - 36;
    const sub = wrap(`Se relaciona con ${item.valor_taleX}.`, fonts.regular, 9, textW);
    const height = 36 + Math.max(0, sub.length - 1) * 12;
    layout.ensure(height + 8);
    box(layout.page, {x: MARGIN, y: layout.y - height, w: layout.width, h: height, color: CARD, borderColor: LINE});
    layout.text(fonts.semi, item.valor_declarado, 11, MARGIN + 14, layout.y - 16, INK);
    let cursor = layout.y - 30;
    for (const row of sub) {
      layout.text(fonts.regular, row, 9, MARGIN + 14, cursor, MUTED);
      cursor -= 12;
    }
    layout.chipRight(label, layout.y - 22, tone);
    layout.y -= height + 8;
  }

  layout.title('Lo que de verdad ofrece trabajar aquí', 18);
  layout.body('Según el equipo, más allá del sueldo.');
  if (oferta.lo_que_si_se_ofrece?.length) {
    layout.text(fonts.bold, 'LO QUE SÍ ENCUENTRAS', 8, MARGIN, layout.y - 8, MUTED);
    layout.y -= 14;
    layout.chipRow(oferta.lo_que_si_se_ofrece, 'good');
  }
  if (oferta.lo_que_no_se_ofrece?.length) {
    layout.text(fonts.bold, 'LO QUE AÚN NO ESTÁ', 8, MARGIN, layout.y - 8, MUTED);
    layout.y -= 14;
    layout.chipRow(oferta.lo_que_no_se_ofrece, 'neutral');
  }
  if (oferta.promesas_no_confirmadas?.length) {
    layout.text(fonts.bold, 'CUIDADO AL PROMETER', 8, MARGIN, layout.y - 8, MUTED);
    layout.y -= 16;
    for (const item of oferta.promesas_no_confirmadas) {
      layout.body(`${item.necesidad}: ${item.riesgo}`);
    }
  }

  layout.title('En palabras del equipo', 18);
  layout.body('Frases reales y anónimas de quienes respondieron.');
  const left = voz.le_va_bien_al_que || [];
  const right = voz.le_va_mal_al_que || [];
  const colW = (layout.width - 12) / 2;
  layout.ensure(20);
  layout.text(fonts.bold, 'AQUÍ LE VA BIEN A QUIEN...', 8, MARGIN, layout.y - 8, MUTED);
  layout.text(fonts.bold, 'AQUÍ LE CUESTA MÁS A QUIEN...', 8, MARGIN + colW + 12, layout.y - 8, MUTED);
  layout.y -= 16;
  const rows = Math.max(left.length, right.length, 1);
  for (let i = 0; i < rows; i += 1) {
    const a = left[i];
    const b = right[i];
    const aLines = a ? wrap(`"${a.tema}"`, fonts.semi, 10, colW - 20) : [];
    const bLines = b ? wrap(`"${b.tema}"`, fonts.semi, 10, colW - 20) : [];
    const height = 28 + Math.max(aLines.length, bLines.length, 1) * 13;
    layout.ensure(height + 6);
    if (a) {
      box(layout.page, {x: MARGIN, y: layout.y - height, w: colW, h: height, r: 10, color: CARD});
      layout.page.drawRectangle({x: MARGIN, y: layout.y - height, width: 3, height, color: hex('#64A82F')});
      let cursor = layout.y - 16;
      for (const row of aLines) {
        layout.text(fonts.semi, row, 10, MARGIN + 12, cursor, INK);
        cursor -= 13;
      }
      layout.text(fonts.regular, `${a.frecuencia_pct}% del equipo lo mencionó`, 8, MARGIN + 12, layout.y - height + 10, MUTED);
    }
    if (b) {
      box(layout.page, {x: MARGIN + colW + 12, y: layout.y - height, w: colW, h: height, r: 10, color: CARD});
      layout.page.drawRectangle({x: MARGIN + colW + 12, y: layout.y - height, width: 3, height, color: BLUE});
      let cursor = layout.y - 16;
      for (const row of bLines) {
        layout.text(fonts.semi, row, 10, MARGIN + colW + 24, cursor, INK);
        cursor -= 13;
      }
      layout.text(fonts.regular, `${b.frecuencia_pct}% del equipo lo mencionó`, 8, MARGIN + colW + 24, layout.y - height + 10, MUTED);
    }
    layout.y -= height + 8;
  }

  layout.title('Qué significa para contratar', 18);
  layout.body('Úsalo como guía para la entrevista, no como filtro automático.');
  if (contratar.candidato_que_prospera) {
    const fit = wrap(contratar.candidato_que_prospera, fonts.regular, 10, layout.width - 28);
    const height = 34 + fit.length * 14;
    layout.ensure(height + 8);
    box(layout.page, {x: MARGIN, y: layout.y - height, w: layout.width, h: height, color: GOOD_BG, borderColor: LINE});
    layout.text(fonts.semi, 'Quién encaja bien aquí', 10, MARGIN + 14, layout.y - 16, GOOD);
    let cursor = layout.y - 32;
    for (const row of fit) {
      layout.text(fonts.regular, row, 10, MARGIN + 14, cursor, INK);
      cursor -= 14;
    }
    layout.y -= height + 8;
  }
  if (contratar.candidato_en_riesgo) {
    const risk = wrap(contratar.candidato_en_riesgo, fonts.regular, 10, layout.width - 28);
    const height = 34 + risk.length * 14;
    layout.ensure(height + 8);
    box(layout.page, {x: MARGIN, y: layout.y - height, w: layout.width, h: height, color: CARD, borderColor: LINE});
    layout.text(fonts.semi, 'A quién podría costarle más', 10, MARGIN + 14, layout.y - 16, MUTED);
    let cursor = layout.y - 32;
    for (const row of risk) {
      layout.text(fonts.regular, row, 10, MARGIN + 14, cursor, INK);
      cursor -= 14;
    }
    layout.y -= height + 8;
  }

  if (contratar.riesgos_de_contratacion?.length) {
    layout.eyebrow('Para tener en cuenta');
    for (const item of contratar.riesgos_de_contratacion) {
      layout.ensure(40);
      layout.text(fonts.semi, item.riesgo, 11, MARGIN, layout.y - 12, INK);
      layout.y -= 16;
      layout.body(item.mitigacion || item.evidencia);
    }
  }

  if (contratar.preguntas_de_entrevista?.length) {
    layout.eyebrow('Preguntas para la entrevista');
    layout.body('Sirven para conversar, no para poner una nota.');
    for (const [index, item] of contratar.preguntas_de_entrevista.entries()) {
      const q = wrap(item.pregunta, fonts.semi, 11, layout.width - 28);
      const why = wrap(item.que_revela, fonts.regular, 9, layout.width - 28);
      const height = 20 + (q.length + why.length) * 14;
      layout.ensure(height + 6);
      layout.text(fonts.bold, String(index + 1), 11, MARGIN, layout.y - 14, BLUE);
      let cursor = layout.y - 14;
      for (const row of q) {
        layout.text(fonts.semi, row, 11, MARGIN + 18, cursor, INK);
        cursor -= 14;
      }
      for (const row of why) {
        layout.text(fonts.regular, row, 9, MARGIN + 18, cursor, MUTED);
        cursor -= 13;
      }
      layout.y = cursor - 8;
    }
  }

  if (contratar.mensaje_honesto_para_candidatos) {
    const rows = wrap(contratar.mensaje_honesto_para_candidatos, fonts.regular, 10, layout.width - 28);
    const height = 34 + rows.length * 14;
    layout.card(height, (top) => {
      layout.text(fonts.semi, 'Cómo contárselo a los candidatos', 10, MARGIN + 14, top - 16, INK);
      let cursor = top - 32;
      for (const row of rows) {
        layout.text(fonts.regular, row, 10, MARGIN + 14, cursor, MUTED);
        cursor -= 14;
      }
    });
  }

  if (informe?.recomendaciones?.length) {
    layout.title('Próximos pasos', 18);
    for (const item of informe.recomendaciones) {
      const rows = wrap(item.accion, fonts.semi, 11, layout.width - 36);
      const meta = wrap(
        [item.responsable_sugerido, item.plazo ? `En ${String(item.plazo).replace('_', ' ')}` : '', item.indicador_de_exito]
          .filter(Boolean)
          .join('  ·  '),
        fonts.regular,
        9,
        layout.width - 36,
      );
      const height = 22 + (rows.length + meta.length) * 13;
      layout.ensure(height + 8);
      layout.page.drawCircle({x: MARGIN + 6, y: layout.y - 12, size: 7, color: GOOD_BG});
      layout.text(fonts.bold, String(item.prioridad), 8, MARGIN + 3.5, layout.y - 15, GOOD);
      let cursor = layout.y - 14;
      for (const row of rows) {
        layout.text(fonts.semi, row, 11, MARGIN + 22, cursor, INK);
        cursor -= 14;
      }
      for (const row of meta) {
        layout.text(fonts.regular, row, 9, MARGIN + 22, cursor, MUTED);
        cursor -= 12;
      }
      layout.y = cursor - 10;
    }
  }

  layout.gap(8);
  layout.body(`Corte ${informe?.empresa?.fecha_corte || 'hoy'}. Las respuestas son anónimas. TaleX no decide por nadie: informa para que una persona decida mejor.`);
  layout.finish(organizationName);
  return Buffer.from(await doc.save());
}
