import { describe, expect, it } from 'vitest';
import { aguardaResposta, idsAguardandoResposta } from './aguardaResposta';

const c = (autorNome: string | null, criadoEm: string) => ({ autorNome, criadoEm });

describe('aguardaResposta', () => {
  it('sem comentários não espera nada', () => {
    expect(aguardaResposta([])).toBe(false);
  });

  it('último comentário do Claude → esperando', () => {
    expect(aguardaResposta([c('Kiê', '2026-11-01T10:00:00Z'), c('Claude', '2026-11-01T11:00:00Z')])).toBe(true);
  });

  it('resposta depois da pergunta → não espera mais', () => {
    expect(aguardaResposta([c('Claude', '2026-11-01T10:00:00Z'), c('Kiê', '2026-11-01T11:00:00Z')])).toBe(false);
  });

  it('usa o horário, não a ordem da lista', () => {
    expect(aguardaResposta([c('Kiê', '2026-11-01T12:00:00Z'), c('Claude', '2026-11-01T11:00:00Z')])).toBe(false);
  });

  it('nova pergunta depois da resposta volta a esperar', () => {
    expect(
      aguardaResposta([
        c('Claude', '2026-11-01T09:00:00Z'),
        c('Kiê', '2026-11-01T10:00:00Z'),
        c('Claude', '2026-11-01T11:00:00Z'),
      ]),
    ).toBe(true);
  });

  it('autor sem diferenciar maiúsculas e espaços', () => {
    expect(aguardaResposta([c('  claude ', '2026-11-01T11:00:00Z')])).toBe(true);
  });

  it('horário ilegível perde para um legível', () => {
    expect(aguardaResposta([c('Claude', 'xx'), c('Kiê', '2026-11-01T11:00:00Z')])).toBe(false);
  });
});

describe('idsAguardandoResposta', () => {
  it('devolve só os alvos esperando', () => {
    const mapa = new Map([
      ['1', [c('Claude', '2026-11-01T11:00:00Z')]],
      ['2', [c('Claude', '2026-11-01T11:00:00Z'), c('Kiê', '2026-11-01T12:00:00Z')]],
    ]);
    expect([...idsAguardandoResposta(mapa)]).toEqual(['1']);
  });
});
