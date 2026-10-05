import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * base 默认是 '/'，这样 `npm run build && npm run preview` 本地就能直接跑通。
 *
 * GitHub Pages 的项目页部署在 https://<user>.github.io/<repo>/ 下，需要前缀，
 * 由 .github/workflows/deploy.yml 注入 VITE_BASE 来完成 —— 不要在这里写死，
 * 否则 vite preview 会找不到资源（它不按 base 挂载 dist，只按 base 生成 HTML 里的 URL）。
 */
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    host: '127.0.0.1',
    port: 5180,
  },
  preview: {
    host: '127.0.0.1',
    port: 5181,
  },
});
