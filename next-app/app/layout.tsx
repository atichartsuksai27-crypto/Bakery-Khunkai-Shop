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
      <body>{children}</body>
    </html>
  );
}
