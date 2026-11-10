import { createHash, timingSafeEqual } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const bad = (m) => new ApiError(400, 'bad_request', m);
export const forbidden = (m = 'You do not have access to do that.') => new ApiError(403, 'forbidden', m);
export const missing = (m = 'Not found.') => new ApiError(404, 'not_found', m);
export const conflict = (code, m) => new ApiError(409, code, m);

export const sha256hex = (data) => createHash('sha256').update(data).digest('hex');
/** Same input always gives the same row id (lowercase letters and digits, 35 characters). */
export const rowId = (...parts) => sha256hex(parts.join('|')).slice(0, 35);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;
export function idOf(v, name) {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw bad(`Invalid ${name}.`);
  return v;
}
export function intIn(v, name, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
}
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
export const money = (cents) => '$' + (cents / 100).toFixed(2);

/** Text for the person: never a raw provider message, never a secret. */
export function publicError(e, fallback) {
  if (e instanceof ApiError) return e;
  return new ApiError(502, 'provider_error', fallback || 'The printing service did not answer correctly. Please try again later.');
}
