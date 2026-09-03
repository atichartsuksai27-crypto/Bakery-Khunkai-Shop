/**
 * ตัวช่วยดึง binding ของ Cloudflare (D1) เข้ามาใช้ใน Route Handler
 *
 * ของเดิม (Pages Functions) binding มาทาง argument: `ctx.env.DB`
 * บน Next.js ไม่มี ctx ให้ ต้องดึงจาก async context ของ request แทนผ่าน getRequestContext()
 *
 * ข้อกำหนดสำคัญ: getRequestContext() ใช้ได้เฉพาะโค้ดที่รันบน Edge Runtime และ "ระหว่างมี request อยู่"
 * เท่านั้น — เรียกตอน build / ตอน module top-level / ในหน้าที่ถูก prerender เป็น static จะ throw
 * ทุก route ที่เรียกฟังก์ชันนี้จึงต้องประกาศ `export const runtime = 'edge'` และ
 * `export const dynamic = 'force-dynamic'` เสมอ
 */
import { getRequestContext } from '@cloudflare/next-on-pages';

export function getDB(): D1Database | null {
  try {
    const db = getRequestContext().env.DB;
    return db ?? null;
  } catch {
    // ไม่ได้อยู่ใน Cloudflare runtime (เช่น รัน `next dev` โดยไม่ได้ตั้ง setupDevPlatform)
    return null;
  }
}

/** ตอบ JSON พร้อม no-store — ข้อมูลร้านต้องสดเสมอ ห้ามให้ CDN/เบราว์เซอร์แคช */
export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
