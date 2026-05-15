/**
 * M5b — Playwright smoke tests (golden path)
 *
 * Requires Firebase emulators running:
 *   firebase emulators:start
 *
 * The Vite dev server is started automatically by Playwright (see
 * playwright.config.ts webServer section) with VITE_USE_FIREBASE_EMULATOR=true.
 *
 * Auth strategy: create a test user via the Firebase Auth emulator REST API,
 * then sign in programmatically via page.evaluate() using the Firebase Auth
 * SDK already loaded in the page context. This avoids the Google OAuth popup
 * that can't be driven in headless tests.
 */

import { expect, test } from '@playwright/test';

const AUTH_EMULATOR = 'http://localhost:9099';
const FIRESTORE_EMULATOR = 'http://localhost:8081';
const PROJECT_ID = 'app-produtividade-kie';
const TEST_EMAIL = 'smoke-test@example.com';
const TEST_PASSWORD = 'password123';

// ---------------------------------------------------------------------------
// Helpers — emulator REST calls (Node context, not browser)
// ---------------------------------------------------------------------------

async function clearAuthEmulator(): Promise<void> {
  const res = await fetch(
    `${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    // 404 means no users yet — that's fine
    if (res.status !== 404) {
      throw new Error(`clearAuthEmulator failed: ${res.status} ${await res.text()}`);
    }
  }
}

async function createTestUser(): Promise<string> {
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`createTestUser failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json() as { localId: string };
  return data.localId;
}

async function clearFirestoreUser(uid: string): Promise<void> {
  // Delete all documents under users/{uid} in the emulator
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  // Best-effort; ignore errors (emulator may not support bulk delete for all paths)
  void res;
  void uid;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('smoke @smoke', () => {
  test.beforeAll(async () => {
    await clearAuthEmulator();
    await createTestUser();
  });

  test.afterAll(async () => {
    await clearAuthEmulator();
  });

  test('login → task list loads → create task → task appears', async ({ page }) => {
    // -----------------------------------------------------------------------
    // 1. Navigate to the app — should show the login screen
    // -----------------------------------------------------------------------
    await page.goto('/');

    // Wait for the login button (Google sign-in)
    await expect(page.getByRole('button', { name: /entrar com google/i })).toBeVisible({
      timeout: 15_000,
    });

    // -----------------------------------------------------------------------
    // 2. Sign in programmatically via Firebase Auth SDK (emulator)
    //    The page already loaded firebase/auth connected to the emulator.
    // -----------------------------------------------------------------------
    await page.evaluate(
      async ({ email, password }: { email: string; password: string }) => {
        // Access the Firebase app that was already initialized by the page bundle.
        // We import from the same firebase/auth module the app uses.
        const { getApps } = await import('firebase/app');
        const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth');

        const apps = getApps();
        if (apps.length === 0) throw new Error('No Firebase app initialized');

        const auth = getAuth(apps[0]);
        await signInWithEmailAndPassword(auth, email, password);
      },
      { email: TEST_EMAIL, password: TEST_PASSWORD },
    );

    // -----------------------------------------------------------------------
    // 3. After login the app should render the main interface with tabs
    // -----------------------------------------------------------------------
    await expect(page.getByRole('button', { name: 'Tarefas' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Projetos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Configurações' })).toBeVisible();

    // The tasks sub-tabs should be visible (default view is 'lista')
    await expect(page.getByRole('button', { name: 'Lista' })).toBeVisible({ timeout: 10_000 });

    // -----------------------------------------------------------------------
    // 4. Create a section (new users have no sections)
    //    The ListView shows "+ adicionar seção" when sections list is empty.
    // -----------------------------------------------------------------------
    const addSectionBtn = page.getByRole('button', { name: /adicionar seção/i });
    await expect(addSectionBtn).toBeVisible({ timeout: 10_000 });
    await addSectionBtn.click();

    // Type a section name and confirm with Enter
    const sectionInput = page.getByPlaceholder(/nome da nova seção/i);
    await expect(sectionInput).toBeVisible();
    await sectionInput.fill('Teste E2E');
    await sectionInput.press('Enter');

    // Section header should appear
    await expect(page.getByText('Teste E2E')).toBeVisible({ timeout: 10_000 });

    // -----------------------------------------------------------------------
    // 5. Create a task using the inline input inside the section
    // -----------------------------------------------------------------------
    const newTaskInput = page.getByLabel('nova tarefa');
    await expect(newTaskInput).toBeVisible({ timeout: 5_000 });
    await newTaskInput.fill('Tarefa de smoke test');
    await newTaskInput.press('Enter');

    // -----------------------------------------------------------------------
    // 6. Verify the task appears in the list
    // -----------------------------------------------------------------------
    await expect(page.getByText('Tarefa de smoke test')).toBeVisible({ timeout: 10_000 });

    // -----------------------------------------------------------------------
    // 7. Mark the task as complete via its checkbox
    // -----------------------------------------------------------------------
    const taskCheckbox = page.getByLabel('alternar concluída').first();
    await expect(taskCheckbox).toBeVisible();
    await taskCheckbox.check();

    // With hideCompleted=true (default), the task disappears from view
    // — verify via the task counter that 0 tasks are shown (1 total, 0 visible)
    // The counter pattern is "0 de 1"
    await expect(page.getByText(/^0 de 1$/)).toBeVisible({ timeout: 5_000 });
  });
});
