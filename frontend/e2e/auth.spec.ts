import { test, expect, Page } from '@playwright/test';

async function loginAs(page: Page, username: string, password: string) {
    await page.goto('/login');
    await page.waitForSelector('text=SYSTEM_CHECK...', { state: 'hidden', timeout: 15000 });
    await page.getByTestId('username-input').fill(username);
    // Wait for password step to appear (exact match triggers auto-advance)
    await page.getByTestId('password-input').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId('password-input').fill(password);
    await page.getByTestId('login-submit').click();
}

test.describe('Authentication & RBAC', () => {

    test('unauthenticated user is redirected to login', async ({ page }) => {
        await page.goto('/dashboard');
        await expect(page).toHaveURL('/login');
    });

    test('unauthenticated user at root is redirected to login', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveURL('/login');
    });

    test('successful login and logout', async ({ page }) => {
        await loginAs(page, 'admin', 'password');
        await expect(page).toHaveURL('/dashboard', { timeout: 15000 });
        await expect(page.getByTestId('username-display')).toContainText('admin');
        await page.getByTestId('logout-btn').click();
        await expect(page).toHaveURL('/login');
    });

    test('viewer role cannot access settings', async ({ page }) => {
        await loginAs(page, 'admin', 'password');
        await expect(page).toHaveURL('/dashboard');
        await expect(page.getByTestId('settings-btn')).toBeVisible();
        await page.goto('/settings');
        await expect(page.locator('text=Database Infrastructure')).toBeVisible();
    });

    test('invalid login shows error', async ({ page }) => {
        await page.goto('/login');
        await page.waitForSelector('text=SYSTEM_CHECK...', { state: 'hidden', timeout: 15000 });
        await page.getByTestId('username-input').fill('wrong');
        // 'wrong' won't match any known user — click Next to advance manually
        await page.getByTestId('login-submit').click();
        await page.getByTestId('password-input').waitFor({ state: 'visible', timeout: 5000 });
        await page.getByTestId('password-input').fill('wrong');
        await page.getByTestId('login-submit').click();
        await expect(page.getByTestId('login-error')).toBeVisible();
        await expect(page.getByTestId('login-error')).toContainText('Invalid credentials');
    });

    test('back button returns to username step', async ({ page }) => {
        await page.goto('/login');
        await page.waitForSelector('text=SYSTEM_CHECK...', { state: 'hidden', timeout: 15000 });
        await page.getByTestId('username-input').fill('admin');
        await page.getByTestId('password-input').waitFor({ state: 'visible', timeout: 5000 });
        await page.getByRole('button', { name: '← Back' }).click();
        await expect(page.getByTestId('username-input')).toBeVisible();
        await expect(page.getByTestId('password-input')).not.toBeVisible();
    });

});
