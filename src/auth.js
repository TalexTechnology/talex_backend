import {cert, initializeApp, getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {config} from './config.js';
import {ApiError} from './http.js';
import {queryOne} from './db.js';
import {upsertProfile} from './services/session.js';

function firebaseOptions() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    return {
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id || config.firebaseProjectId,
    };
  }
  return {projectId: config.firebaseProjectId};
}

if (!getApps().length) {
  initializeApp(firebaseOptions());
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
  const profile = await queryOne(
    `SELECT id, firebase_uid, email, display_name, is_superadmin, is_active,
            must_change_password, must_review_company_dna, document_number
     FROM profiles
     WHERE firebase_uid = :uid
     LIMIT 1`,
    {uid: decoded.uid},
  );
  const resolved =
    profile ||
    (await upsertProfile({
      uid: decoded.uid,
      email: decoded.email,
      displayName: decoded.name,
    }));
  const membership = await queryOne(
    `SELECT m.organization_id, m.role, m.legacy_role, o.name AS organization_name,
            o.firebase_id AS organization_firebase_id
     FROM memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.profile_id = :profileId AND m.is_active = 1
     ORDER BY m.created_at ASC
     LIMIT 1`,
    {profileId: resolved.id},
  );
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
