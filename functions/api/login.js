/**
 * Cloudflare Pages Function — POST /api/login
 * ตรวจ username/password กับค่าที่ตั้งไว้เป็น secret บน Cloudflare (ไม่ได้เก็บในโค้ด/GitHub)
 * ผ่าน -> ออก signed session cookie
 */
import { createSessionCookie, timingSafeEqualStr } from '../_auth.js';

export async function onRequestPost(ctx) {
  const { request, env } = ctx;

  if (!env.AUTH_USERNAME || !env.AUTH_PASSWORD || !env.SESSION_SECRET) {
    return json({ error: 'ระบบล็อกอินยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์ (ขาด secret)' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, 400);
  }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  // .trim() ฝั่ง env กันปัญหา secret มีช่องว่าง/ขึ้นบรรทัดใหม่ติดมาตอนตั้งค่าโดยไม่ได้ตั้งใจ
  const ok =
    timingSafeEqualStr(username, String(env.AUTH_USERNAME).trim()) &&
    timingSafeEqualStr(password, String(env.AUTH_PASSWORD).trim());

  if (!ok) {
    // หน่วงเวลาเล็กน้อยกันสคริปต์ยิงสุ่มรหัสผ่านรัว ๆ
    await new Promise((resolve) => setTimeout(resolve, 400));
    return json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401);
  }

  const cookie = await createSessionCookie(username, env.SESSION_SECRET);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': cookie
    }
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
