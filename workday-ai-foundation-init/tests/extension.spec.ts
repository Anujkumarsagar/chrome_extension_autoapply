import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Resolve absolute path to compiled build folder
const EXTENSION_PATH = path.resolve(__dirname, '../dist');

test.describe('Workday AI Autofill E2E Automation Test Suite', () => {
  
  test.beforeAll(() => {
    // Verify build exists
    if (!fs.existsSync(EXTENSION_PATH) || !fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(`Compiled extension not found at ${EXTENSION_PATH}. Please run "npm run build" first!`);
    }
  });

  test('should load unpacked extension, save settings, parse resume, and initiate Workday autofill', async () => {
    console.log('Launching Chromium with unpacked extension...');
    
    // 1. Launch chromium instance with loaded unpacked extension
    const context = await chromium.launchPersistentContext('', {
      headless: false, // Extension testing requires headful mode
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

    // 2. Locate service worker to retrieve extension ID
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    
    const extensionId = background.url().split('/')[2];
    console.log(`Detected Extension ID: ${extensionId}`);
    expect(extensionId).toBeDefined();

    // 3. Navigate to popup UI Page directly via chrome-extension protocol
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForLoadState('load');

    // 4. Assert settings configuration
    console.log('Configuring AI credentials...');
    await popupPage.click('text=Settings');
    
    // Choose Gemini AI provider
    await popupPage.selectOption('#ai-provider', 'gemini');
    await popupPage.fill('#gemini-key', 'AIzaSy_Mock_Test_Key_123'); // replacement test key
    await popupPage.fill('#gemini-model', 'gemini-1.5-flash');
    await popupPage.click('text=Save Settings');
    
    await expect(popupPage.locator('.log-console')).toContainText('AI Configurations saved. Active provider: GEMINI');

    // 5. Generate mock resume file for testing
    const testResumePath = path.resolve(__dirname, 'mock_resume.pdf');
    fs.writeFileSync(testResumePath, 'Anuj Kumar\nSoftware Engineer\nEmail: anuj@example.com\nPhone: 555-0199\nSkills: React, TypeScript, Node.js\nExperience: Senior Developer at Acme Corp (2022-2026)');

    // 6. Upload mock resume via dropzone
    console.log('Uploading mock resume PDF...');
    const [fileChooser] = await Promise.all([
      popupPage.waitForEvent('filechooser'),
      popupPage.click('.dropzone'),
    ]);
    await fileChooser.setFiles(testResumePath);

    // Wait for text extraction logs
    await expect(popupPage.locator('.log-console')).toContainText('characters of raw text');

    // 7. Load target Workday Career Page URL
    console.log('Navigating to Workday job portal...');
    const workdayPage = await context.newPage();
    // PNC, Remitly, or Nvidia Career Site
    await workdayPage.goto('https://remitly.wd5.myworkdayjobs.com/en-US/Remitly_Careers/details/Frontend-Software-Development-Engineer_R_106344');
    await workdayPage.waitForLoadState('domcontentloaded');

    // 8. Trigger Autofill from Popup UI context
    console.log('Triggering AI Autofill flow...');
    await popupPage.bringToFront();
    const autofillBtn = popupPage.locator('text=Start AI Autofill');
    await expect(autofillBtn).toBeEnabled();
    await autofillBtn.click();

    // 9. Verify that Floating Control Panel gets injected in Workday Tab DOM
    console.log('Asserting injected floating control panel overlay...');
    await workdayPage.bringToFront();
    const overlayPanel = workdayPage.locator('#waa-floating-panel');
    await expect(overlayPanel).toBeVisible({ timeout: 15000 });

    // Assert that scanning and log records are streaming
    await expect(workdayPage.locator('#waa-logs')).toContainText('autofill initiated', { timeout: 10000 });
    
    // 10. Clean up generated files and contexts
    console.log('Tearing down browser context...');
    fs.unlinkSync(testResumePath);
    await context.close();
  });
});
