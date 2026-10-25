import nodemailer from 'nodemailer';
import {config} from './config.js';
import {participationFor} from './application/culture-participation.js';

const LOGO_URL = 'https://www.talex.com.co/talex_logo_horizontal_fondo_oscuro.png';

function logoMarkup() {
  return `<img src="${LOGO_URL}" alt="TaleX" width="144" height="48" style="display:block;border:0;outline:none;text-decoration:none;width:144px;height:48px;">`;
}

function createTransport(port) {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: {user: config.smtp.user, pass: config.smtp.pass},
    family: 4,
    connectionTimeout: 25000,
    greetingTimeout: 25000,
    socketTimeout: 25000,
    tls: {servername: config.smtp.host, minVersion: 'TLSv1.2'},
  });
}

export function smtpReady() {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}

export async function sendMail({to, subject, text, html, attachments}) {
  if (!smtpReady()) {
    const error = new Error('smtp_unconfigured');
    error.status = 503;
    error.code = 'smtp_unconfigured';
    throw error;
  }
  const from = config.smtp.from || config.smtp.user;
  const ports = [...new Set([config.smtp.port, 465, 587])].filter(
    (port) => port === 465 || port === 587,
  );
  let lastError;
  for (const port of ports) {
    try {
      await createTransport(port).sendMail({
        from: `TaleX <${from}>`,
        to,
        subject,
        text,
        html,
        attachments,
      });
      return;
    } catch (error) {
      lastError = error;
      console.error('SMTP error', {port, code: error.code, message: error.message});
    }
  }
  throw lastError || new Error('smtp_failed');
}

export function cultureShareEmail({
  companyName,
  contactName,
  employeeRange,
  surveyUrl,
}) {
  const name = contactName?.trim() || companyName?.trim() || 'equipo';
  const company = companyName?.trim();
  const url = new URL(surveyUrl);

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('El enlace del diagnóstico debe usar HTTP o HTTPS.');
  }

  const safeUrl = escapeHtml(url.href);
  const participation = participationFor(employeeRange);

  const subject = company
    ? `${company}: descubre la cultura que vive tu equipo`
    : 'Descubre la cultura que vive tu equipo';

  const preheader =
    'Comparte el diagnóstico con tu equipo y conoce cuántas respuestas necesitas para tu informe.';

  const text = [
    `Hola ${name},`,
    '',
    'Ya diste el primer paso para conocer la cultura de tu empresa.',
    '',
    'Lo que el líder cree y lo que el equipo vive no siempre coinciden. Para entender cómo se trabaja realmente en tu organización, el siguiente paso es escuchar a quienes la construyen contigo.',
    '',
    'Ahora, dale la palabra a tu equipo.',
    '',
    'Comparte este enlace del diagnóstico:',
    url.href,
    '',
    'Cada persona responde de forma individual y las respuestas se agrupan para tu empresa. No necesitan crear una cuenta.',
    '',
    '¿Cómo recibir tu informe?',
    '',
    '1. Comparte el enlace con tu equipo. Todas las personas deben usar el mismo enlace.',
    '',
    '2. Pide a cada persona que complete la encuesta de forma individual, pensando en lo que vive en su día a día: cómo toman decisiones, colaboran y se relacionan.',
    '',
    `3. Alcancen el mínimo de participación. ${participation.title}. ${participation.neededText} ${participation.tip}`,
    '',
    'Tu informe estará disponible 24 horas después de alcanzar ese mínimo. El plazo comienza cuando se cumple, no cuando compartes el enlace.',
    '',
    'Puedes copiar el enlace y compartirlo por correo, WhatsApp o el canal que use tu equipo. Reenvíalo como recordatorio a quienes aún no hayan completado la encuesta.',
    '',
    'La cultura se entiende mejor cuando escuchas al equipo.',
    '',
    'El equipo de TaleX',
    'https://talex.com.co',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(subject)}</title>
</head>

