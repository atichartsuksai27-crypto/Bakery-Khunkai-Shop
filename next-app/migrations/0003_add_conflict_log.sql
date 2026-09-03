-- เซฟตี้เน็ตอีกชั้น: ทุกครั้งที่ระบบปฏิเสธการบันทึกเพราะ version ชนกัน (optimistic concurrency
-- conflict — ดู migrations/0002) ให้เก็บสำเนาข้อมูลที่ "พยายามจะบันทึกแต่ไม่สำเร็จ" ไว้ในตารางนี้เสมอ
-- แม้ฝั่ง client จะมีบั๊กที่ไม่เคยคาดคิดมาก่อนจนทำให้ผู้ใช้ไม่เห็นการแจ้งเตือนและปิดแท็บไปเฉย ๆ
-- ข้อมูลที่พยายามบันทึกไปก็จะยังไม่หายไปจากระบบเลย กู้คืนย้อนหลังได้เสมอด้วยการ query ตารางนี้ตรง ๆ
CREATE TABLE IF NOT EXISTS state_conflict_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempted_at TEXT NOT NULL,
  attempted_version INTEGER NOT NULL,
  actual_version INTEGER NOT NULL,
  rejected_data TEXT NOT NULL
);
