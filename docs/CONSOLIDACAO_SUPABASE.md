# Consolidação dos projetos Supabase

Registro da fusão dos dois projetos Supabase (`app-produtividade` e `wishlist`)
num só. Tarefa #0958. **Concluída e validada.**

## Estado final

Projeto único: **`robwqxgllzxbxwnjkyic`** (`app-produtividade`), um schema por app.

| | app-produtividade | wishlist |
|---|---|---|
| Schema | `produtividade` | `wishlist` |
| Tabelas | `tasks` 565, `projects` 65, `notes` 86, `reading_items` 5.634, `annotations` 3, `project_ratings` 63, `memory_docs` 2, `connection_status` 2, `app_version` 1 | `items` 79, `item_ratings` 70, `app_version` 1 |
| Edge Functions | `connect-*`, `get-*-access-token`, `disconnect-*`, `call-gemini` | `clip` |
| Storage | — | bucket público `app-builds` |
| Login | Google (OAuth no navegador, Sign-In nativo no APK) | idem |

`private.oauth_tokens` continua fora do PostgREST de propósito: é lida por
conexão direta ao Postgres, com nome qualificado, nas Edge Functions.

Auth é compartilhado: **um login serve os dois apps** (`kly@sapo.pt` via
Google). Isso também significa que provedores, templates de e-mail e Redirect
URLs valem para os dois.

## Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Projeto destino | O do app-produtividade | 6.421 linhas contra 149, 7 Edge Functions contra 2, schema `private` e secrets do Google OAuth já configurados. A org está no plano free (limite de 2 projetos), então um terceiro não cabia. |
| Colisão de `app_version` | Um schema por app | As duas tabelas tinham formatos diferentes (`id` int4 vs int2, `atualizado_em` vs `updated_at`) e ciclos de release independentes. Schema separado resolve sem prefixo; como o supabase-js aceita schema padrão no `createClient`, os 62 call sites de `.from()` ficaram intactos. |
| Identidade | Tudo reatribuído a `kly@sapo.pt` | `auth.users` não atravessa projetos. As linhas da wishlist passaram de `e6f806ae…` (ttiburcio@outlook.com) para `66acb2fb…`. |

## Como os dados foram copiados

O caminho oficial (`Restore to a new project`) é exclusivo de plano pago, e o
alternativo (`backup/restore via CLI`) exige terminal. Sem nenhum dos dois, a
cópia foi feita **pela API REST, de dentro do próprio banco de destino**: a
extensão `http` puxou as linhas da origem em páginas de 10, para uma área de
staging sem RLS (necessária porque o `user_id` original ainda não existia no
auth do destino), e de lá um `INSERT..SELECT` fez o remap e a carga definitiva.

Validação: fingerprint `md5(string_agg(...))` por tabela, comparado entre
origem e destino em todas as colunas exceto `user_id`. Bateu nas três tabelas,
incluindo os 11 MB de fotos em base64.

Depois disso o staging e as extensões `http`/`dblink` foram removidos.

## Armadilhas encontradas — vale ler antes de mexer nisto

**Exposed schemas não fica versionado.** É configuração de dashboard
(*Project Settings → API*). Sem `produtividade` e `wishlist` na lista, o
PostgREST recusa tudo com `PGRST106` e os dois apps caem juntos. É a única
peça da consolidação que uma migration não reproduz.

**Migration e deploy precisam sair juntos.** O `ALTER TABLE … SET SCHEMA` é
instantâneo, mas o build publicado continua procurando as tabelas no `public`
até o deploy sair. Os dois PRs foram mergeados antes de a migration ser
aplicada e os apps ficaram fora do ar no intervalo. Aviso escrito no PR não
segura merge — o certo seria o schema vir de variável com default `public`,
tornando a ordem irrelevante.

**`app_version` migrado fielmente causa downgrade em loop.** A linha da origem
apontava para o build antigo. O APK novo lia essa linha, via um commit
diferente do seu e "atualizava" para trás, reinstalando a versão velha e
derrubando a sessão — repetidamente. Ao migrar, essa linha precisa apontar para
o build atual, não ser copiada como está.

**Storage recusa chaves `sb_secret_`.** O supabase-js manda a chave como
`Authorization: Bearer`, e o Storage responde `Invalid Compact JWS`. Com o
header `apikey` a mesma chave funciona, e o PostgREST aceita as duas formas.
Para o CI publicar o APK, use a chave **legada** `service_role` (aba "Legacy"
em API Keys).

**Código OTP por e-mail exige SMTP próprio.** O código só é enviado se o
template Magic Link incluir `{{ .Token }}`, e editar templates passou a exigir
SMTP próprio ou plano Pro. O projeto antigo tinha a customização de quando
ainda era livre; o consolidado nasceu depois da trava. Como o link sozinho não
volta para dentro de WebView nem de PWA instalado, a wishlist passou a usar
Google Sign-In nativo (ver `docs/PHASE2-SETUP.md` no repo dela).

**Cache do WebView sobrevive à desinstalação.** Com o backup automático do
Google ligado, o Android restaura os dados do app ao reinstalar — inclusive o
cache do service worker, que continua servindo o bundle antigo mesmo com o APK
novo instalado. Sintoma: o APK muda de tamanho mas a tela não muda. Solução:
*Configurações → Apps → [app] → Armazenamento → Limpar dados*.

## Pendências

- **Projeto antigo `jwmuwogwutiiuvewhkku`**: mantido no ar de propósito. Nada
  depende dele em runtime, mas é a única cópia independente dos dados — o
  backup via `pg_dump` nunca chegou a ser feito, porque exigiria terminal.
  Antes de apagá-lo, vale garantir um backup por outro meio.
- Sobraram lá o APK `wishlist-aa1e3d33.apk` (ponte usada para o app antigo se
  atualizar) e um usuário `kly@sapo.pt` criado por engano numa tentativa de
  login. Somem junto com o projeto.
- A Edge Function `clip-debug` não foi portada: é variante de depuração e nem
  está versionada no repo da wishlist.
