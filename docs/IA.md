# Inteligência artificial no app (Claude)

Todas as funções de IA do app usam o **Claude**, da Anthropic:

| Função | Onde | Modelo |
|---|---|---|
| Gerar subtarefas | página da tarefa | o escolhido em Configurações |
| Transcrever imagem (compartilhada ou desenhada) | compartilhar → app, notas à mão | idem |
| Classificar item da Leitura (artigo/livro/outro) | aba Leitura | idem |
| Juiz do Duelo ("IA decide") | Projetos → Duelo | idem |

## Onde fica a chave

```
GitHub (secret ANTHROPIC_API_KEY)
   │  workflow .github/workflows/sync-anthropic-secret.yml
   ▼
Supabase (secret da Edge Function call-claude)
   │  só a função lê
   ▼
api.anthropic.com
```

- A chave **nunca** está no código, no bundle do site nem no APK.
- Um secret do GitHub não é legível pelo app em execução — só por workflows.
  Por isso o workflow copia a chave para o servidor onde a função roda.
- O app chama `call-claude` com o login do Supabase (JWT); a função recusa
  quem não está logado.

## Configurar (uma vez) ou trocar a chave

1. Crie a chave em **console.anthropic.com → API Keys**.
2. No GitHub: **Settings → Secrets and variables → Actions → New repository
   secret**:
   - `ANTHROPIC_API_KEY` = a chave;
   - `SUPABASE_ACCESS_TOKEN` = um token pessoal criado em
     **supabase.com/dashboard/account/tokens** (só na primeira vez).
3. **Actions → "Sync Anthropic secret + deploy call-claude" → Run workflow.**

Para trocar a chave: atualize o secret `ANTHROPIC_API_KEY` e rode o workflow
de novo.

## Modelo e custo

- O modelo é escolhido em **Configurações → Inteligência Artificial**, por
  dispositivo: Opus 5.5 (padrão, mais capaz), Sonnet 5.5 ou Haiku 5.5 (mais
  rápido e barato). A função só aceita esses três.
- Todas as chamadas usam **esforço baixo** (`effort: low`): são tarefas curtas
  e bem definidas.
- A resposta vem em JSON validado pela própria API (*structured outputs*).
- Opus e Sonnet usam `fallbacks: "default"`: se o classificador de segurança
  recusar por engano, a API refaz o pedido em outro modelo em vez de falhar.
