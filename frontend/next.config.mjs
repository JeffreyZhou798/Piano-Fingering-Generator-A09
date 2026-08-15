import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // Web Worker support
    if (!isServer) {
      config.output.globalObject = 'self';
      // onnxruntime-web 在浏览器打包时不需要 Node 内置模块
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        os: false,
      };

      // onnxruntime-web 的 package.json exports 把 node 条件指向 ort.node.min.mjs，
      // 该入口含 import.meta.url / createRequire，Terser 无法压缩。
      // 强制别名到浏览器 UMD 入口 ort.min.js（含 wasm 后端，无 Node 语法）。
      // 用 $ 后缀确保精确匹配（不匹配子路径如 onnxruntime-web/wasm）
      const ortBrowserEntry = path.resolve('node_modules/onnxruntime-web/dist/ort.min.js');
      config.resolve.alias = {
        ...config.resolve.alias,
        'onnxruntime-web$': ortBrowserEntry,
        'onnxruntime-common$': path.resolve('node_modules/onnxruntime-common/dist/index.js'),
      };
    }

    // 强制走 require 条件（.js UMD），避免解析到含 ESM 语法的 .mjs 入口
    config.resolve.conditionNames = ['require', 'browser', 'default'];

    return config;
  },
};

export default nextConfig;
