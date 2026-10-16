/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  allowedDevOrigins: [
    "webpage.ngrok-free.app",
    "*.ngrok-free.app",
    // Phones and other devices on the same home/office network (./run ui)
    "192.168.*.*",
    "10.*.*.*",
    "172.*.*.*",
    "*.local",
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

