import nodemailer from 'nodemailer';
import {config} from './config.js';

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

export async function sendMail({to, subject, text, html}) {
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
      });
      return;
    } catch (error) {
      lastError = error;
      console.error('SMTP error', {port, code: error.code, message: error.message});
    }
  }
  throw lastError || new Error('smtp_failed');
}

export function cultureShareEmail({companyName, contactName, surveyUrl}) {
  const name = contactName || companyName || 'equipo';
  const subject = `Diagnóstico cultural de ${name}`;
  const text = [
    `Hola ${name},`,
    '',
    'Gracias por el primer paso. Para entender cómo se vive el trabajo en tu organización, comparte este enlace con tus colegas. Cada persona responde de forma individual; las respuestas quedan agrupadas para tu empresa.',
    '',
    surveyUrl,
    '',
    'Puedes reenviar este mismo enlace cuando quieras.',
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
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#7a715f;">TaleX · Cultura organizacional</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 8px;color:#1b2430;">
            <p style="margin:0 0 18px;font-size:26px;line-height:1.25;">Hola ${escapeHtml(name)}</p>
            <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3d4550;">
              Gracias por el primer paso. Para entender cómo se vive el trabajo en tu organización,
              <strong>comparte este enlace con tus colegas</strong>.
            </p>
            <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#3d4550;">
              Cada persona responde de forma individual. Las respuestas quedan agrupadas para tu empresa.
            </p>
            <p style="margin:0 0 28px;">
              <a href="${escapeHtml(surveyUrl)}"
                style="display:inline-block;background:#102033;color:#f7f2e8;text-decoration:none;padding:14px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:0.04em;">
                Abrir el diagnóstico cultural
              </a>
            </p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#6b7280;">
              Puedes reenviar este mismo enlace cuando quieras. No requiere crear una cuenta.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 36px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8478;">
            TaleX · Diagnóstico cultural para equipos de liderazgo
          </td>
        </tr>
      </table>
    </td></tr>
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
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
