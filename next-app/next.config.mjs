/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // repo นี้มี package-lock.json สองไฟล์ (ตัวเว็บเดิมที่ root + ตัวนี้) Next จะเดา workspace root ผิด
  // ชี้ให้ชัดว่า root คือโฟลเดอร์นี้ ไม่งั้น build trace จะกวาดไฟล์ของโปรเจกต์เดิมติดมาด้วย
  outputFileTracingRoot: import.meta.dirname,

  // ไม่มีโดเมนรูปภาพภายนอกให้ optimize (โลโก้เป็นไฟล์ในเครื่องไฟล์เดียว) และ Vercel รองรับ
  // next/image optimizer อยู่แล้ว จึงไม่ต้องปิดเหมือนตอนอยู่บน Cloudflare — คงค่าเริ่มต้นไว้
};

export default nextConfig;
