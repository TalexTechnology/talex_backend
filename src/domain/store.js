import {collection, connectDatabase, driverOptions, mongoError} from '../db.js';

function strip(doc) {
  if (!doc) return null;
  const copy = {...doc};
  delete copy._id;
  return copy;
}

async function run(work) {
  try {
    await connectDatabase();
    return await work();
  } catch (error) {
    throw mongoError(error);
  }
}

export async function findOne(name, filter, sort) {
  return run(async () => {
    const cursor = collection(name).find(filter, driverOptions());
    if (sort) cursor.sort(sort);
    return strip(await cursor.limit(1).next());
  });
}

export async function findMany(name, filter = {}, {sort, limit = 500} = {}) {
  return run(async () => {
    const cursor = collection(name).find(filter, driverOptions());
    if (sort) cursor.sort(sort);
    cursor.limit(Math.min(Math.max(limit, 1), 5000));
    return (await cursor.toArray()).map(strip);
  });
}

export async function insertOne(name, doc) {
  return run(async () => {
    await collection(name).insertOne(doc, driverOptions());
    return strip(doc);
  });
}

export async function updateOne(name, filter, set) {
  return run(async () => {
    const updated = await collection(name).findOneAndUpdate(
      filter,
      {$set: set},
      {...driverOptions(), returnDocument: 'after'},
    );
    return strip(updated?.value === undefined ? updated : updated.value);
  });
}

export async function updateMany(name, filter, set) {
  return run(async () => {
    const result = await collection(name).updateMany(filter, {$set: set}, driverOptions());
    return result.modifiedCount;
  });
}

export async function deleteMany(name, filter) {
  return run(async () => {
    const result = await collection(name).deleteMany(filter, driverOptions());
    return result.deletedCount;
  });
}

export async function count(name, filter = {}) {
  return run(() => collection(name).countDocuments(filter, driverOptions()));
}

export async function upsertOne(name, filter, set, insert) {
  return run(async () => {
    const updated = await collection(name).findOneAndUpdate(
      filter,
      {$set: set, $setOnInsert: insert},
      {...driverOptions(), upsert: true, returnDocument: 'after'},
    );
    return strip(updated?.value === undefined ? updated : updated.value);
  });
}

export function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
