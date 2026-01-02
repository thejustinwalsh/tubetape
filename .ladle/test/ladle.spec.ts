import { test, expect } from "@playwright/test";
import meta from "../build/meta.json" with { type: "json" };

Object.keys(meta.stories).forEach((storyKey) => {
  test(`${storyKey} - visual snapshot`, async ({ page }) => {
    await page.goto(`/?story=${storyKey}&mode=preview`);
    
    await page.waitForSelector("[data-storyloaded]", { timeout: 5000 });
    
    await page.waitForTimeout(500);
    
    await expect(page).toHaveScreenshot(`${storyKey}.png`, {
      maxDiffPixelRatio: 0.01,
    });
  });
});
