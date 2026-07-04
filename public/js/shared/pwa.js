// Đăng ký service worker cho PWA (cả trang public lẫn app). Im lặng nếu không hỗ trợ.
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
}
