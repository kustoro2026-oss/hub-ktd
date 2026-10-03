import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ktd-hub tinggal di dalam repo toko yang lebih besar; pastikan Turbopack
  // memakai folder ini sebagai root, bukan package-lock.json milik repo induk.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
