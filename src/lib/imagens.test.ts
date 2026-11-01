import { describe, expect, it } from 'vitest';
import { ehImagemRedimensionavel, inferirTipo } from './imagens';

describe('inferirTipo', () => {
  it('mantém o tipo informado pelo navegador', () => {
    expect(inferirTipo({ name: 'x.bin', type: 'image/png' })).toBe('image/png');
  });

  it('deduz pela extensão quando o tipo vem vazio (WebView do Android)', () => {
    expect(inferirTipo({ name: 'IMG_2026.JPG', type: '' })).toBe('image/jpeg');
    expect(inferirTipo({ name: 'doc.pdf', type: '' })).toBe('application/pdf');
  });

  it('deduz pela extensão quando o tipo é genérico', () => {
    expect(inferirTipo({ name: 'foto.webp', type: 'application/octet-stream' })).toBe('image/webp');
    expect(inferirTipo({ name: 'foto.png', type: 'image/*' })).toBe('image/png');
  });

  it('devolve vazio quando não há como saber', () => {
    expect(inferirTipo({ name: 'sem-extensao', type: '' })).toBe('');
  });
});

describe('ehImagemRedimensionavel', () => {
  it('aceita PNG/JPEG/WebP e recusa HEIC e PDF', () => {
    expect(ehImagemRedimensionavel('image/jpeg')).toBe(true);
    expect(ehImagemRedimensionavel('image/heic')).toBe(false);
    expect(ehImagemRedimensionavel('application/pdf')).toBe(false);
  });
});