<body style="margin:0;padding:0;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#0b1528;-webkit-text-size-adjust:100%;">

  <div style="display:none;font-size:1px;line-height:1px;color:#ffffff;max-height:0;max-width:0;overflow:hidden;mso-hide:all;">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#ffffff;">
    <tr>
      <td align="center" style="padding:24px 16px 40px;">

        <!--[if mso]>
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0">
          <tr><td>
        <![endif]-->

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;">

          <tr>
            <td width="100%" align="left" bgcolor="#0b1528" style="padding:16px 24px;background-color:#0b1528;border-radius:12px 12px 0 0;border-bottom:3px solid #a4e765;">
              <a href="https://talex.com.co" style="text-decoration:none;">
                ${logoMarkup()}
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:36px 8px 0;">
              <p style="margin:0 0 20px;font-size:12px;font-weight:700;line-height:1.5;letter-spacing:1.5px;text-transform:uppercase;color:#254a78;">
                Tu cultura · La voz de tu equipo
              </p>

              <h1 style="margin:0 0 24px;font-size:32px;line-height:1.2;letter-spacing:-0.8px;font-weight:700;color:#0b1528;">
                Descubre la cultura<br>
                que vive tu equipo.
              </h1>

              <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#0b1528;">
                Hola ${escapeHtml(name)},
              </p>

              <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#4b5563;">
                Ya diste el primer paso para conocer la cultura de tu empresa.
              </p>

              <p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:#4b5563;">
                Lo que el líder cree y lo que el equipo vive no siempre coinciden.
                Para entender cómo se trabaja realmente en tu organización,
                el siguiente paso es
                <strong style="color:#0b1528;">escuchar a quienes la construyen contigo.</strong>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 8px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f3f6fa;border:1px solid #dce4ee;border-left:4px solid #254a78;border-radius:12px;">
                <tr>
                  <td style="padding:24px;">
                    <h2 style="margin:0 0 10px;font-size:18px;line-height:1.4;color:#0b1528;">
                      Ahora, dale la palabra a tu equipo.
                    </h2>

                    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#4b5563;">
                      Comparte el enlace del diagnóstico. Cada persona responde
                      de forma individual y las respuestas se agrupan para tu empresa.
                    </p>

                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td align="center" bgcolor="#0b1528" style="background-color:#0b1528;border-radius:8px;mso-padding-alt:15px 24px;">
                          <a href="${safeUrl}" style="display:inline-block;padding:15px 24px;border:1px solid #0b1528;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;">
                            Abrir diagnóstico cultural
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#596779;">
                      Tu equipo no necesita crear una cuenta para responder.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 8px 0;">
              <h2 style="margin:0 0 18px;font-size:20px;line-height:1.4;color:#0b1528;">
                ¿Cómo recibir tu informe?
              </h2>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#4b5563;">
                <strong style="color:#254a78;">1. Comparte el enlace con tu equipo.</strong><br>
                Invita a las personas de tu organización a responder el diagnóstico.
                Todas deben usar el mismo enlace.
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#4b5563;">
                <strong style="color:#254a78;">2. Cada persona completa la encuesta.</strong><br>
                Pídeles que respondan de forma individual, pensando en lo que viven
                en su día a día: cómo toman decisiones, colaboran y se relacionan.
              </p>

              <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#4b5563;">
                <strong style="color:#254a78;">3. Alcancen el mínimo de participación.</strong><br>
                ${escapeHtml(participation.title)}. ${escapeHtml(participation.neededText)}
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f3f6fa;border-left:4px solid #a4e765;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 8px;font-size:15px;font-weight:700;line-height:1.7;color:#0b1528;">
                      ${escapeHtml(participation.tip)}
                    </p>
                    <p style="margin:0 0 8px;font-size:15px;font-weight:700;line-height:1.7;color:#0b1528;">
                      Tu informe estará disponible 24 horas después de alcanzar ese mínimo.
                    </p>
                    <p style="margin:0;font-size:13px;line-height:1.7;color:#596779;">
                      El plazo comienza cuando se cumple, no cuando compartes el enlace.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 8px 0;">
              <p style="margin:0 0 8px;font-size:14px;font-weight:700;line-height:1.6;color:#0b1528;">
                Este es el enlace para compartir:
              </p>

              <p style="margin:0 0 16px;font-size:13px;line-height:1.7;word-break:break-all;overflow-wrap:anywhere;">
                <a href="${safeUrl}" style="color:#254a78;text-decoration:underline;">${safeUrl}</a>
              </p>

              <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#6b7280;">
                Cópialo y envíalo por correo, WhatsApp o el canal que use tu equipo.
                Puedes reenviarlo como recordatorio a quienes aún no hayan
                completado la encuesta.
              </p>

              <p style="margin:0 0 24px;font-size:16px;font-weight:700;line-height:1.6;color:#0b1528;">
                La cultura se entiende mejor cuando escuchas al equipo.
              </p>

              <p style="margin:0 0 32px;font-size:14px;line-height:1.6;color:#4b5563;">
                El equipo de TaleX
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 8px 0;border-top:1px solid #e7ebef;">
              <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#6b7280;">
                TaleX · Medimos el fit cultural entre candidatos y empresas.
              </p>

              <p style="margin:0;font-size:12px;line-height:1.6;">
                <a href="https://talex.com.co" style="color:#6b7280;text-decoration:underline;">
                  Conoce TaleX
                </a>
                <span style="color:#c2c8d0;">&nbsp; · &nbsp;</span>
                <a href="https://talex.com.co/privacidad" style="color:#6b7280;text-decoration:underline;">
                  Política de privacidad
                </a>
              </p>
            </td>
          </tr>

        </table>

        <!--[if mso]>
          </td></tr>
        </table>
        <![endif]-->

      </td>
    </tr>
  </table>
</body>
</html>`;

  return {subject, text, html};
}

export function cultureReportReadyEmail({companyName, contactName, reportUrl, coverage}) {
  const name = contactName || companyName || 'equipo';
  const respondents = coverage?.respondents ?? 0;
  const needed = coverage?.needed ?? 0;
  const percent = coverage?.percent ?? 0;
  const subject = `Informe cultural de ${name}`;
  const text = [
    `Hola ${name},`,
    '',
    `Ya alcanzaron el umbral de participación (${respondents} respuestas, ${percent}% sobre el tamaño estimado).`,
    'El informe cultural está listo para armarse. Todavía no definimos si la versión final será PDF o web; por ahora pueden ver el avance aquí:',
    '',
    reportUrl,
  ].join('\n');
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e4ddd0;">
        <tr>
          <td style="padding:28px 36px 12px;border-bottom:1px solid #e4ddd0;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#7a715f;">TaleX · Informe cultural</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 8px;color:#1b2430;">
            <p style="margin:0 0 18px;font-size:26px;line-height:1.25;">Hola ${escapeHtml(name)}</p>
            <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3d4550;">
              Ya alcanzaron el umbral de participación:
              <strong>${respondents} respuestas</strong> (${percent}% del tamaño estimado; se pedían ${needed}).
            </p>
            <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#3d4550;">
              El informe cultural ya se puede armar. El formato final (PDF o web) todavía no está definido; este avance deja lista la estructura.
            </p>
            <p style="margin:0 0 28px;">
              <a href="${escapeHtml(reportUrl)}"
                style="display:inline-block;background:#102033;color:#f7f2e8;text-decoration:none;padding:14px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:0.04em;">
                Ver el avance del informe
              </a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 36px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8478;">
            TaleX · Lectura cultural para equipos de liderazgo
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return {subject, text, html};
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
