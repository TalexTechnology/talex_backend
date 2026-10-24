import {createHash, randomBytes} from 'node:crypto';

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value || '').trim(), 'utf8').digest('hex');
}

export function fnv1a32Hex(value) {
  const bytes = Buffer.from(String(value), 'utf8');
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function hashInvitePin(pin, email) {
  return fnv1a32Hex(`${normalizeEmail(email)}|${String(pin).trim()}`);
}

export function verifyInvitePin(pin, email, storedHash) {
  if (!storedHash) return false;
  return hashInvitePin(pin, email) === String(storedHash).trim();
}

export function randomToken() {
  return randomBytes(32).toString('base64url');
}

export function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}
