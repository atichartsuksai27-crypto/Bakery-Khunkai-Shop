# Bakery Khunkai — Next.js (App Router) บน Cloudflare

ย้ายเว็บเดิม (static HTML + Cloudflare Pages Functions) มารวมเป็นโปรเจกต์ Next.js เดียว
ยังใช้ฐานข้อมูล D1 ตัวเดิม (`bakery-khunkai-db`) และ endpoint เดิม `/api/state` — ข้อมูลไม่ต้องย้าย

## แผนที่ไฟล์ เก่า → ใหม่

| ของเดิม | ที่อยู่ใหม่ | หมายเหตุ |
|---|---|---|
| `index.html` | `app/page.tsx` + `app/layout.tsx` | JSX เดิมเป๊ะ id/class ไม่เปลี่ยน |
| `assets/css/style.css` | `app/globals.css` | เหมือนเดิมทุกบรรทัด |
| `assets/js/app.js` | `lib/legacy-engine.js` | แก้ 3 จุด (ดูหัวไฟล์) ไม่แตะ logic |
| `assets/js/data.js` | `lib/legacy-seed.js` | `window.SEED_DATA` → `export const SEED_DATA` |
| `functions/api/state.js` | `app/api/state/route.ts` | เป็น Route Handler + TypeScript |
| `seed.json` | `lib/seed.json` | import ตรง ๆ ตอน build |
| `migrations/*.sql` | `migrations/*.sql` | เหมือนเดิม |
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

## Backend: Pages Functions → Route Handlers

สิ่งที่เปลี่ยนจริง ๆ มี 4 อย่าง (logic ธุรกิจไม่เปลี่ยนเลยสักบรรทัด)

**1. ชื่อฟังก์ชันที่ export**

```js
// เดิม — functions/api/state.js
export async function onRequestGet(ctx) { ... }
export async function onRequestPut(ctx) { ... }
export async function onRequestOptions() { ... }
```
```ts
// ใหม่ — app/api/state/route.ts
export async function GET() { ... }
export async function PUT(request: Request) { ... }
export async function OPTIONS() { ... }
```

**2. การเข้าถึง D1 binding** — จุดที่ต่างมากที่สุด

Pages Functions ส่ง binding มาให้ทาง argument แต่ Route Handler ไม่มี `ctx` ให้
ต้องดึงจาก async context ของ request แทน

```js
// เดิม
const db = ctx.env.DB;
```
```ts
// ใหม่ — lib/cloudflare.ts
import { getRequestContext } from '@cloudflare/next-on-pages';
const db = getRequestContext().env.DB;
```

> `getRequestContext()` ใช้ได้เฉพาะ **ตอนมี request จริงอยู่** และ **บน Edge Runtime** เท่านั้น
> เรียกตอน build, ที่ module top-level, หรือในหน้าที่ถูก prerender เป็น static → throw ทันที

**3. ต้องประกาศ runtime กำกับทุก route**

```ts
export const runtime = 'edge';          // next-on-pages รองรับแค่ edge
export const dynamic = 'force-dynamic'; // กัน Next prerender route นี้ตอน build
```

ถ้าลืม `runtime = 'edge'` → build จะ fail (`next-on-pages` ไม่ยอมให้มี Node.js serverless function)
ถ้าลืม `force-dynamic` → `getRequestContext()` จะ throw ตอน build เพราะยังไม่มี request

**4. อ่าน request/response ตาม Web API มาตรฐาน** — อันนี้ของเดิมทำถูกอยู่แล้ว
(`request.json()`, `request.headers.get()`, `new Response(...)`) ก็อปมาใช้ได้เลยไม่ต้องแก้

---

## ปรับโค้ดให้รองรับ Cloudflare Edge Runtime

Edge Runtime ไม่ใช่ Node.js — มันคือ V8 isolate ที่มีแค่ Web API มาตรฐาน
ไลบรารีที่แตะ Node built-in จะพังตอน runtime บน production ทั้งที่ `next dev` บนเครื่องผ่านสบาย

### ที่ใช้ไม่ได้ และใช้อะไรแทน

| ใช้ไม่ได้บน Edge | ใช้แทนด้วย |
|---|---|
| `fs`, `path` (อ่านไฟล์ตอน runtime) | `import data from './x.json'` ให้ webpack ฝังตอน build |
| `crypto` ของ Node (`createHmac`, `randomBytes`) | Web Crypto: `crypto.subtle`, `crypto.randomUUID()` |
| `Buffer` | `TextEncoder` / `TextDecoder` / `atob` / `btoa` / `Uint8Array` |
| `process.env` แบบอ่านตอน runtime | `getRequestContext().env` (binding & secret ของ Cloudflare) |
| `net`, `tls`, `dns`, `child_process` | ไม่มีทางแทน — ต้องเปลี่ยนไลบรารี |
| `sharp` (next/image optimizer) | `images: { unoptimized: true }` แล้วใช้ `<img>` |
| ORM ที่ต่อ TCP (Prisma แบบปกติ, `pg`, `mysql2`) | D1 binding ตรง ๆ, หรือ Drizzle ORM (รองรับ D1), หรือ Prisma + Accelerate |
| `setTimeout` ยาว ๆ / งานเบื้องหลังหลังตอบ response | `ctx.waitUntil()` |
| ISR / on-demand revalidation | ไม่รองรับบน next-on-pages — ใช้ `force-dynamic` + Cache API |

