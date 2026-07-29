// Grava a versão publicada do app na tabela `app_version` do Supabase, para
// o verificador de atualização in-app.
//
// O APK em si continua hospedado no Firebase Hosting (plano gratuito) pelo
// workflow "Android APK" — só o registro da versão (commit + URL do APK)
// migrou do Firestore para o Supabase. `app_version` tem RLS de leitura
// pública mas escrita só via service_role — por isso este script usa a
// service role key, nunca a anon key.
//
// Variáveis de ambiente:
//   SUPABASE_URL                 URL do projeto Supabase
//   SUPABASE_SERVICE_ROLE_KEY    service role key (bypassa RLS) — segredo de CI
//   APP_COMMIT                   commit realmente construído
//   APK_URL                      URL pública do APK no Firebase Hosting (obrigatório)

import { createClient } from '@supabase/supabase-js';

const commit = process.env.APP_COMMIT || '';
const apkUrl = process.env.APK_URL || '';
if (!apkUrl) {
  console.error('APK_URL ausente — não dá para registrar a versão.');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes — não dá para publicar.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const { error } = await supabase
  .from('app_version')
  .upsert({ id: 1, commit, apk_url: apkUrl, atualizado_em: new Date().toISOString() });

if (error) {
  console.error('Falha ao publicar versão no Supabase:', error.message);
  process.exit(1);
}

console.log(`Versão publicada · commit ${commit || '(vazio)'}`);
console.log(`APK: ${apkUrl}`);
