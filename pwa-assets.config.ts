import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      // Garante margem maior pro maskable não cortar o "P" em launchers
      // que aplicam máscara circular agressiva.
      padding: 0.3,
    },
  },
  images: ['public/logo.svg'],
});
