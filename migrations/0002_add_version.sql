-- เพิ่มคอลัมน์ version สำหรับทำ optimistic concurrency control
-- กันไม่ให้ PUT ที่ถือข้อมูลเก่าเขียนทับข้อมูลที่เพิ่งถูกบันทึกจากเครื่อง/แท็บอื่นแบบเงียบ ๆ
-- Non-destructive: ADD COLUMN...DEFAULT ทำให้แถวเดิมที่มีอยู่แล้ว (id=1) ได้ version = 1 อัตโนมัติ
-- ไม่กระทบ data/updated_at เดิมเลย
ALTER TABLE app_state ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
