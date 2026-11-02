/** @type {import('next').NextConfig} */
const nextConfig = {
  // The demo seed lives in the engine package (../src/demo/seed.ts) so the engine
  // tests can cover it; the API route imports it from there.
  experimental: { externalDir: true },
};
export default nextConfig;
