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
 * จึงไม่มีการ์ดโปรไฟล์ผู้ใช้หรือปุ่มออกจากระบบใด ๆ ในเมนูข้าง
 */

/** ไอคอนเมนู — วาดเป็น SVG เส้น (stroke) inline เพื่อไม่ต้องโหลดไลบรารีไอคอนเพิ่ม */
const ICONS: Record<string, React.ReactElement> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.6" />
      <rect x="14" y="3" width="7" height="7" rx="1.6" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" />
      <rect x="14" y="14" width="7" height="7" rx="1.6" />
    </>
  ),
  recipes: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5" />
    </>
  ),
  production: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2.2" />
      <path d="M8 8h8M8 12h3M8 16h3M15 12v4" />
    </>
  ),
  pricing: (
    <>
      <path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5L21 12l-8 8z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  ledger: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.4" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1.2" />
    </>
  ),
  ingredients: (
    <>
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
      <path d="M9 6h11M9 12h11M9 18h11" />
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  )
};

const NAV = [
  { view: 'dashboard', label: 'ภาพรวม' },
  { view: 'recipes', label: 'สูตรขนม' },
  { view: 'production', label: 'คิดรอบผลิต' },
  { view: 'pricing', label: 'ตั้งราคาขาย' },
  { view: 'ledger', label: 'บัญชีรายวัน' },
  { view: 'ingredients', label: 'วัตถุดิบ' },
  { view: 'data', label: 'ข้อมูล' }
];

function NavIcon({ view }: { view: string }) {
  return (
    <svg
      className="tab-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[view]}
    </svg>
  );
}

export default function Page() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            {/* ใช้ <img> ไม่ใช่ next/image — optimizer ของ Next ต้องพึ่ง sharp (native Node module)
                ซึ่งรันบน Cloudflare ไม่ได้ ดู images.unoptimized ใน next.config.mjs */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/img/logo-mark.png" alt="Bakery By Khunkai" />
          </span>
          <div className="brand-text">
            <small>BAKERY BY</small>
            <strong>Khunkai</strong>
          </div>
        </div>

        <nav className="tabs" id="nav" aria-label="เมนูหลัก">
          {NAV.map((n) => (
            <button key={n.view} className="tab" data-view={n.view}>
              <NavIcon view={n.view} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        <div className="side-card">
          <span className="side-card-title">สถานะข้อมูล</span>
          {/* engine เขียนข้อความ "บันทึกล่าสุด …" / "กำลังบันทึก…" / "โหมดออฟไลน์" ลงตรงนี้ */}
          <span id="savedAt" />
          <span className="side-card-note">
            ใช้ฐานข้อมูลกลางร่วมกันทั้งร้าน · สำรองไฟล์ได้ที่เมนู “ข้อมูล”
          </span>
        </div>
      </aside>

      <div className="content">
        {/* engine เดิมเป็นคนวาดเนื้อหาข้างในนี้ทั้งหมดผ่าน innerHTML — React ไม่แตะต้อง */}
        <main id="app" />
      </div>

      <div className="toast" id="toast" hidden />
      <div className="save-alert" id="saveAlert" hidden role="alert" />

      <LegacyApp />
    </div>
  );
}
