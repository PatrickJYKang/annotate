const { execFileSync } = require('node:child_process');
let sourceCommit = '';
try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Source archives may not include Git metadata. */ }

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_SOURCE_COMMIT: sourceCommit },
  distDir: process.env.NEXT_DIST_DIR || '.next',
  outputFileTracingRoot: __dirname,
  ...(process.env.ANNOTATE_STANDALONE === '1' ? { output: 'standalone' } : {}),
  webpack(config) {
    // React-Konva is browser-only; do not resolve Konva's optional Node canvas adapter.
    config.resolve.alias.canvas = false;
    return config;
  },
};
module.exports = nextConfig;
