import {AsyncLocalStorage} from 'node:async_hooks';
import {MongoClient} from 'mongodb';
import {config} from './config.js';
import {ensureIndexes} from './indexes.js';
import {ensureSeed} from './seed.js';

const sessions = new AsyncLocalStorage();
let client;
let database;
let connecting;

export function currentSession() {
  return sessions.getStore();
}

function options() {
  const session = currentSession();
  return session ? {session} : {};
}

export async function connectDatabase() {
  if (database) return database;
  if (!connecting) connecting = open();
  return connecting;
}

async function open() {
  if (!config.mongodbUri) {
    const error = new Error('mongodb_unconfigured');
    error.status = 503;
    error.code = 'mongodb_unconfigured';
    throw error;
  }
  client = new MongoClient(config.mongodbUri, {serverSelectionTimeoutMS: 8000});
  try {
    await client.connect();
    database = client.db(config.mongodbDatabase);
    await ensureIndexes(database);
    await ensureSeed(database);
    return database;
  } catch (error) {
    connecting = null;
    client = null;
    database = null;
    throw mongoError(error);
  }
}

export function collection(name) {
  if (!database) throw new Error('mongodb_unconfigured');
  return database.collection(name);
}

export function driverOptions() {
  return options();
}

export async function pingDatabase() {
  const db = await connectDatabase();
  await db.command({ping: 1});
}

export async function withTransaction(work) {
  await connectDatabase();
  const session = client.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await sessions.run(session, work);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function closeDatabase() {
  if (client) await client.close();
  client = null;
  database = null;
  connecting = null;
}

export function mongoError(error) {
  if (error?.code === 11000) {
    return Object.assign(new Error('duplicate'), {status: 409, code: 'duplicate'});
  }
  if (
    error?.name === 'MongoServerSelectionError' ||
    error?.name === 'MongoNetworkError' ||
    error?.code === 'ENOTFOUND'
  ) {
    return Object.assign(new Error('mongodb_unreachable'), {
      status: 503,
      code: 'mongodb_unreachable',
    });
  }
  return Object.assign(error, {
    status: error.status || 500,
    code: error.code || 'mongodb_error',
  });
}
