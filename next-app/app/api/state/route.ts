/**
 * Next.js Route Handler — /api/state  (แปลงมาจาก functions/api/state.js เดิม)
 *
 * GET  -> คืนข้อมูลปัจจุบันพร้อม stateVersion (ถ้ายังไม่มีแถวในฐานข้อมูล จะ seed ให้อัตโนมัติจากค่าตั้งต้น)
 * PUT  -> บันทึกข้อมูลทั้งชุด (ingredients + recipes + multipliers + ledger)
 *         ต้องส่ง stateVersion ที่ตัวเองถืออยู่มาด้วยเสมอ (optimistic concurrency control):
 *         ถ้าไม่ตรงกับ version ล่าสุดใน D1 แล้ว (แปลว่ามีเครื่อง/แท็บอื่นบันทึกไปก่อนหน้านี้
 *         ระหว่างที่เรากำลังแก้ไข) จะถูกปฏิเสธด้วย 409 พร้อมข้อมูลชุดล่าสุดกลับไปให้ทันที
 *         ไม่มีการเขียนทับข้อมูลของคนอื่นแบบเงียบ ๆ เด็ดขาด — และสำเนาข้อมูลที่ถูกปฏิเสธจะถูกเก็บไว้ใน
 *         state_conflict_log เสมอ (ดู migrations/0003) เป็นเซฟตี้เน็ตชั้นสุดท้าย กู้คืนย้อนหลังได้เสมอ
 *
 * หมายเหตุชื่อ field: ตั้งใจใช้ "stateVersion" (ไม่ใช้ "version" เฉย ๆ) เพราะ seed.json/ข้อมูลตั้งต้น
 * มี field "version" อยู่แล้วเดิม (เลขรุ่นของ "รูปแบบข้อมูลตั้งต้น" ไม่เกี่ยวกับ D1 เลย) ถ้าใช้ชื่อชนกัน
 * ตอนที่ client ยังไม่เคย sync กับเซิร์ฟเวอร์เลยสักครั้ง (fallback เป็น seed data) จะเผลออ่านเจอ
 * SEED.version=1 แล้วเข้าใจผิดว่าเป็น D1 version จริง ทำให้ PUT ทับข้อมูลโดยไม่เช็คของจริงเลย
 */
import { getD1, D1HttpDatabase } from '@/lib/d1-http';
import { json } from '@/lib/http';
import { SEED, DEFAULT_LEDGER } from '@/lib/seed';
import type { AppState, AppStateRow, Ledger } from '@/lib/types';

// กัน Next ไป prerender route นี้เป็น static ตอน build — ข้อมูลนี้ต้องสดเสมอ ห้าม cache
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // กันไฟล์ผิดปกติขนาดใหญ่เกินไป

function normalizeLedger(ledger: unknown): Ledger {
  const l = ledger as Ledger | undefined;
  if (!l || typeof l !== 'object' || !Array.isArray(l.entries)) return DEFAULT_LEDGER as Ledger;
  return {
    openingBalance: typeof l.openingBalance === 'number' ? l.openingBalance : 0,
    entries: l.entries
  };
}

async function readRow(db: D1HttpDatabase): Promise<AppStateRow | null> {
  return db
    .prepare('SELECT data, updated_at, version FROM app_state WHERE id = 1')
    .first<AppStateRow>();
}

function rowToPayload(row: AppStateRow): AppState {
  const data = JSON.parse(row.data) as AppState;
  data.updatedAt = row.updated_at;
  data.stateVersion = row.version;
  return data;
}

async function seedIfEmpty(db: D1HttpDatabase): Promise<AppStateRow | null> {
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    ingredients: SEED.ingredients,
    recipes: SEED.recipes,
    multipliers: SEED.multipliers,
    ledger: normalizeLedger(SEED.ledger)
  });
  await db
    .prepare(
      `INSERT INTO app_state (id, data, updated_at, version) VALUES (1, ?, ?, 1)
       ON CONFLICT(id) DO NOTHING`
    )
    .bind(payload, now)
    .run();
  return readRow(db);
}

export async function GET() {
  const db = getD1();
  if (!db) {
    return json(
      { error: 'ยังไม่ได้ตั้งค่าตัวแปรแวดล้อมสำหรับต่อ D1 (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN)' },
      500
    );
  }

  let row = await readRow(db);
  if (!row) row = await seedIfEmpty(db);
  if (!row) return json({ error: 'ไม่สามารถเตรียมข้อมูลเริ่มต้นได้' }, 500);

  return json(rowToPayload(row));
}

