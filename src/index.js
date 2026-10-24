import http from 'node:http';
import {config} from './config.js';
import {pingDatabase} from './db.js';
import {ApiError, json, readBody} from './http.js';
import {actorFrom} from './auth.js';
import {handleRpc} from './application/rpc.js';
import {handleTable} from './application/tables.js';

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
    json(response, error.status || 500, {
      code: error.code || 'unexpected',
      message: error.message,
    });
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
