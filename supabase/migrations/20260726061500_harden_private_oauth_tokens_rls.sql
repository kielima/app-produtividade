-- Endurece private.oauth_tokens: RLS habilitado sem nenhuma policy, então
-- anon/authenticated não têm acesso algum — só service_role (usado pelas
-- Edge Functions) consegue ler/escrever, pois ignora RLS.
-- Reforço em cima do isolamento já dado por `private` não estar em
-- [api].schemas no supabase/config.toml.
alter table private.oauth_tokens enable row level security;
