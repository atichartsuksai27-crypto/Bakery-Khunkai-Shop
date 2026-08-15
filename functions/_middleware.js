/**
 * Cloudflare Pages middleware — ตรวจ session ก่อนเข้าเว็บ/เรียก API ทุกครั้ง
 * เส้นทางที่ไม่ถูกคุ้มกัน: /login.html, /api/login, /api/logout, ไฟล์ static ใน /assets
 * (assets ไม่มีข้อมูลร้านอยู่ในนั้น เป็นแค่ css/js/โลโก้ ที่หน้า login เองก็ต้องใช้)
 */
import { readSession } from './_auth.js';

const PROTECTED_EXACT = new Set(['/', '/index.html']);
const PROTECTED_PREFIX = ['/api/state', '/api/verify-code'];

export async function onRequest(ctx) {
  const { request, env, next } = ctx;
  const url = new URL(request.url);
  const path = url.pathname;

  const isProtected = PROTECTED_EXACT.has(path) || PROTECTED_PREFIX.some((p) => path.startsWith(p));
  if (!isProtected) return next();

  if (!env.SESSION_SECRET) {
    return new Response('ระบบล็อกอินยังไม่ได้ตั้งค่า SESSION_SECRET บนเซิร์ฟเวอร์', { status: 500 });
  }

  const session = await readSession(request, env.SESSION_SECRET);
  if (session) return next();

  if (path.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  const redirect = new URL('/login.html', url);
  redirect.searchParams.set('next', path);
  return Response.redirect(redirect.toString(), 302);
}
