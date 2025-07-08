const { test, expect } = require('@playwright/test');

test.describe('Cross Switch Basic QA', () => {
  test('Homepage loads and displays key elements', async ({ page }) => {
    await page.goto('https://cross-switch.staging2.liquidpreview2.net/');
    
    // Check for key text elements
    await expect(page.locator('h1')).toContainText('unified switch');
    
    // Take screenshot
    await page.screenshot({ path: 'screenshots/homepage-basic.png', fullPage: true });
    
    console.log('✅ Basic QA test completed');
  });
});
