export function ProgressBar(progress) {
  const pct = progress.total ? Math.round((progress.learned / progress.total) * 100) : 0;
  return `
    <section class="anki-progress-card" aria-label="Tiến độ học từ vựng">
      <div class="anki-progress-summary">
        <div><span class="anki-progress-kicker">Tiến độ phiên học</span><strong>${pct}% hoàn thành</strong></div>
        <span class="anki-progress-count">${progress.learned}/${progress.total}</span>
      </div>
      <div class="anki-progress-track" role="progressbar" aria-valuenow="${progress.learned}" aria-valuemin="0" aria-valuemax="${progress.total}" aria-label="${pct}% hoàn thành"><span class="anki-progress-fill" style="width:${pct}%"></span></div>
      <div class="anki-progress-stats">
        <span><b>${progress.learned}</b><small>Đã học</small></span>
        <span><b>${progress.remaining}</b><small>Còn lại</small></span>
        <span><b>${progress.difficult}</b><small>Cần ôn</small></span>
      </div>
    </section>`;
}
