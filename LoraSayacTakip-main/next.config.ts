import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Geliştirme sırasında hem localhost hem de 127.0.0.1 üzerinden açılan
  // tarayıcıların Next.js istemci dosyalarına ve HMR bağlantısına erişmesine izin ver.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });
    return config;
  },
    
    turbopack: {
      rules: {
        '*.svg': {
          loaders: ['@svgr/webpack'],
          as: '*.js',
        },
      },
    },
  
};

export default nextConfig;
