'use client';

import { useEffect } from 'react';

/**
 * ตัวสั่งเดิน engine เดิม (lib/legacy-engine.js) หลัง React วาด DOM เสร็จแล้ว
 *
 * ทำไมต้อง dynamic import ข้างใน useEffect:
 *   engine แตะ document.getElementById(...) ตั้งแต่บรรทัดแรกที่รัน ถ้า import แบบ static
 *   ไว้บนหัวไฟล์ Next จะพยายาม evaluate โมดูลนี้ตอนทำ SSR/prerender บนเซิร์ฟเวอร์ด้วย
 *   ซึ่งไม่มี document ให้ -> พังทันทีตอน build
 */
export default function LegacyApp() {
  useEffect(() => {
    let teardown: (() => void) | undefined;
    let cancelled = false;

    import('@/lib/legacy-engine').then(({ bootLegacyApp }) => {
      if (cancelled) return;
      teardown = bootLegacyApp();
    });

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);

  return null;
}
