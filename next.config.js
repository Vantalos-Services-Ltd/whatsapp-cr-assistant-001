/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  allowedDevOrigins: [
    "webpage.ngrok-free.app",
    "*.ngrok-free.app",
  ],
  // Proxy API, auth, and webhook requests to Fastify backend (port 3001)
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3001/api/:path*",
      },
      {
        source: "/auth/:path*",
        destination: "http://localhost:3001/auth/:path*",
      },
      {
        source: "/webhooks/:path*",
        destination: "http://localhost:3001/webhooks/:path*",
      },
    ];
  },
};

export default nextConfig;

