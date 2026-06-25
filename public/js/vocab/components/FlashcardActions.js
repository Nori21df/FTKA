export function FlashcardActions(flipped) {
  const gated = flipped ? '' : 'disabled aria-disabled="true"';
  return `
    <div class="anki-actions ${flipped ? 'is-visible' : ''}" aria-label="Thao tác học">
      <button type="button" class="anki-action-btn is-learned" data-action="learned" ${gated}>
        <span class="material-icons-outlined" aria-hidden="true">check_circle</span><span><strong>Đã học</strong><small></small></span><kbd>A</kbd>
      </button>
      <button type="button" class="anki-action-btn is-review" data-action="review" ${gated}>
        <span class="material-icons-outlined" aria-hidden="true">refresh</span><span><strong>Ôn lại</strong><small></small></span><kbd>R</kbd>
      </button>
      <button type="button" class="anki-action-btn" data-action="skip">
        <span class="material-icons-outlined" aria-hidden="true">skip_next</span><span><strong>Bỏ qua</strong><small></small></span><kbd>S</kbd>
      </button>
      <button type="button" class="anki-action-btn" data-action="random">
        <span class="material-icons-outlined" aria-hidden="true">casino</span><span><strong>Ngẫu nhiên</strong><small></small></span><kbd>D</kbd>
      </button>
    </div>`;
}
