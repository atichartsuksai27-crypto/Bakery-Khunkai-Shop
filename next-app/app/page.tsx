import LegacyApp from '@/components/LegacyApp';

/**
 * โครง DOM เดิมจาก index.html — ย้ายมาเป็น JSX ตรง ๆ ไม่เปลี่ยน id/class ใด ๆ
 * เพราะ engine เดิมค้นหา element เหล่านี้ด้วย id (#app, #nav, #toast, #saveAlert, #savedAt)
 *
 * ส่วนนี้เป็น Server Component ล้วน (ไม่มี state/event) จึงถูกส่งเป็น HTML สำเร็จรูปมาให้เลย
 * ผู้ใช้เห็นหัวเว็บและเมนูทันทีตั้งแต่ก่อน JS โหลดเสร็จ — เร็วกว่า index.html เดิมด้วยซ้ำ
 */
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
            <div>
              <strong>Bakery By Khunkai</strong>
              <small>ระบบสูตรและต้นทุนขนม · ใช้ภายในองค์กร</small>
            </div>
          </div>
        </div>
        <nav className="tabs" id="nav">
          <button className="tab" data-view="dashboard">ภาพรวม</button>
          <button className="tab" data-view="recipes">สูตรขนม</button>
          <button className="tab" data-view="production">คิดรอบผลิต</button>
          <button className="tab" data-view="pricing">ตั้งราคาขาย</button>
          <button className="tab" data-view="ledger">บัญชีรายวัน</button>
          <button className="tab" data-view="ingredients">วัตถุดิบ</button>
          <button className="tab" data-view="data">ข้อมูล</button>
        </nav>
      </header>

      {/* engine เดิมเป็นคนวาดเนื้อหาข้างในนี้ทั้งหมดผ่าน innerHTML — React ไม่แตะต้อง */}
      <main id="app" />

      <footer className="foot">
        <span>ข้อมูลใช้ร่วมกันทั้งร้านผ่านฐานข้อมูลกลาง (Cloudflare D1) — สำรองไฟล์ได้ที่เมนู “ข้อมูล”</span>
        <span id="savedAt" />
      </footer>

      <div className="toast" id="toast" hidden />
      <div className="save-alert" id="saveAlert" hidden role="alert" />

      <LegacyApp />
    </>
  );
}
