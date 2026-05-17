import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      // Padding 0: a fonte (logo.png) já reserva safe zone interna (~80%)
      // pro check, e o fundo off-white preenche edge-to-edge. Sem isso o
      // gerador encolhia o ícone e o launcher Samsung adicionava moldura
      // branca em volta.
      padding: 0,
    },
  },
  images: ['public/logo.png'],
});
