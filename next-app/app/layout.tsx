import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bakery By Khunkai — ระบบสูตรและต้นทุนขนม',
  description: 'ระบบสูตรและต้นทุนขนม · ใช้ภายในองค์กร',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/img/logo-mark.png' },
      {
        url:
          "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
          "<text y='.9em' font-size='90'>🧁</text></svg>"
      }
    ]
  }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        {/* ฟอนต์หัวเรื่อง (serif รองรับภาษาไทย) + ฟอนต์ลายมือสำหรับชื่อร้านเท่านั้น
            โหลดจาก Google Fonts แบบ non-blocking — ถ้าโหลดไม่ได้ (เน็ตร้านล่ม/ออฟไลน์)
            จะตกไปใช้ฟอนต์ในเครื่องตาม fallback ที่ตั้งไว้ใน globals.css เว็บยังใช้งานได้ปกติ */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+Thai:wght@500;600;700&family=Parisienne&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
