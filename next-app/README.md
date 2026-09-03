# Bakery Khunkai — Next.js (App Router) บน Vercel

hosting อยู่บน **Vercel** (Node.js runtime ปกติ) ส่วนข้อมูลยังอยู่ที่ **Cloudflare D1** ตัวเดิม
(`bakery-khunkai-db`) — ไม่ได้ย้ายข้อมูลไปไหน แค่ย้าย "ที่รันเว็บ" เท่านั้น

> โปรเจกต์นี้เคยรันบน Cloudflare Pages มาก่อน (ดูประวัติใน git log ถ้าอยากเทียบ) ตอนนั้นต่อ D1
> ผ่าน binding ตรง ๆ ซึ่งเป็นความสามารถเฉพาะของ Cloudflare Workers เท่านั้น ใช้บน Vercel ไม่ได้
> จึงเปลี่ยนมาต่อผ่าน **D1 HTTP API** แทน (ดูหัวข้อด้านล่าง) — เป็นการเปลี่ยนแปลงหลักของรอบนี้

## แผนที่ไฟล์ เก่า (เว็บ static เดิม) → ใหม่

| ของเดิม | ที่อยู่ใหม่ | หมายเหตุ |
|---|---|---|
| `index.html` | `app/page.tsx` + `app/layout.tsx` | JSX เดิมเป๊ะ id/class ไม่เปลี่ยน |
| `assets/css/style.css` | `app/globals.css` | เหมือนเดิมทุกบรรทัด |
| `assets/js/app.js` | `lib/legacy-engine.js` | แก้ 3 จุด (ดูหัวไฟล์) ไม่แตะ logic |
| `assets/js/data.js` | `lib/legacy-seed.js` | `window.SEED_DATA` → `export const SEED_DATA` |
| `functions/api/state.js` | `app/api/state/route.ts` | เป็น Route Handler + TypeScript |
| `seed.json` | `lib/seed.json` | import ตรง ๆ ตอน build |
| `migrations/*.sql` | `migrations/*.sql` | เหมือนเดิม — รันผ่าน wrangler CLI เป็นงาน admin เท่านั้น |
| `assets/img/logo-mark.png` | `public/img/logo-mark.png` | |
| `server.js` | ไม่ต้องมีแล้ว | ใช้ `npm run dev` แทน |

## ทำไมไม่เขียนหน้าเว็บใหม่เป็น React ทั้งหมด

`app.js` เดิมคือ logic คิดต้นทุน/ตั้งราคา/บัญชีรายวัน 1,200+ บรรทัดที่ร้านใช้งานจริงมาแล้ว
และ **ไม่มีชุดทดสอบ** — port ทีเดียวทั้งหมดแล้วคิดเงินผิดสักจุด จะไม่มีใครรู้ตัวจนกว่าจะเสียหายไปแล้ว

จึงใช้ **strangler pattern**: ครอบด้วย Next.js ก่อน (โครงสร้าง/backend/deploy เป็น Next ครบ)
แล้วค่อยย้ายทีละหน้าไปเป็น React component ทีหลัง ทีละอันเทียบผลลัพธ์กับของเดิมได้

ลำดับที่แนะนำถ้าจะย้ายต่อ — เริ่มจากหน้าที่พังแล้วเสียหายน้อยสุดไปหามากสุด:
`ข้อมูล` → `วัตถุดิบ` → `ภาพรวม` → `สูตรขนม` → `คิดรอบผลิต` → `ตั้งราคาขาย` → `บัญชีรายวัน`

---

## Backend: Route Handler เดิม (logic ไม่เปลี่ยนเลยสักบรรทัด)

`app/api/state/route.ts` ยังเป็น `GET` / `PUT` / `OPTIONS` เหมือนตอนอยู่บน Cloudflare
optimistic concurrency control + `state_conflict_log` ทำงานเหมือนเดิมทุกจุด
สิ่งเดียวที่เปลี่ยนคือ **ชั้นต่อฐานข้อมูล** (ดูหัวข้อถัดไป)

## ต่อ D1 จากนอก Cloudflare — D1 HTTP API

Cloudflare D1 ไม่มี binding ให้ใช้นอก Workers runtime แต่มี **REST API** ให้ยิงข้าม network ได้
(`POST /accounts/:account_id/d1/database/:database_id/query`) ต้องใช้ API token ที่มีสิทธิ์
**Account → D1 → Edit**

`lib/d1-http.ts` เป็นตัวห่อ fetch เรียก endpoint นี้ ทำ interface เลียนแบบ subset ของ
`D1Database` เดิม (`prepare(sql).bind(...args).first()` / `.run()`) เพื่อให้ `route.ts`
ที่ port มาจาก Cloudflare แทบไม่ต้องแก้ logic เลย แก้แค่ import

