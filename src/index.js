import http from 'node:http';
import {config} from './config.js';
import {pingDatabase} from './db.js';
import {ApiError, json, readBody, redirect} from './http.js';
import {actorFrom} from './auth.js';
import {handleRpc} from './application/rpc.js';
import {handleTable} from './application/tables.js';
import {createCultureLead} from './application/culture-leads.js';
import {getCultureSurvey, submitCultureSurvey} from './application/culture-survey.js';
import {getCultureReport} from './application/culture-report.js';

function publicBase() {
  const configured = String(config.publicSurveyBase || 'https://platform.talex.com.co').replace(/\/$/, '');
  if (!configured || /api\.talex\.com\.co$/i.test(configured)) {
    return 'https://platform.talex.com.co';
  }
  return configured;
}

export async function handleRequest(request, response) {
  try {
    if (request.method === 'OPTIONS') {
      json(response, 204, {});
      return;
    }
    const url = new URL(request.url, 'http://localhost');
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
    const cultureReportApi = url.pathname.match(/^\/api\/cultura\/([^/]+)\/informe$/);
    if (cultureReportApi) {
      if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed');
      const report = await getCultureReport(cultureReportApi[1]);
      if (!report) throw new ApiError(404, 'company_not_found');
      json(response, 200, report);
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

    const actor = await actorFrom(request);
    if (request.method === 'POST' && url.pathname.startsWith('/v1/rpc/')) {
      json(
        response,
        200,
        await handleRpc(url.pathname.slice('/v1/rpc/'.length), actor, await readBody(request)),
      );
      return;
    }
    if (url.pathname.startsWith('/v1/data/')) {
      const table = url.pathname.slice('/v1/data/'.length);
      const body = request.method === 'GET' ? {} : await readBody(request);
      json(response, 200, await handleTable(request.method, table, url, actor, body));
      return;
    }
    throw new ApiError(404, 'not_found');
  } catch (error) {
    console.error(request.method, request.url, error.code || error.name, error.message);
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
