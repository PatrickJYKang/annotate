/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  outputFileTracingRoot: __dirname,
  webpack(config) {
    // React-Konva is browser-only; do not resolve Konva's optional Node canvas adapter.
    config.resolve.alias.canvas = false;
    return config;
  },
};
module.exports = nextConfig;
