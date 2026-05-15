/**
 * M5b — Playwright smoke tests (golden path) — PIN auth version
 *
 * Requires Firebase emulators running:
 *   firebase emulators:start
 *
 * The Vite dev server is started automatically by Playwright (see
 * playwright.config.ts webServer section) with VITE_USE_FIREBASE_EMULATOR=true.
 *
 * Auth: the app uses a fixed email + 6-digit PIN. First time creating the
 * account, the user confirms the PIN; subsequent times, just sign in.
 * The smoke test simulates the first-time setup flow (auth emulator is
 * cleared before each run).
 */

import { expect, test } from '@playwright/test';

const AUTH_EMULATOR = 'http://localhost:9099';
const PROJECT_ID = 'app-produtividade-3ec9d';
const TEST_PIN = '123456';

async function clearAuthEmulator(): Promise<void> {
  const res = await fetch(
    `${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`clearAuthEmulator failed: ${res.status} ${await res.text()}`);
  }
}

test.describe('smoke @smoke', () => {
  test.beforeAll(async () => {
    await clearAuthEmulator();
  });

  test.afterAll(async () => {
    await clearAuthEmulator();
  });

  test('first-time PIN setup → create section → create task → mark complete', async ({ page }) => {
    // 1. App opens on login screen with PIN input
    await page.goto('/');
    const pinInput = page.getByLabel(/PIN de 6 dígitos/i);
    await expect(pinInput).toBeVisible({ timeout: 15_000 });

    // 2. Type the PIN and submit — first attempt fails (user doesn't exist yet),
    //    triggering the "confirm to create" flow
    await pinInput.fill(TEST_PIN);
    await page.getByRole('button', { name: /^Entrar$/ }).click();

    // 3. Confirmation field appears — type the PIN again to create the account
    const confirmInput = page.getByLabel(/confirmação do PIN/i);
    await expect(confirmInput).toBeVisible({ timeout: 10_000 });
    await confirmInput.fill(TEST_PIN);
    await page.getByRole('button', { name: /Criar e entrar/i }).click();

    // 4. After login the app should render the main interface with tabs
    await expect(page.getByRole('button', { name: 'Tarefas' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Projetos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Configurações' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lista' })).toBeVisible({ timeout: 10_000 });

    // 5. Create a section
    const addSectionBtn = page.getByRole('button', { name: /adicionar seção/i });
    await expect(addSectionBtn).toBeVisible({ timeout: 10_000 });
    await addSectionBtn.click();
    const sectionInput = page.getByPlaceholder(/nome da nova seção/i);
    await expect(sectionInput).toBeVisible();
    await sectionInput.fill('Teste E2E');
    await sectionInput.press('Enter');
    await expect(page.getByText('Teste E2E')).toBeVisible({ timeout: 10_000 });

    // 6. Create a task
    const newTaskInput = page.getByLabel('nova tarefa');
    await expect(newTaskInput).toBeVisible({ timeout: 5_000 });
    await newTaskInput.fill('Tarefa de smoke test');
    await newTaskInput.press('Enter');
    await expect(page.getByText('Tarefa de smoke test')).toBeVisible({ timeout: 10_000 });

    // 7. Mark the task as complete
    const taskCheckbox = page.getByLabel('alternar concluída').first();
    await expect(taskCheckbox).toBeVisible();
    await taskCheckbox.check();
    await expect(page.getByText(/^0 de 1$/)).toBeVisible({ timeout: 5_000 });
  });
});
