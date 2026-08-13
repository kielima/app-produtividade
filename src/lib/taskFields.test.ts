import { describe, expect, it } from 'vitest';
import { normalizeEsforco, normalizeModo, normalizeMoscow } from './taskFields';

describe('normalizeModo', () => {
  it('aceita os valores atuais', () => {
    for (const v of ['manual', 'delegar', 'cowork', 'design', 'code', 'chat']) {
      expect(normalizeModo(v)).toBe(v);
    }
  });

  it('converte o rótulo legado "colaborar" em "chat"', () => {
    expect(normalizeModo('colaborar')).toBe('chat');
    expect(normalizeModo('Colaborar')).toBe('chat');
  });

  it('ignora diferença de caixa e espaços', () => {
    expect(normalizeModo('Manual')).toBe('manual');
    expect(normalizeModo(' CODE ')).toBe('code');
  });

  it('cai em "manual" para vazio, nulo e valor desconhecido', () => {
    expect(normalizeModo('')).toBe('manual');
    expect(normalizeModo(null)).toBe('manual');
    expect(normalizeModo(undefined)).toBe('manual');
    expect(normalizeModo('automatico')).toBe('manual');
  });
});

describe('normalizeMoscow', () => {
  it('aceita os valores atuais e ignora caixa e apóstrofo', () => {
    expect(normalizeMoscow('must')).toBe('must');
    expect(normalizeMoscow('Should')).toBe('should');
    expect(normalizeMoscow("Won't")).toBe('wont');
  });

  it('devolve vazio para nulo e valor desconhecido', () => {
    expect(normalizeMoscow(null)).toBe('');
    expect(normalizeMoscow('talvez')).toBe('');
  });
});

describe('normalizeEsforco', () => {
  it('aceita os valores atuais e ignora acento e caixa', () => {
    expect(normalizeEsforco('rapido')).toBe('rapido');
    expect(normalizeEsforco('Rápido')).toBe('rapido');
    expect(normalizeEsforco('MÉDIO')).toBe('medio');
    expect(normalizeEsforco('longo')).toBe('longo');
  });

  it('devolve vazio para nulo e valor desconhecido', () => {
    expect(normalizeEsforco(null)).toBe('');
    expect(normalizeEsforco('gigante')).toBe('');
  });
});
