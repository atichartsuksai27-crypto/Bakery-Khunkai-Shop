-- Bakery Khunkai — ตารางเดียว เก็บทั้งระบบ (วัตถุดิบ + สูตร + ตัวคูณ) เป็น JSON ก้อนเดียว
-- เลือกออกแบบแบบนี้เพราะข้อมูลถูกแก้ทั้งชุดจากหน้าเว็บอยู่แล้ว (เหมือน localStorage เดิม
-- แต่ย้ายมาไว้กลางที่เดียว ให้ทุกเครื่อง/ทุกคนในร้านเห็นข้อมูลเดียวกันแบบเรียลไทม์)
CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
