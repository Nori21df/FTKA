import { test, expect, type Page } from "@playwright/test";
import { AUTH_FILE, ADMIN_AUTH_FILE } from "./global-setup";

/**
 * Lưới an toàn visual cho refactor frontend (Phase 0 — docs/REFACTOR_NOTES.md).
 * Chụp toàn trang ở 3 viewport. Baseline = trạng thái TRƯỚC refactor; mọi phase
 * sau phải pass nguyên vẹn (trừ thay đổi được khai báo trước ở Phase 6).
 *
 * Trang bỏ qua (so tay, ghi ở NOTES): /admin/* + /settings (cần tài khoản admin),
 * chi tiết listening (cần bài AI tạo sẵn).
 * /quiz ổn định được nhờ seed đúng 1 từ chưa học (ORDER BY RANDOM() trên 1 hàng
 * + shuffle 1 phần tử đều bất biến) — nếu đổi seed phải xem lại trang này.
 */

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-899", width: 899, height: 900 },
  // 2 viewport bổ sung trước Phase 4 (gộp CSS): phủ band 641–768 và 561–640 —
  // vùng của khối @media 768px (49 rule) và 640px mà 3 viewport gốc không chạm tới.
  { name: "mid-768", width: 768, height: 900 },
  { name: "mid-640", width: 640, height: 900 },
  { name: "mobile-390", width: 390, height: 844 }
] as const;

// mask: vùng động theo ngày giờ thực — không so pixel được.
const PUBLIC_PAGES = [
  { name: "home", path: "/" },
  { name: "login", path: "/login" },
  { name: "pricing", path: "/pricing" }
] as const;

const AUTHED_PAGES = [
  { name: "dashboard", path: "/dashboard", mask: [".dv-chart"] }, // nhãn thứ/ngày đổi theo ngày chạy
  { name: "vocab", path: "/vocab" },
  { name: "generator", path: "/generator" },
  { name: "grammar", path: "/grammar" },
  { name: "grammar-quiz", path: "/grammar-quiz" },
  { name: "quiz", path: "/quiz" },
  { name: "listening", path: "/listening-practice" },
  { name: "preferences", path: "/preferences" }
] as const;

// Trang admin: mask vùng động — console realtime (SSE, log đổi liên tục), badge trạng thái
// kết nối, dòng "+x hôm nay" (đổi khi sang ngày), cột "Đăng nhập gần nhất" (đổi mỗi lần
// global-setup đăng nhập user test).
const ADMIN_PAGES = [
  { name: "admin-dashboard", path: "/admin", mask: ["#rcConsole", "#consoleStatus", ".admin-kpi p"] },
  { name: "admin-users", path: "/admin/users", mask: [".admin-table td:nth-child(7)"] },
  { name: "admin-vocab", path: "/admin/vocab" },
  { name: "settings", path: "/settings" }
] as const;

async function settle(page: Page) {
  await page.waitForLoadState("load");
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(300); // để layout/icon font ổn định hẳn
}

async function shoot(page: Page, name: string, vp: string, maskSelectors: readonly string[] = []) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}-${vp}.png`, {
    fullPage: true,
    mask: maskSelectors.map((s) => page.locator(s))
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`public @ ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      storageState: { cookies: [], origins: [] },
      reducedMotion: "reduce"
    });
    for (const p of PUBLIC_PAGES) {
      test(`${p.name} @ ${vp.name}`, async ({ page }) => {
        await page.goto(p.path);
        await shoot(page, p.name, vp.name);
      });
    }
  });

  test.describe(`authed @ ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      storageState: AUTH_FILE,
      reducedMotion: "reduce"
    });
    for (const p of AUTHED_PAGES) {
      test(`${p.name} @ ${vp.name}`, async ({ page }) => {
        await page.goto(p.path);
        await shoot(page, p.name, vp.name, (p as any).mask ?? []);
      });
    }
  });

  test.describe(`admin @ ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      storageState: ADMIN_AUTH_FILE,
      reducedMotion: "reduce"
    });
    for (const p of ADMIN_PAGES) {
      test(`${p.name} @ ${vp.name}`, async ({ page }) => {
        await page.goto(p.path);
        await shoot(page, p.name, vp.name, (p as any).mask ?? []);
      });
    }
  });
}
