import { supabase } from './supabase';

// Wrapper fino sobre `supabase.functions.invoke`, no mesmo espírito do
// `httpsCallable` do Firebase que este módulo substitui: chama a Edge
// Function por nome, injeta o JWT da sessão automaticamente e lança um
// Error de verdade (com a mensagem que a function devolveu) em caso de
// falha, em vez de devolver um objeto `{data, error}` que cada chamador
// precisaria checar manualmente.
export async function callEdgeFunction<TOut>(
  name: string,
  body?: Record<string, unknown>,
): Promise<TOut> {
  const { data, error } = await supabase.functions.invoke<TOut>(name, { body });
  if (error) {
    // FunctionsHttpError expõe a Response original em `context`; o corpo é o
    // JSON `{ error, message }` que nossas Edge Functions devolvem em falhas.
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const parsed = (await context.clone().json()) as { message?: string; error?: string };
        throw new Error(parsed.message || parsed.error || error.message);
      } catch {
        // corpo não era JSON — segue com a mensagem genérica do supabase-js
      }
    }
    throw new Error(error.message);
  }
  return data as TOut;
}
