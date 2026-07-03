import { test, expect, type Page } from "@playwright/test";
import { AUTH_FILE } from "./global-setup";

/**
 * Smoke test HÀNH VI (Phase 8) — bổ sung cho visual snapshot: kiểm luồng chạy thật,
 * không so pixel. Không mutate DB bền vững (quiz dùng "Xong hôm nay" = client-only)
 * để giữ seed ổn định cho visual suite.
 */

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test.describe("smoke @ public", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("trang chủ load không lỗi console", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto("/");
    await page.waitForLoadState("load");
    await expect(page.locator("main")).toBeVisible();
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});

test.describe("smoke @ authed", () => {
  test.use({ storageState: AUTH_FILE });

  test("hoàn thành một lượt quiz từ vựng (không lỗi console)", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto("/quiz");
    // seed = 1 từ chưa học → thẻ self-check: hiện đáp án rồi "Xong hôm nay" (client-only)
    await expect(page.locator(".study-stage")).toBeVisible();
    const reveal = page.locator(".reveal-panel button", { hasText: "Hiện đáp án" });
    if (await reveal.count()) {
      await reveal.first().click();
    } else {
      // trường hợp mcq (deck >1): chọn đáp án đầu
      await page.locator(".option-button").first().click();
    }
    await expect(page.locator(".result-actions")).toBeVisible();
    await page.locator(".result-actions button", { hasText: "Xong hôm nay" }).click();
    await expect(page.locator(".completion-card")).toBeVisible();
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("đổi theme (skin) áp ngay + lưu cookie", async ({ page }) => {
    await page.goto("/preferences");
    await page.locator('.style-card[data-style="midnight"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-style", "midnight");
    await expect(page.locator("body")).toHaveClass(/ftka-dark-ui/);
    await page.locator('.style-card[data-style="neo"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-style", "neo");
    await expect(page.locator("body")).toHaveClass(/ftka-light-ui/);
    const cookie = (await page.context().cookies()).find((c) => c.name === "ftka_style");
    expect(cookie?.value).toBe("neo");
  });

  test("sidebar mobile mở/đóng ở 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    const sidebar = page.locator(".sidebar");
    // đóng ban đầu (nằm ngoài màn hình bên trái)
    await expect.poll(async () => (await sidebar.boundingBox())!.x < 0).toBe(true);
    await page.locator("[data-sidebar-toggle]").click();
    await expect(page.locator("body")).toHaveClass(/sidebar-open/);
    await expect.poll(async () => Math.round((await sidebar.boundingBox())!.x)).toBe(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toHaveClass(/sidebar-open/);
    await expect.poll(async () => (await sidebar.boundingBox())!.x < 0).toBe(true);
  });
});