### สิ่งที่ทำไว้แล้วในโปรเจกต์นี้

- `compatibility_flags = ["nodejs_compat"]` ใน `wrangler.toml` — **จำเป็น** ไม่งั้น Next จะ error
  ว่า `Cannot resolve node:...` ตอน runtime (build ผ่านแต่เว็บพัง)
- `next.config.mjs` ตั้ง `resolve.fallback` ปิด `fs`/`net`/`tls` เฉพาะ edge bundle
  → ถ้าเผลอ import อะไรที่ต้องใช้ Node API จะ **พังตอน build** แทนที่จะไปพังตอน production
- `images: { unoptimized: true }` — optimizer ในตัวของ Next ต้องพึ่ง `sharp` ซึ่งรันบน Cloudflare ไม่ได้
- `seed.json` import ตรง ๆ ไม่ได้อ่านด้วย `fs` ตอน runtime
- `lib/legacy-engine.js` ถูก **dynamic import ใน `useEffect`** เท่านั้น เพราะมันแตะ `document`
  ตั้งแต่บรรทัดแรก ถ้า import แบบ static ไว้บนหัวไฟล์ Next จะ evaluate ตอน SSR แล้วพังตอน build

### เช็คก่อน deploy ทุกครั้ง

```bash
npm run pages:build   # ถ้ามี Node API ที่ใช้ไม่ได้ จะ fail ตรงนี้ ไม่ใช่ตอนขึ้น production
```

`next build` ผ่านไม่ได้แปลว่ารันบน Cloudflare ได้ — ต้องผ่าน `pages:build` ด้วยเสมอ

---

## คำสั่งที่ใช้

```bash
npm install                 # ต้องมี .npmrc (legacy-peer-deps) ติดมาด้วย
npm run db:migrate:local    # สร้างตารางใน D1 ตัว local
npm run dev                 # http://localhost:3000 — มี D1 local ให้ใช้ผ่าน setupDevPlatform()
npm run pages:build         # build สำหรับ Cloudflare (ตรวจ Edge compat)
npm run preview             # รันของจริงที่ build แล้วบน workerd + D1 local
npm run deploy              # ขึ้น Cloudflare Pages (ต้องมี CLOUDFLARE_API_TOKEN)
```

## ต้องเปลี่ยนตั้งค่าใน Cloudflare Pages dashboard ก่อนใช้จริง

โปรเจกต์ Pages ปัจจุบันตั้งเป็นเว็บ static (ไม่มี build command, output = `.`)
ถ้าจะใช้ตัวนี้ต้องไปแก้ที่ **Settings → Builds & deployments**

| ช่อง | ค่าที่ต้องใส่ |
|---|---|
| Root directory | `next-app` |
| Build command | `npm run pages:build` |
| Build output directory | `.vercel/output/static` |
| Compatibility flags | `nodejs_compat` (ทั้ง Production และ Preview) |
| D1 binding | `DB` → `bakery-khunkai-db` (ทั้ง Production และ Preview) |

> ⚠️ Compatibility flag กับ D1 binding ต้องตั้ง **แยกกันทั้งสองสภาพแวดล้อม**
> ตั้งแค่ Production แล้ว preview deployment จะพังโดยไม่มีสาเหตุที่ชัดเจน

## หมายเหตุเรื่อง adapter

`@cloudflare/next-on-pages` ถูก Cloudflare ประกาศ deprecated แล้ว (ยังใช้ได้ปกติ แต่หยุดพัฒนา)
ของใหม่คือ **`@opennextjs/cloudflare`** ซึ่ง deploy ขึ้น Workers และรันบน **Node.js runtime**
จึงไม่ติดข้อจำกัด Edge ทั้งตารางข้างบน (ใช้ `fs`, `Buffer`, ORM ปกติได้)

ถ้าจะย้ายไป OpenNext แก้แค่ 3 จุด:

1. `npm i -D @opennextjs/cloudflare` แล้วลบ `@cloudflare/next-on-pages`
2. `lib/cloudflare.ts` เปลี่ยน import
   ```ts
   import { getCloudflareContext } from '@opennextjs/cloudflare';
   const db = (await getCloudflareContext({ async: true })).env.DB;
   ```
3. ลบ `export const runtime = 'edge'` ออกจาก `app/api/state/route.ts` (ไม่ต้องใช้แล้ว)

โปรเจกต์นี้เลือก next-on-pages ไว้ก่อนเพราะยังอยู่บน Pages เดิมและ D1 binding เดิมใช้ต่อได้ทันที
