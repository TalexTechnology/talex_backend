import http from 'node:http';
import {config} from './config.js';
import {pingDatabase} from './db.js';
import {ApiError, json, readBody, redirect, sendPdf} from './http.js';
import {actorFrom, bearerToken, demoReportActor, superadminFrom} from './auth.js';
import {handleRpc} from './application/rpc.js';
import {handleTable} from './application/tables.js';
import {createCultureLead} from './application/culture-leads.js';
import {getCultureSurvey, submitCultureSurvey} from './application/culture-survey.js';
import {getCultureReport} from './application/culture-report.js';
import {listCultureResponses} from './application/culture-responses.js';
import {publishCultureReportPdf} from './application/culture-report-send.js';
import {getCultureReportPdfFile, pdfBytes} from './application/culture-report-file.js';
import {releaseDueCultureReports} from './application/culture-report-auto.js';
import {confirmCultureShared, trackCultureVisit} from './application/culture-tracking.js';

function publicBase() {
  const configured = String(config.publicSurveyBase || 'https://platform.talex.com.co').replace(/\/$/, '');
  if (!configured || /api\.talex\.com\.co$/i.test(configured)) {
    return 'https://platform.talex.com.co';
  }
  return configured;
}

function apiBase(request, url) {
  const proto = String(request.headers['x-forwarded-proto'] || url.protocol || 'https').replace(':', '');
  const host = String(request.headers.host || 'api.talex.com.co');
  return `${proto}://${host}`;
}

export async function handleRequest(request, response) {
  try {
    if (request.method === 'OPTIONS') {
      json(response, 204, {});
      return;
    }
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/favicon.ico')) {
      if (url.pathname === '/favicon.ico') {
        json(response, 204, {});
        return;
      }
      json(response, 200, {ok: true, service: 'talex-api', health: '/health'});
      return;
    }
    if (url.pathname === '/api/cron/culture-reports') {
      if (request.method !== 'GET' && request.method !== 'POST') throw new ApiError(405, 'method_not_allowed');
      const vercelCron = request.headers['x-vercel-cron'] === '1';
      const cronToken = bearerToken(request);
      const allowed =
        (config.cronSecret && cronToken === config.cronSecret) ||
        (vercelCron && !config.cronSecret) ||
        Boolean(demoReportActor(request));
      if (!allowed) throw new ApiError(401, 'need_sign_in');
      json(response, 200, await releaseDueCultureReports({baseUrl: apiBase(request, url)}));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      await pingDatabase();
      json(response, 200, {ok: true, database: 'mongodb'});
      return;
    }
    if (url.pathname === '/api/mi-cultura') {
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed');
      json(response, 200, await createCultureLead(await readBody(request), {baseUrl: publicBase()}));
      return;
    }
    const culturePage = url.pathname.match(/^\/cultura\/([^/]+)(\/informe)?$/);
    if (culturePage) {
      if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed');
      redirect(response, `${publicBase()}${url.pathname}`);
      return;
    }
    const cultureReportPdfApi = url.pathname.match(/^\/api\/cultura\/([^/]+)\/informe\.pdf$/);
    if (cultureReportPdfApi) {
      await superadminFrom(request);
      if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed');
      const file = await getCultureReportPdfFile(cultureReportPdfApi[1], {
        version: url.searchParams.get('version'),
        fileId: url.searchParams.get('file'),
      });
      const bytes = pdfBytes(file);
      if (!bytes?.length) throw new ApiError(404, 'pdf_not_found', 'Aún no hay un PDF guardado para esta empresa.');
      sendPdf(response, bytes, {
        filename: file.filename,
        download: url.searchParams.get('download') === '1',
      });
      return;
    }
    const cultureReportApi = url.pathname.match(/^\/api\/cultura\/([^/]+)\/informe$/);
    if (cultureReportApi) {
      const actor = await superadminFrom(request);
      if (request.method === 'GET') {
        const report = await getCultureReport(cultureReportApi[1]);
        if (!report) throw new ApiError(404, 'company_not_found');
        json(response, 200, report);
        return;
      }
      if (request.method === 'POST') {
        json(
          response,
          200,
          await publishCultureReportPdf(actor, {
            ...(await readBody(request)),
            p_organization_id: cultureReportApi[1],
          }, {baseUrl: apiBase(request, url)}),
        );
        return;
      }
      throw new ApiError(405, 'method_not_allowed');
    }
    const cultureAnswersApi = url.pathname.match(/^\/api\/cultura\/([^/]+)\/respuestas$/);
    if (cultureAnswersApi) {
      await superadminFrom(request);
      if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed');
      const respuestas = await listCultureResponses(cultureAnswersApi[1]);
      if (!respuestas) throw new ApiError(404, 'company_not_found');
      json(response, 200, respuestas);
      return;
    }
    const trackingApi = url.pathname.match(/^\/api\/cultura\/([^/]+)\/(visitas|compartir)$/);
    if (trackingApi) {
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed');
      const body = await readBody(request);
      const result = trackingApi[2] === 'visitas'
        ? await trackCultureVisit(trackingApi[1], body)
        : await confirmCultureShared(trackingApi[1], body);
      json(response, 200, result);
      return;
    }
    const cultureApi = url.pathname.match(/^\/api\/cultura\/([^/]+)$/);
    if (cultureApi) {
      if (request.method === 'GET') {
        json(response, 200, await getCultureSurvey(cultureApi[1]));
        return;
      }
      if (request.method === 'POST') {
        json(
          response,
          200,
          await submitCultureSurvey(cultureApi[1], await readBody(request), {
            baseUrl: publicBase(),
          }),
        );
        return;
      }
      throw new ApiError(405, 'method_not_allowed');
    }

    if (request.method === 'POST' && url.pathname.startsWith('/v1/rpc/')) {
      const name = url.pathname.slice('/v1/rpc/'.length);
      const actor =
        name === 'generate_culture_report' || name === 'send_culture_report_pdf'
          ? demoReportActor(request) || (await actorFrom(request))
          : await actorFrom(request);
      json(response, 200, await handleRpc(name, actor, await readBody(request)));
      return;
    }
    if (url.pathname.startsWith('/v1/data/')) {
      const table = url.pathname.slice('/v1/data/'.length);
      const body = request.method === 'GET' ? {} : await readBody(request);
      json(response, 200, await handleTable(request.method, table, url, await actorFrom(request), body));
      return;
    }
    throw new ApiError(404, 'not_found');
  } catch (error) {
    const status = error.status || 500;
    const log = status >= 500 ? console.error : console.info;
    log(request.method, request.url, error.code || error.name, error.message);
    const payload = {
      code: error.code || 'unexpected',
      message: error.message,
    };
    if (String(request.url || '').includes('/api/mi-cultura')) {
      payload.success = false;
    }
    json(response, error.status || 500, payload);
  }
}

if (!process.env.VERCEL) {
  const server = http.createServer(handleRequest);
  server.listen(config.port, async () => {
    console.log(`TaleX API on :${config.port}`);
    try {
      await pingDatabase();
      console.log(`MongoDB ok database=${config.mongodbDatabase}`);
    } catch (error) {
      console.error('MongoDB no responde:', error.code, error.message);
    }
  });
}
