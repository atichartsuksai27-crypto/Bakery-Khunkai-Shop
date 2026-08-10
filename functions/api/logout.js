/**
 * Cloudflare Pages Function — POST /api/logout
 * ล้าง session cookie
 */
import { clearSessionCookie } from '../_auth.js';

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': clearSessionCookie()
    }
  });
}
