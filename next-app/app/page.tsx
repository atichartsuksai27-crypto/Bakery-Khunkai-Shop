import LegacyApp from '@/components/LegacyApp';

/**
 * โครงหน้าเว็บ (shell) — เป็น Server Component ล้วน ไม่มี state/event
 * จึงถูกส่งเป็น HTML สำเร็จรูปมาให้เลย ผู้ใช้เห็นเมนูทันทีตั้งแต่ก่อน JS โหลดเสร็จ
 *
 * ⚠️ ห้ามเปลี่ยน id เหล่านี้: #app, #nav, #toast, #saveAlert, #savedAt
 *    และห้ามเปลี่ยน class .tab / attribute data-view ของปุ่มเมนู
 *    เพราะ engine เดิม (lib/legacy-engine.js) ค้นหา element ด้วย id พวกนี้ตรง ๆ
 *    และผูก click listener ไว้ที่ #nav แล้วอ่าน data-view จาก .tab ที่ถูกคลิก
 *    (โครงจะเป็น topbar หรือ sidebar ก็ได้ ขอแค่ id/class/data-view ยังอยู่ครบ)
 *
 * หมายเหตุ: ระบบนี้ใช้ภายในองค์กร ไม่มีระบบล็อกอิน/บัญชีผู้ใช้โดยตั้งใจ
 * จึงไม่มีการ์ดโปรไฟล์ผู้ใช้หรือปุ่มออกจากระบบใด ๆ ในเมนู
 */

const NAV = [
  { view: 'dashboard', label: 'ภาพรวม' },
  { view: 'recipes', label: 'สูตรขนม' },
  { view: 'production', label: 'คิดรอบผลิต' },
  { view: 'pricing', label: 'ตั้งราคาขาย' },
  { view: 'ledger', label: 'บัญชีรายวัน' },
  { view: 'ingredients', label: 'วัตถุดิบ' },
  { view: 'data', label: 'ข้อมูล' }
];

export default function Page() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand">
            <span className="brand-mark">
              {/* ใช้ <img> ไม่ใช่ next/image — optimizer ของ Next ต้องพึ่ง sharp (native Node module)
                  ซึ่งรันบน Cloudflare ไม่ได้ ดู images.unoptimized ใน next.config.mjs */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/img/logo-mark.png" alt="Bakery By Khunkai" />
            </span>
            <strong>Bakery Khunkai</strong>
          </div>

          <nav className="tabs" id="nav" aria-label="เมนูหลัก">
            {NAV.map((n) => (
              <button key={n.view} className="tab" data-view={n.view}>
                {n.label}
              </button>
            ))}
          </nav>

          {/* spacer ฝั่งขวาให้เมนูอยู่กึ่งกลางพอดีกับความกว้างของโลโก้ฝั่งซ้าย */}
          <div style={{ width: 0 }} />
        </div>
      </header>

      {/* engine เดิมเป็นคนวาดเนื้อหาข้างในนี้ทั้งหมดผ่าน innerHTML — React ไม่แตะต้อง */}
      <main id="app" />

      <footer className="foot">
        <span>ข้อมูลใช้ร่วมกันทั้งร้านผ่านฐานข้อมูลกลาง — สำรองไฟล์ได้ที่เมนู "ข้อมูล"</span>
        {/* engine เขียนข้อความ "บันทึกล่าสุด …" / "กำลังบันทึก…" / "โหมดออฟไลน์" ลงตรงนี้ */}
        <span id="savedAt" />
      </footer>

      <div className="toast" id="toast" hidden />
      <div className="save-alert" id="saveAlert" hidden role="alert" />

      <LegacyApp />
    </>
  );
}