```ts
// เดิม (Cloudflare binding)
import { getRequestContext } from '@cloudflare/next-on-pages';
const db = getRequestContext().env.DB;

// ใหม่ (D1 HTTP API)
import { getD1 } from '@/lib/d1-http';
const db = getD1(); // อ่านค่าจาก env var 3 ตัว ดูหัวข้อ "ตัวแปรแวดล้อม" ด้านล่าง
```

ผลพลอยได้: ตัด dependency กับ Cloudflare Edge Runtime ออกไปทั้งหมด — ไม่ต้องมี
`export const runtime = 'edge'`, ไม่ต้องกังวลเรื่อง `fs`/`Buffer`/`node:*` ที่ใช้ไม่ได้บน edge อีกต่อไป
เพราะ Vercel รัน route นี้บน **Node.js runtime ปกติ** (ค่าเริ่มต้นของ Next.js)

ยังคง `export const dynamic = 'force-dynamic'` ไว้ — กัน Next prerender endpoint นี้เป็น static
ตอน build (ข้อมูลร้านต้องอ่านสดทุกครั้ง ไม่ใช่ cache ตอน build)

### ข้อแลกเปลี่ยนที่ควรรู้

D1 HTTP API มี latency สูงกว่า binding ตรง ๆ พอสมควร (เป็น request ข้ามเครือข่ายไปหา Cloudflare
แทนที่จะเป็น binding ในตัว isolate เดียวกัน) — สำหรับเว็บภายในร้านขนาดนี้ (query เดียว อ่าน/เขียน
JSON ก้อนเดียว) ไม่กระทบการใช้งานจริง แต่ถ้าต้องการ query ถี่ ๆ จำนวนมากในอนาคต ควรพิจารณา
ย้ายฐานข้อมูลมาอยู่ database ที่ Vercel เข้าถึงได้เร็วกว่า (Vercel Postgres, Turso ฯลฯ) แทน

---

## ตัวแปรแวดล้อมที่ต้องตั้งบน Vercel

ไปที่ **Vercel Project → Settings → Environment Variables** ใส่ 3 ตัวนี้
(เลือกทั้ง Production, Preview, Development)

| ชื่อ | ค่า | หามาจากไหน |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Account ID ของบัญชี Cloudflare | เห็นในหน้า `wrangler whoami` หรือ dashboard ด้านขวา |
| `CLOUDFLARE_D1_DATABASE_ID` | `d30092a6-7a97-4346-93c8-d918e10a6992` | ค่าเดียวกับใน `wrangler.toml` |
| `CLOUDFLARE_API_TOKEN` | API token ที่มีสิทธิ์ **Account → D1 → Edit** | สร้างที่ dash.cloudflare.com/profile/api-tokens |

ทดสอบ local ได้โดยสร้างไฟล์ `.env.local` (ถูก `.gitignore` กันไว้แล้ว ไม่มีวันหลุดขึ้น git) ใส่ 3 ตัวแปรนี้
แล้ว `npm run dev` หรือ `npm run build && npm run start` ได้ตามปกติ

---

## คำสั่งที่ใช้

```bash
npm install                 # ไม่มีปัญหา peer-deps แล้ว (ตัด @cloudflare/next-on-pages ออกไปแล้ว)
npm run dev                  # http://localhost:3000 — ต้องมี .env.local ก่อน ไม่งั้น /api/state จะตอบ 500
npm run build                # next build ปกติ ไม่มีขั้นตอนพิเศษของ Cloudflare อีกแล้ว
npm run deploy                # vercel deploy --prod (ต้อง `vercel login` หรือมี VERCEL_TOKEN ก่อน)

# คำสั่งจัดการฐานข้อมูล (admin เท่านั้น ไม่เกี่ยวกับ deploy เว็บ)
npm run db:migrate           # รัน migration บน D1 จริงผ่าน wrangler (ต้องมี CLOUDFLARE_API_TOKEN)
npm run db:migrate:local     # รัน migration บน D1 จำลอง local (ไว้ทดสอบ)
```

## Deploy ครั้งแรก

```bash
cd next-app
npx vercel link      # ผูกโฟลเดอร์นี้กับโปรเจกต์ Vercel (สร้างใหม่หรือเลือกโปรเจกต์เดิม)
npx vercel env add CLOUDFLARE_ACCOUNT_ID production
npx vercel env add CLOUDFLARE_D1_DATABASE_ID production
npx vercel env add CLOUDFLARE_API_TOKEN production
# ทำซ้ำอีกรอบสำหรับ preview/development ถ้าต้องการทดสอบบน preview URL ด้วย
npx vercel deploy --prod
```

ถ้าต้องการให้ push เข้า GitHub แล้ว deploy อัตโนมัติ (เหมือนที่เคยตั้งไว้บน Cloudflare Pages)
ให้เชื่อม Git ที่ **Vercel Project → Settings → Git** แทน — Root Directory ตั้งเป็น `next-app`
