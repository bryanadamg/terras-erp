/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The browser reaches the API through the /api rewrite below; keep its trailing
  // slashes intact (FastAPI would bounce the stripped path straight back) and give
  // slow endpoints (imports, backups, reports) more than the 30s proxy default.
  skipTrailingSlashRedirect: true,
  experimental: {
    proxyTimeout: 300000,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async redirects() {
    return [
      // Legacy routes folded into /item-metadata (were client-side stub pages)
      { source: '/attributes', destination: '/item-metadata', permanent: false },
      { source: '/categories', destination: '/item-metadata', permanent: false },
      { source: '/uom', destination: '/item-metadata', permanent: false },
      // Three camera pages folded into one dispatcher — /scanner decodes the code
      // and opens the right screen, so the floor no longer picks a scanner first.
      { source: '/pick-scan', destination: '/scanner', permanent: false },
      { source: '/packing-scan', destination: '/scanner', permanent: false },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://api:8000/api/:path*',
      },
      {
        source: '/static/:path*',
        destination: 'http://api:8000/static/:path*',
      },
    ]
  },
}

module.exports = nextConfig
