/** โครงสร้างข้อมูลที่เก็บเป็น JSON ก้อนเดียวในตาราง app_state (D1) */

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  pack: number;
  price: number;
  note?: string;
  category?: string;
}

export interface RecipeItem {
  ingredientId: string;
  qty: number;
  include: boolean;
}

export interface Recipe {
  id: string;
  name: string;
  category?: string;
  baseLabel?: string;
  basePieces: number;
  note?: string;
  sellPrice?: number;
  items: RecipeItem[];
}

export interface LedgerEntry {
  id: string;
  date: string;
  type: 'income' | 'expense';
  category: string;
  desc: string;
  amount: number;
}

export interface Ledger {
  /** ยอดยกมาของ "เดือนแรกสุดที่มีข้อมูล" — ค่าตั้งต้นก่อนเริ่มใช้ระบบ (ของเดิม เก็บไว้เหมือนเดิม) */
  openingBalance: number;
  /**
   * ยอดยกมาที่ผู้ใช้ "ปิดรอบ" กำหนดไว้เองรายเดือน — key เป็น 'YYYY-MM'
   * มีค่าเมื่อไร ให้ถือว่าเป็นยอดตั้งต้นของเดือนนั้นทันที ไม่ต้องคำนวณย้อนจากเดือนก่อนอีก
   */
  monthlyOpenings?: Record<string, number>;
  entries: LedgerEntry[];
}

export interface AppState {
  ingredients: Ingredient[];
  recipes: Recipe[];
  multipliers: number[];
  ledger: Ledger;
  /** ใส่ให้ตอนอ่านออกจาก D1 เท่านั้น ไม่ได้เก็บอยู่ใน JSON */
  updatedAt?: string;
  stateVersion?: number;
}

/** แถวดิบจากตาราง app_state */
export interface AppStateRow {
  data: string;
  updated_at: string;
  version: number;
}
