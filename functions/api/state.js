/**
 * Cloudflare Pages Function — /api/state
 * แหล่งข้อมูลกลางเดียวสำหรับทั้งร้าน (Cloudflare D1)
 * GET  -> คืนข้อมูลปัจจุบัน (ถ้ายังไม่มีแถวในฐานข้อมูล จะ seed ให้อัตโนมัติจากค่าตั้งต้น)
 * PUT  -> บันทึกข้อมูลทั้งชุด (ingredients + recipes + multipliers)
 */
import SEED from '../../seed.json';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // กันไฟล์ผิดปกติขนาดใหญ่เกินไป

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function readRow(db) {
  return db.prepare('SELECT data, updated_at FROM app_state WHERE id = 1').first();
}

async function seedIfEmpty(db) {
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    ingredients: SEED.ingredients,
    recipes: SEED.recipes,
    multipliers: SEED.multipliers
  });
  await db
    .prepare(
      `INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .bind(payload, now)
    .run();
  return { data: payload, updated_at: now };
}

export async function onRequestGet(ctx) {
  const db = ctx.env.DB;
  if (!db) return json({ error: 'ยังไม่ได้ผูกฐานข้อมูล D1 (binding "DB") กับโปรเจกต์นี้' }, 500);

  let row = await readRow(db);
  if (!row) row = await seedIfEmpty(db);

  const data = JSON.parse(row.data);
  data.updatedAt = row.updated_at;
  return json(data);
}

export async function onRequestPut(ctx) {
  const db = ctx.env.DB;
  if (!db) return json({ error: 'ยังไม่ได้ผูกฐานข้อมูล D1 (binding "DB") กับโปรเจกต์นี้' }, 500);

  const len = Number(ctx.request.headers.get('content-length') || 0);
  if (len && len > MAX_BODY_BYTES) return json({ error: 'ข้อมูลใหญ่เกินไป' }, 413);

  let body;
  try {
    body = await ctx.request.json();
  } catch (e) {
    return json({ error: 'ข้อมูลไม่ใช่ JSON ที่ถูกต้อง' }, 400);
  }

  if (!body || !Array.isArray(body.ingredients) || !Array.isArray(body.recipes)) {
    return json({ error: 'โครงสร้างข้อมูลไม่ถูกต้อง (ต้องมี ingredients และ recipes)' }, 400);
  }

  const now = new Date().toISOString();
  const payload = JSON.stringify({
    ingredients: body.ingredients,
    recipes: body.recipes,
    multipliers: Array.isArray(body.multipliers) ? body.multipliers : SEED.multipliers
  });

  await db
    .prepare(
      `INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .bind(payload, now)
    .run();

  return json({ ok: true, updatedAt: now });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { allow: 'GET, PUT, OPTIONS' }
  });
}
