// Grava a versão publicada do app no Firestore, para o verificador de
// atualização in-app.
//
// O APK em si é hospedado no Firebase Hosting (plano gratuito) pelo workflow
// "Android APK" — o Storage do Firebase exige o plano pago (Blaze). Aqui só
// escrevemos, com a service account, o doc global `app/versao` com o commit
// construído e a URL pública do APK no Hosting. O app lê esse doc (leitura
// pública, sem dados pessoais), compara o commit com o da build instalada e
// baixa o APK se houver versão nova.
//
// A credencial vem da variável GOOGLE_APPLICATION_CREDENTIALS (caminho do JSON
// da service account), que o workflow define a partir do segredo. O admin SDK a
// usa automaticamente via applicationDefault().
//
// Variáveis de ambiente:
//   GOOGLE_APPLICATION_CREDENTIALS  caminho do JSON da service account (workflow)
//   APP_COMMIT                      commit realmente construído (vai no doc)
//   APK_URL                         URL pública do APK no Hosting (obrigatório)

import admin from 'firebase-admin';

const commit = process.env.APP_COMMIT || '';
const apkUrl = process.env.APK_URL || '';
if (!apkUrl) {
  console.error('APK_URL ausente — não dá para registrar a versão.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });

await admin.firestore().doc('app/versao').set({
  commit,
  apkUrl,
  atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
});

console.log(`Versão publicada · commit ${commit || '(vazio)'}`);
console.log(`APK: ${apkUrl}`);
