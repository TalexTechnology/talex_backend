export function cultureSurveyPageHtml(organizationId) {
  const id = String(organizationId || '').replace(/[^a-zA-Z0-9-]/g, '');
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Diagnóstico cultural · TaleX</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Source+Sans+3:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; background: #f3efe6; color: #17202a;
      font-family: "Source Sans 3", Arial, sans-serif;
    }
    header {
      padding: 28px 8vw 0; display: flex; justify-content: space-between; align-items: baseline;
    }
    .brand { letter-spacing: .18em; text-transform: uppercase; font-size: 12px; color: #7a715f; }
    .progress { font-size: 13px; color: #6b7280; }
    main { width: min(760px, 92vw); margin: 0 auto; padding: 36px 0 80px; }
    h1 { font-family: "Cormorant Garamond", Georgia, serif; font-size: clamp(36px, 5vw, 52px); font-weight: 500; margin: 0 0 12px; }
    .lead { font-size: 18px; line-height: 1.6; color: #3d4550; max-width: 38em; }
    .card {
      margin-top: 36px; background: #fff; border: 1px solid #e4ddd0; padding: 28px 28px 24px;
    }
    .section { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: #8a6a32; margin: 0 0 10px; }
    .statement { font-size: 22px; line-height: 1.4; margin: 0 0 18px; font-family: "Cormorant Garamond", Georgia, serif; }
    .hint { font-size: 14px; color: #6b7280; margin: -8px 0 18px; }
    .options { display: grid; gap: 8px; }
    label.opt {
      display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px;
      border: 1px solid #e4ddd0; background: #fbfaf6; cursor: pointer;
    }
    label.opt:hover, label.opt.active { border-color: #102033; background: #fff; }
    textarea {
      width: 100%; min-height: 120px; border: 1px solid #d7d0c3; padding: 12px 14px;
      font: 16px/1.5 "Source Sans 3", Arial, sans-serif; background: #fbfaf6;
    }
    .actions { display: flex; justify-content: space-between; gap: 12px; margin-top: 22px; }
    button {
      border: 0; cursor: pointer; font: 600 14px/1 "Source Sans 3", Arial, sans-serif;
      letter-spacing: .04em; padding: 13px 20px;
    }
    .next { background: #102033; color: #f7f2e8; }
    .back { background: transparent; color: #102033; padding-left: 0; }
    .error { color: #8a2b2b; margin-top: 12px; }
    .done h1 { margin-bottom: 16px; }
  </style>
</head>
<body>
  <header>
    <div class="brand">TaleX · Diagnóstico cultural</div>
    <div class="progress" id="progress"></div>
  </header>
  <main id="app">Cargando…</main>
  <script>
    const orgId = ${JSON.stringify(id)};
    const app = document.getElementById('app');
    const progress = document.getElementById('progress');
    let survey = null;
    let index = 0;
    const answers = {};

    async function load() {
      try {
        const response = await fetch('/api/cultura/' + encodeURIComponent(orgId));
        survey = await response.json();
        if (!response.ok) throw new Error(survey.message || 'No encontramos este diagnóstico.');
        render();
      } catch (error) {
        app.innerHTML = '<div class="card"><h1>No pudimos abrir el diagnóstico</h1><p class="lead">' + escapeHtml(error.message) + '</p></div>';
      }
    }

    function current() { return survey.questions[index]; }

    function render() {
      if (!survey.questions.length) {
        app.innerHTML = '<div class="card"><p class="section">En preparación</p><h1>El diagnóstico aún no está publicado</h1><p class="lead">El equipo TaleX está cargando las preguntas. Vuelva a este enlace en un momento.</p></div>';
        return;
      }
      if (index >= survey.questions.length) return thanks();
      const q = current();
      progress.textContent = (index + 1) + ' / ' + survey.questions.length;
      const options = q.format === 'text' ? '' : q.options.map((label, i) => {
        const value = i + 1;
        const checked = answers[q.id]?.value_int === value;
        return '<label class="opt' + (checked ? ' active' : '') + '"><input type="radio" name="a" value="' + value + '"' + (checked ? ' checked' : '') + '> <span>' + escapeHtml(label) + '</span></label>';
      }).join('');
      app.innerHTML = '<p class="lead" style="margin:0 0 8px">' + escapeHtml(survey.intro) + '</p>' +
        '<div class="card">' +
        '<p class="section">' + escapeHtml(q.sectionTitle) + '</p>' +
        '<p class="statement">' + escapeHtml(q.statement) + '</p>' +
        (q.instruction ? '<p class="hint">' + escapeHtml(q.instruction) + '</p>' : '') +
        (q.format === 'text'
          ? '<textarea id="text">' + escapeHtml(answers[q.id]?.value_text || '') + '</textarea>'
          : '<div class="options">' + options + '</div>') +
        '<div class="error" id="err"></div>' +
        '<div class="actions">' +
          '<button class="back" type="button" id="back"' + (index === 0 ? ' disabled' : '') + '>Anterior</button>' +
          '<button class="next" type="button" id="next">' + (index === survey.questions.length - 1 ? 'Enviar respuestas' : 'Continuar') + '</button>' +
        '</div></div>';
      document.getElementById('back').onclick = () => { if (index > 0) { index -= 1; render(); } };
      document.getElementById('next').onclick = next;
      document.querySelectorAll('input[name=a]').forEach((input) => {
        input.onchange = () => {
          answers[q.id] = { value_int: Number(input.value) };
          render();
        };
      });
    }

    async function next() {
      const q = current();
      const err = document.getElementById('err');
      if (q.format === 'text') {
        const value = document.getElementById('text').value.trim();
        if (q.required && !value) { err.textContent = 'Este comentario nos ayuda a completar el diagnóstico.'; return; }
        answers[q.id] = { value_text: value };
      } else if (q.required && !answers[q.id]) {
        err.textContent = 'Elija la opción que mejor describa su experiencia.';
        return;
      }
      if (index < survey.questions.length - 1) { index += 1; render(); return; }
      document.getElementById('next').disabled = true;
      try {
        const response = await fetch('/api/cultura/' + encodeURIComponent(orgId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'No pudimos guardar las respuestas.');
        index = survey.questions.length;
        thanks();
      } catch (error) {
        err.textContent = error.message;
        document.getElementById('next').disabled = false;
      }
    }

    function thanks() {
      progress.textContent = '';
      app.innerHTML = '<div class="card done"><p class="section">Listo</p><h1>Gracias por su tiempo</h1><p class="lead">Sus respuestas ya quedan en el diagnóstico de la organización. Puede cerrar esta página.</p></div>';
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]));
    }

    load();
  </script>
</body>
</html>`;
}
