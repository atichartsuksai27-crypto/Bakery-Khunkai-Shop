/**
 * ตัวเชื่อม D1 แบบ HTTP — ใช้แทน binding ของ Cloudflare Workers ตอนรันบน Vercel
 *
 * บน Cloudflare Pages, D1 ผูกเข้ามาตรง ๆ ผ่าน binding (`getRequestContext().env.DB`)
 * ซึ่งเป็นความสามารถเฉพาะของ Cloudflare Workers runtime เท่านั้น — ใช้บน Vercel ไม่ได้
 * ที่นี่จึงยิง REST API ของ Cloudflare ข้ามระบบแทน (D1 HTTP Query API) โดยใช้ API token
 * (ต้องมีสิทธิ์ Account > D1 > Edit) แทน binding
 *
 * คลาสนี้จำลอง subset ของ D1Database ที่ route.ts ใช้จริง (prepare/bind/first/run)
 * เพื่อให้ route.ts ที่ port มาจาก Cloudflare Pages Functions ไม่ต้องแก้ logic เลยสักบรรทัด
 * แก้แค่ชั้น "ต่อฐานข้อมูลยังไง" เท่านั้น
 */

interface CloudflareD1QueryResponse<T> {
  result: Array<{
    results: T[];
    success: boolean;
    meta: { changes?: number; last_row_id?: number; rows_read?: number; rows_written?: number };
  }>;
  success: boolean;
  errors: Array<{ code: number; message: string }>;
}

class D1HttpStatement {
  private params: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly accountId: string,
    private readonly databaseId: string,
    private readonly apiToken: string
  ) {}

  bind(...params: unknown[]): this {
    this.params = params;
    return this;
  }

  private async exec<T>(): Promise<CloudflareD1QueryResponse<T>['result'][number]> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ sql: this.sql, params: this.params })
      }
    );

    const body = (await res.json()) as CloudflareD1QueryResponse<T>;
    if (!res.ok || !body.success) {
      const msg = body.errors?.map((e) => e.message).join('; ') || `D1 HTTP API error (status ${res.status})`;
      throw new Error(msg);
    }
    return body.result[0];
  }

  async first<T = unknown>(): Promise<T | null> {
    const { results } = await this.exec<T>();
    return results[0] ?? null;
  }

  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    const { success, meta } = await this.exec();
    return { success, meta: { changes: meta.changes ?? 0 } };
  }
}

export class D1HttpDatabase {
  constructor(
    private readonly accountId: string,
    private readonly databaseId: string,
    private readonly apiToken: string
  ) {}

  prepare(sql: string): D1HttpStatement {
    return new D1HttpStatement(sql, this.accountId, this.databaseId, this.apiToken);
  }
}

/** อ่านค่าตั้งค่าจาก environment variables — ตั้งไว้ที่ Vercel Project Settings → Environment Variables */
export function getD1(): D1HttpDatabase | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) return null;
  return new D1HttpDatabase(accountId, databaseId, apiToken);
}
