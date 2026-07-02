import { defineConfig } from "@playwright/test";

// Lưới an toàn visual cho refactor frontend (docs/REFACTOR_NOTES.md).
// Server dev tự khởi động (hoặc dùng lại nếu đang chạy sẵn trên :3000).
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/global-setup.ts",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixelRatio: 0.001
    }
  },
  use: {
    baseURL: "http://localhost:3000",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    colorScheme: "light"
  },
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: true,
    timeout: 30_000
  }
});
