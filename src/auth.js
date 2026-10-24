import {initializeApp, getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {config} from './config.js';
import {ApiError} from './http.js';
import {findOne} from './domain/store.js';
import {activeMembership} from './domain/tenancy.js';
import {upsertProfile} from './services/session.js';

if (!getApps().length) {
  initializeApp({projectId: config.firebaseProjectId});
}

export async function verifyFirebaseToken(request) {
  const header = String(request.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new ApiError(401, 'need_sign_in');
  try {
    return await getAuth().verifyIdToken(token);
  } catch {
    throw new ApiError(401, 'need_sign_in');
  }
}

export async function loadActor(decoded) {
  const profile = await findOne('profiles', {firebase_uid: decoded.uid});
  const resolved =
    profile ||
    (await upsertProfile({
      uid: decoded.uid,
      email: decoded.email,
      displayName: decoded.name,
    }));
  const membership = await activeMembership(resolved.id);
  return {
    firebaseUid: decoded.uid,
    email: resolved.email,
    profile: resolved,
    membership,
    isSuperadmin: Boolean(resolved.is_superadmin),
  };
}

export async function actorFrom(request) {
  return loadActor(await verifyFirebaseToken(request));
}
