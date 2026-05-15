/**
 * Lista de UIDs autorizados (apenas Kiê).
 *
 * Esta lista é só pra UX (mensagem de erro mais simpática no front).
 * A verdade está nas Firestore Security Rules — vide firestore.rules.
 *
 * Preencher depois do primeiro login Google no PWA deployado.
 */
export const AUTHORIZED_UIDS: string[] = [
  // 'UID_DO_KIE_AQUI'
];

export function isAuthorized(uid: string | null | undefined): boolean {
  if (!uid) return false;
  if (AUTHORIZED_UIDS.length === 0) return true; // ainda não configurado — destrava dev
  return AUTHORIZED_UIDS.includes(uid);
}
