/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // repo นี้มี package-lock.json สองไฟล์ (ตัวเว็บเดิมที่ root + ตัวนี้) Next จะเดา workspace root ผิด
  // ชี้ให้ชัดว่า root คือโฟลเดอร์นี้ ไม่งั้น build trace จะกวาดไฟล์ของโปรเจกต์เดิมติดมาด้วย
  outputFileTracingRoot: import.meta.dirname,

  // next/image optimizer ในตัวของ Next ทำงานบน Cloudflare ไม่ได้ (ต้องพึ่ง sharp ซึ่งเป็น native Node module)
  // โปรเจกต์นี้ใช้รูปเดียวคือโลโก้ จึงปิด optimizer ไปเลย
  images: { unoptimized: true },

  // กัน webpack เผลอ polyfill Node built-in ให้ ทั้งที่บน Edge Runtime ใช้ไม่ได้จริง
  // ถ้าเผลอ import อะไรที่ต้องใช้ fs/net/tls จะพังตอน build แทนที่จะไปพังตอน runtime บน production
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime === 'edge') {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    }
    return config;
  }
};

// ตอน `next dev` ปกติ Next รันบน Node ธรรมดา จะไม่มี binding ของ Cloudflare (D1) ให้ใช้
// บรรทัดนี้ยิง miniflare ขึ้นมาเสียบ binding ตาม wrangler.toml ให้ getRequestContext() ใช้ได้จริงตอน dev ด้วย
// ทำงานเฉพาะตอน dev เท่านั้น ไม่ถูกรวมเข้า production build
if (process.env.NODE_ENV === 'development') {
  const { setupDevPlatform } = await import('@cloudflare/next-on-pages/next-dev');
  await setupDevPlatform();
}

export default nextConfig;
