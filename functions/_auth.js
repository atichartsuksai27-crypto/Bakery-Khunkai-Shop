/**
 * ตัวช่วยเรื่อง session สำหรับระบบล็อกอิน (ใช้ร่วมกันระหว่าง middleware และ /api/login, /api/logout)
 * ใช้ signed cookie แบบ stateless (HMAC-SHA256) ไม่ต้องมีตาราง session ใน D1
 */

export const COOKIE_NAME = 'bk_session';
const TTL_SECONDS = 60 * 60 * 24 * 14; // เข้าระบบค้างไว้ได้ 14 วัน

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function utf8ToB64url(str) { return bytesToB64url(new TextEncoder().encode(str)); }
function b64urlToUtf8(str) { return new TextDecoder().decode(b64urlToBytes(str)); }

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToB64url(new Uint8Array(sig));
}

/** เทียบสตริงแบบเวลาคงที่ กันการเดารหัสผ่าน/ลายเซ็นด้วยการจับเวลาตอบสนอง */
export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionCookie(username, secret) {
  const payload = JSON.stringify({ u: username, exp: Date.now() + TTL_SECONDS * 1000 });
  const payloadB64 = utf8ToB64url(payload);
  const sig = await hmac(secret, payloadB64);
  const token = `${payloadB64}.${sig}`;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** อ่าน + ตรวจลายเซ็น cookie จาก request คืนค่า payload ถ้าถูกต้องและยังไม่หมดอายุ, ไม่งั้นคืน null */
export async function readSession(request, secret) {
  const cookieHeader = request.headers.get('cookie') || '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`).exec(cookieHeader);
  if (!m) return null;

  const token = decodeURIComponent(m[1]);
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;

  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let expectedSig;
  try { expectedSig = await hmac(secret, payloadB64); } catch (e) { return null; }
  if (!timingSafeEqualStr(sig, expectedSig)) return null;

  let payload;
  try { payload = JSON.parse(b64urlToUtf8(payloadB64)); } catch (e) { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;

  return payload;
}
