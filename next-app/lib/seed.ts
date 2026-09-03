/**
 * ข้อมูลตั้งต้น — import JSON ตรง ๆ ได้ (webpack ฝังค่าให้ตอน build) ปลอดภัยบน Edge Runtime
 * เพราะไม่มีการอ่านไฟล์ตอน runtime เลย ต่างจากของเดิมที่ Pages Functions ก็ทำแบบเดียวกัน
 *
 * ห้ามเปลี่ยนไปใช้ fs.readFileSync('seed.json') เด็ดขาด — โมดูล fs ไม่มีอยู่บน Edge Runtime
 */
import seedJson from './seed.json';
import type { AppState } from './types';

export const SEED = seedJson as unknown as AppState & { version: number };

export const DEFAULT_LEDGER = { openingBalance: 0, monthlyOpenings: {}, entries: [] };
