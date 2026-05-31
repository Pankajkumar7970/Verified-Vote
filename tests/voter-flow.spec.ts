import { test, expect } from '@playwright/test';

test.describe('Voter Flow', () => {
  test('voter can login and view dashboard', async ({ page }) => {
    await page.route('**/api/auth/verify-voter', route => {
      route.fulfill({
        status: 200,
        json: { 
          request_id: 'test-req',
          session_nonce: 'dummy-session-nonce',
          requires_otp: true
        }
      });
    });

    await page.route('**/api/auth/verify-otp', route => {
      route.fulfill({
        status: 200,
        json: { 
          token: 'dummy-jwt-token',
          voter: { id: 'test', name: 'Test Voter' }
        }
      });
    });

    await page.route('**/api/voter/requests', route => {
      route.fulfill({
        status: 200,
        json: { 
          requests: []
        }
      });
    });

    // Navigate to homepage
    await page.goto('/');

    // Fill Voter ID
    await page.fill('input[id="voterId"]', 'ABC1234567');
    await page.click('button[type="submit"]');

    // Wait for OTP page
    await expect(page.locator('h2')).toContainText('Security Verification');

    // Fill OTP
    await page.fill('input[id="otp"]', '123456');
    await page.click('button[type="submit"]');

    // Wait for Dashboard
    await expect(page.locator('h2')).toContainText('My Portal');
    await expect(page.locator('text=Your Requests')).toBeVisible();
  });
});
