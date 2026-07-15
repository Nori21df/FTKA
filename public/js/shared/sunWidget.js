// sunWidget — pill ☀️ Sun trên topbar + popover: nhận Sun hằng ngày, mời bạn bè (+30 cả hai),
// xem quảng cáo AppLixir (+10, tối đa 5 lượt/ngày). "Sun" là tên user-facing của energy.
// Cập nhật realtime qua socket 'energy:update' (server emit sau mỗi lần cộng/trừ).

const widget = document.getElementById("sunWidget");
if (widget) init(widget);

function init(root) {
  const pill = document.getElementById("sunPill");
  const label = document.getElementById("sunLabel");
  const popover = document.getElementById("sunPopover");
  const refillNote = document.getElementById("sunRefillNote");
  const claimBtn = document.getElementById("sunClaimBtn");
  const refRow = document.getElementById("sunReferralRow");
  const refCount = document.getElementById("sunRefCount");
  const refCopyBtn = document.getElementById("sunRefCopyBtn");
  const adRow = document.getElementById("sunAdRow");
  const adLeft = document.getElementById("sunAdLeft");
  const adBtn = document.getElementById("sunAdBtn");
  const zoneId = (root.dataset.applixirZone || "").trim();
  let referralLink = "";
  let adsRemaining = 0;

  const toast = (msg, type) => { if (window.showToast) window.showToast(msg, type || "info"); };

  function render(energy) {
    if (!energy) return;
    if (energy.isUnlimitedEnergy) { label.textContent = "∞"; return; }
    const cur = energy.currentEnergy ?? energy.current_energy;
    const max = energy.maxEnergy ?? energy.max_energy;
    label.textContent = `${cur}/${max}`;
    if (refillNote && energy.refill_minutes) refillNote.textContent = `hồi 1 ☀️ / ${energy.refill_minutes} phút`;
  }

  // trạng thái ban đầu + realtime
  fetch("/api/me/energy", { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d && d.energy) render(d.energy); })
    .catch(() => {});
  if (window.io) {
    try { window.io().on("energy:update", render); } catch (_e) { /* socket lỗi thì thôi */ }
  }

  // mở/đóng popover
  pill.addEventListener("click", async () => {
    const opening = popover.hidden;
    popover.hidden = !opening;
    pill.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) loadSummary();
  });
  document.addEventListener("click", (e) => {
    if (!popover.hidden && !root.contains(e.target)) {
      popover.hidden = true;
      pill.setAttribute("aria-expanded", "false");
    }
  });

  async function loadSummary() {
    try {
      const d = await (await fetch("/api/sun/summary")).json();
      if (!d.success) return;
      referralLink = location.origin + d.referral.link;
      refCount.textContent = d.referral.rewarded;
      refRow.hidden = false;
      adsRemaining = Math.max(0, d.ads.max - d.ads.today);
      adLeft.textContent = adsRemaining;
      adRow.hidden = !zoneId; // chưa cấu hình AppLixir → ẩn
      adBtn.disabled = adsRemaining <= 0;
    } catch (_e) { /* giữ mặc định */ }
  }

  // nhận Sun hằng ngày
  claimBtn.addEventListener("click", async () => {
    claimBtn.disabled = true;
    try {
      const d = await (await fetch("/api/energy/claim-daily", { method: "POST", headers: { Accept: "application/json" } })).json();
      if (d.energy) render(d.energy);
      toast(d.success ? "Đã nhận Sun hằng ngày! ☀️" : (d.error || "Hôm nay nhận rồi — mai quay lại nhé."), d.success ? "success" : "info");
    } catch (_e) { toast("Không thể nhận Sun lúc này.", "error"); }
    claimBtn.disabled = false;
  });

  // chép link mời
  refCopyBtn.addEventListener("click", async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      toast("Đã chép link mời — gửi cho bạn bè nhé! Cả hai +30 ☀️ khi bạn ấy xác minh email.", "success");
    } catch (_e) {
      prompt("Chép link mời:", referralLink);
    }
  });

  // xem quảng cáo AppLixir → +10 Sun (server có trần 5 lượt/ngày + giãn cách 60s)
  let sdkLoading = null;
  function loadSdk() {
    if (window.invokeApplixirVideoUnit) return Promise.resolve();
    if (!sdkLoading) {
      sdkLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.applixir.com/applixir.sdk3.0m.js";
        s.onload = resolve;
        s.onerror = () => reject(new Error("Không tải được trình phát quảng cáo."));
        document.head.appendChild(s);
      });
    }
    return sdkLoading;
  }

  async function claimAdReward() {
    try {
      const res = await fetch("/api/sun/ad-reward", { method: "POST", headers: { Accept: "application/json" } });
      const d = await res.json();
      if (d.success) {
        if (d.energy) render(d.energy);
        adsRemaining = d.remaining;
        adLeft.textContent = d.remaining;
        adBtn.disabled = d.remaining <= 0;
        toast(`+${d.amount} ☀️! Hôm nay còn ${d.remaining} lượt.`, "success");
      } else {
        toast(d.error || "Không cộng được Sun.", "error");
      }
    } catch (_e) { toast("Không cộng được Sun.", "error"); }
  }

  adBtn.addEventListener("click", async () => {
    if (!zoneId || adsRemaining <= 0) return;
    adBtn.disabled = true;
    try {
      await loadSdk();
      window.invokeApplixirVideoUnit({
        zoneId,
        adStatusCb: (status) => {
          // 'ad-watched' = xem trọn quảng cáo → mới được thưởng
          if (status === "ad-watched") claimAdReward();
          else if (["ad-blocker", "network-error", "ad-unavailable", "ads-unavailable", "sys-closing"].includes(status)) {
            toast("Chưa xem xong quảng cáo nên chưa được cộng Sun.", "info");
          }
          adBtn.disabled = adsRemaining <= 0;
        },
      });
    } catch (e) {
      toast(e.message || "Không phát được quảng cáo.", "error");
      adBtn.disabled = false;
    }
  });
}
