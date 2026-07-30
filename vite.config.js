import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// base: GitHub Pages serves project sites from /<repo>/, so assets need that
// prefix in production. Overridable via BASE_PATH for a custom domain or a
// different host.
//
// There is no dev proxy any more: model calls go to the `engine` Edge Function
// in every environment, so dev and production exercise the same path — and no
// provider key is ever present on this side of the wire.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.BASE_PATH || '/schreibwerkstatt/' : '/',
  plugins: [vue(), tailwindcss()],
  server: { port: 5175 },
}))
