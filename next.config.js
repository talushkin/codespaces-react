/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'https://xpltestdev.click/app/v1/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
