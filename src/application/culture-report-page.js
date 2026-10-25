export function cultureReportPageHtml(organizationId) {
  const id = String(organizationId || '').replace(/[^a-zA-Z0-9-]/g, '');
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Informe cultural · TaleX</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Source+Sans+3:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { margin:0; background:#f3efe6; color:#17202a; font-family:"Source Sans 3",Arial,sans-serif; }
    header { padding:28px 8vw 0; letter-spacing:.18em; text-transform:uppercase; font-size:12px; color:#7a715f; }
    main { width:min(800px,92vw); margin:0 auto; padding:36px 0 80px; }
    h1 { font-family:"Cormorant Garamond",Georgia,serif; font-size:clamp(36px,5vw,52px); font-weight:500; margin:0 0 12px; }
    .lead { font-size:18px; line-height:1.6; color:#3d4550; }
    .card { margin-top:22px; background:#fff; border:1px solid #e4ddd0; padding:24px 28px; }
    .kpis { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
    .kpi span { display:block; font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:#8a6a32; }
    .kpi strong { font-size:28px; font-family:"Cormorant Garamond",Georgia,serif; }
    .section h2 { margin:0 0 8px; font-size:22px; font-family:"Cormorant Garamond",Georgia,serif; }
    .muted { color:#6b7280; }
    @media (max-width:700px) { .kpis { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>TaleX · Informe cultural</header>
  <main id="app">Cargando…</main>
  <script>
    const orgId = ${JSON.stringify(id)};
    const app = document.getElementById('app');
    fetch('/api/cultura/' + encodeURIComponent(orgId) + '/informe')
      .then((response) => response.json().then((body) => ({ok: response.ok, body})))
      .then(({ok, body}) => {
        if (!ok) throw new Error(body.message || 'No encontramos este informe.');
        const c = body.coverage || {};
        const collecting = body.status === 'collecting';
        app.innerHTML =
          '<p class="lead">Hola ' + escapeHtml(body.organizationName || 'equipo') + '</p>' +
          '<h1>' + (collecting ? 'El informe aún se está construyendo' : 'Avance del informe cultural') + '</h1>' +
          '<p class="lead">' + (collecting
            ? 'Cuando el equipo alcance el umbral de participación, este espacio mostrará la lectura cultural de la organización.'
            : 'Ya hay suficientes respuestas para armar el informe. El formato final (PDF o web) todavía no está definido; esta es la estructura lista para llenarse.') + '</p>' +
          '<div class="card kpis">' +
            kpi('Respuestas', c.respondents ?? 0) +
            kpi('Umbral', (c.needed ?? 0) + ' personas') +
            kpi('Participación', (c.percent ?? 0) + '%') +
          '</div>' +
          (body.sections || []).map((section) =>
            '<div class="card section"><h2>' + escapeHtml(section.title) + '</h2><p class="muted">' +
            escapeHtml(section.summary || 'Pendiente. Aquí irá la lectura de este bloque cuando se genere el informe.') +
            '</p></div>'
          ).join('');
      })
      .catch((error) => {
        app.innerHTML = '<div class="card"><h1>No pudimos abrir el informe</h1><p class="lead">' + escapeHtml(error.message) + '</p></div>';
      });
    function kpi(label, value) {
      return '<div class="kpi"><span>' + label + '</span><strong>' + escapeHtml(value) + '</strong></div>';
    }
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }
  </script>
</body>
</html>`;
}
