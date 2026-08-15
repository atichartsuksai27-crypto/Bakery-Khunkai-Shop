/**
 * Cloudflare Pages Function — POST /api/verify-code
 * ใช้สำหรับ "ยืนยันตัวตนซ้ำ" ก่อนเข้าหน้าที่อ่อนไหว (บัญชีรายวัน)
 * ตรวจกับ credential ชุดเดียวกับ /api/login แต่ "ไม่ตั้ง cookie ใด ๆ ทั้งสิ้น"
 * เพื่อบังคับให้กรอกรหัสใหม่ทุกครั้งตามที่ผู้ใช้กำหนด — endpoint นี้เอง
 * ก็ถูกคุ้มกันด้วย middleware อยู่แล้ว (ต้องมี session หลักที่ล็อกอินไว้ก่อน)
 */
import { timingSafeEqualStr } from '../_auth.js';

export async function onRequestPost(ctx) {
  const { request, env } = ctx;

  if (!env.AUTH_USERNAME || !env.AUTH_PASSWORD) {
    return json({ error: 'ระบบยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, 400);
  }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  const ok =
    timingSafeEqualStr(username, String(env.AUTH_USERNAME).trim()) &&
    timingSafeEqualStr(password, String(env.AUTH_PASSWORD).trim());

  if (!ok) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return json({ error: 'รหัสพนักงานไม่ถูกต้อง' }, 401);
  }

  return json({ ok: true });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
