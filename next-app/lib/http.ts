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