export async function PUT(request: Request) {
  const db = getD1();
  if (!db) {
    return json(
      { error: 'ยังไม่ได้ตั้งค่าตัวแปรแวดล้อมสำหรับต่อ D1 (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN)' },
      500
    );
  }

  const len = Number(request.headers.get('content-length') || 0);
  if (len && len > MAX_BODY_BYTES) return json({ error: 'ข้อมูลใหญ่เกินไป' }, 413);

  let body: AppState;
  try {
    body = (await request.json()) as AppState;
  } catch {
    return json({ error: 'ข้อมูลไม่ใช่ JSON ที่ถูกต้อง' }, 400);
  }

  if (!body || !Array.isArray(body.ingredients) || !Array.isArray(body.recipes)) {
    return json({ error: 'โครงสร้างข้อมูลไม่ถูกต้อง (ต้องมี ingredients และ recipes)' }, 400);
  }

  const clientVersion = Number(body.stateVersion);
  if (!Number.isInteger(clientVersion) || clientVersion < 1) {
    return json({ error: 'ไม่พบเวอร์ชันข้อมูลที่ส่งมา กรุณาโหลดหน้าเว็บใหม่แล้วลองอีกครั้ง' }, 400);
  }

  const now = new Date().toISOString();
  const payload = JSON.stringify({
    ingredients: body.ingredients,
    recipes: body.recipes,
    multipliers: Array.isArray(body.multipliers) ? body.multipliers : SEED.multipliers,
    ledger: normalizeLedger(body.ledger)
  });

  // เขียนทับได้ก็ต่อเมื่อ stateVersion ที่ client ถืออยู่ตรงกับ version ล่าสุดใน D1 เท่านั้น (optimistic lock)
  const result = await db
    .prepare(
      `UPDATE app_state SET data = ?, updated_at = ?, version = version + 1
       WHERE id = 1 AND version = ?`
    )
    .bind(payload, now, clientVersion)
    .run();

  const changed = result?.meta?.changes;
  if (!changed) {
    const current = await readRow(db);
    if (!current) {
      // แถวหายไปเฉย ๆ (ไม่ควรเกิดขึ้น เพราะ GET จะ seed ให้ก่อนเสมอ) -> seed ใหม่แล้วให้ client ลองอีกครั้ง
      await seedIfEmpty(db);
      return json({ error: 'ยังไม่มีข้อมูลในระบบ กรุณาโหลดหน้าเว็บใหม่แล้วลองอีกครั้ง' }, 409);
    }
    // stateVersion ไม่ตรง = มีคนอื่นบันทึกไปก่อนแล้วระหว่างที่เรากำลังแก้ไข -> ปฏิเสธ ไม่เขียนทับ
    // เซฟตี้เน็ตเพิ่มอีกชั้น: เก็บสำเนาข้อมูลที่ถูกปฏิเสธนี้ไว้เสมอ เผื่อฝั่ง client มีบั๊กที่ไม่เคยคาดคิดมาก่อน
    // จนผู้ใช้ไม่เห็นการแจ้งเตือนแล้วปิดแท็บไปเฉย ๆ ก็จะยังกู้คืนได้จากตารางนี้ ไม่มีวันหายไปจากระบบเลย
    await db
      .prepare(
        `INSERT INTO state_conflict_log (attempted_at, attempted_version, actual_version, rejected_data)
         VALUES (?, ?, ?, ?)`
      )
      .bind(now, clientVersion, current.version, payload)
      .run()
      .catch(() => {}); // การ log ล้มเหลวต้องไม่ทำให้ผู้ใช้เห็น error ผิดจุด (ตัว conflict หลักสำคัญกว่า)

    return json(
      {
        error:
          'มีการเปลี่ยนแปลงข้อมูลจากเครื่องอื่นระหว่างที่คุณกำลังแก้ไข ระบบไม่ได้บันทึกทับให้เพื่อป้องกันข้อมูลหาย',
        conflict: true,
        current: rowToPayload(current)
      },
      409
    );
  }

  const row = await readRow(db);
  return json({ ok: true, updatedAt: row?.updated_at, stateVersion: row?.version });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: 'GET, PUT, OPTIONS' } });
}
