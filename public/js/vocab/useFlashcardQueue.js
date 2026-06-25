/**
 * @typedef {Object} VocabCard
 * @property {string|number} id
 * @property {string} korean
 * @property {string} meaning_vi
 * @property {string} explanation_vi
 * @property {string} example_kr
 * @property {string} example_vi
 * @property {string} tts_text
 * @property {boolean} learned
 * @property {string} created_at
 * @property {string} source
 *
 * @typedef {Object} FlashcardProgress
 * @property {number} learned
 * @property {number} total
 * @property {number} remaining
 * @property {number} queueLength
 * @property {number} difficult
 */

export const STORAGE_KEY = 'ftka:vocab:flashcard:v2';

const normalizeId = (id) => String(id);
const unique = (ids) => [...new Set((ids || []).map(normalizeId))];
const now = () => Date.now();

function keepKnown(ids, byId) {
  return unique(ids || []).filter((id) => byId.has(id));
}

function shuffle(ids, seedOffset = 0) {
  const out = [...ids];
  let seed = (now() + seedOffset) % 2147483647;
  for (let i = out.length - 1; i > 0; i -= 1) {
    seed = (seed * 48271) % 2147483647;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function safeLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function safeSave(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}

function buildSets(cards, state) {
  const byId = new Map(cards.map((card) => [normalizeId(card.id), card]));
  const valid = (ids) => keepKnown(ids, byId);
  const learned = new Set(valid(state.learnedIds));
  cards.forEach((card) => { if (card.learned) learned.add(normalizeId(card.id)); });
  const suspended = new Set(valid(state.suspendedIds));
  return { byId, learned, suspended };
}

function activeCards(cards, state) {
  const { learned, suspended } = buildSets(cards, state);
  return cards.filter((card) => !learned.has(normalizeId(card.id)) && !suspended.has(normalizeId(card.id)));
}

function learnedCards(cards, state) {
  const { learned } = buildSets(cards, state);
  return cards.filter((card) => learned.has(normalizeId(card.id)));
}

function buildQueue(cards, state) {
  const pool = state.reviewLearned ? learnedCards(cards, state) : activeCards(cards, state);
  const byId = new Map(pool.map((card) => [normalizeId(card.id), card]));
  const valid = (ids) => keepKnown(ids, byId);
  const { learned } = buildSets(cards, state);

  const difficult = state.reviewLearned ? [] : valid(state.difficultIds).filter((id) => !learned.has(id));
  const newWords = pool.filter((card) => !difficult.includes(normalizeId(card.id))).map((card) => normalizeId(card.id));
  const base = [...difficult, ...newWords.slice(0, 8), ...shuffle(newWords.slice(8), 31)];
  const lastId = normalizeId(state.lastId || '');
  if (base.length > 1 && base[0] === lastId) base.push(base.shift());
  return unique(base);
}

export function useFlashcardQueue(initialCards) {
  const cards = initialCards.map((card) => ({ ...card, id: normalizeId(card.id), learned: Boolean(card.learned) }));
  const byId = new Map(cards.map((card) => [card.id, card]));
  let state = { learnedIds: [], difficultIds: [], suspendedIds: [], queue: [], currentId: '', lastId: '', reviewLearned: false, version: 2, ...safeLoad() };

  const validIds = new Set(cards.map((card) => card.id));
  const valid = (ids, poolById = byId) => keepKnown(ids, poolById);
  state.learnedIds = unique(state.learnedIds || []).filter((id) => validIds.has(id));
  state.difficultIds = unique(state.difficultIds || []).filter((id) => validIds.has(id));
  state.suspendedIds = unique(state.suspendedIds || []).filter((id) => validIds.has(id));
  state.reviewLearned = false;
  cards.forEach((card) => { if (card.learned && !state.learnedIds.includes(card.id)) state.learnedIds.push(card.id); });

  const normalizeActiveState = () => {
    const pool = state.reviewLearned ? learnedCards(cards, state) : activeCards(cards, state);
    const poolById = new Map(pool.map((card) => [card.id, card]));
    state.queue = valid(state.queue, poolById);
    if (!poolById.has(state.currentId)) state.currentId = '';
    if (!state.queue.length) state.queue = buildQueue(cards, state);
    if (!state.currentId) state.currentId = state.queue[0] || '';
    state.queue = valid(unique([state.currentId, ...state.queue]), poolById).filter(Boolean);
  };

  normalizeActiveState();
  safeSave(state);

  const persist = () => safeSave(state);
  const current = () => byId.get(state.currentId) || null;
  const learnedSet = () => new Set(state.learnedIds);
  const difficultSet = () => new Set(state.difficultIds);

  function advance(nextQueue = state.queue) {
    const oldCurrentId = state.currentId;
    const pool = state.reviewLearned ? learnedCards(cards, state) : activeCards(cards, state);
    const poolById = new Map(pool.map((card) => [card.id, card]));
    const q = valid(nextQueue, poolById).filter((id) => id !== oldCurrentId);
    state.lastId = oldCurrentId;
    if (!q.length) state.queue = buildQueue(cards, state).filter((id) => id !== oldCurrentId);
    else state.queue = q;
    state.currentId = state.queue[0] || '';
    persist();
  }

  function deferCurrent(cardId, offset = 3) {
    const pool = activeCards(cards, state);
    const poolById = new Map(pool.map((card) => [card.id, card]));
    const rest = valid(state.queue, poolById).filter((id) => id !== cardId);
    const insertAt = Math.min(offset, rest.length);
    rest.splice(insertAt, 0, cardId);
    state.lastId = cardId;
    state.queue = rest;
    state.currentId = state.queue[0] || '';
    persist();
  }

  async function saveLearned(id, learned) {
    const response = await fetch('/api/mark_learned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, learned })
    });
    if (!response.ok) {
      let message = 'Không thể lưu tiến độ.';
      try { const data = await response.json(); message = data.error || message; } catch (_) {}
      throw new Error(message);
    }
  }

  return {
    get card() { return current(); },
    get cards() { return cards; },
    get queue() { return [...state.queue]; },
    get reviewLearned() { return Boolean(state.reviewLearned); },
    isLearned(id) { return learnedSet().has(normalizeId(id)); },
    isDifficult(id) { return difficultSet().has(normalizeId(id)); },
    progress() {
      const learned = state.learnedIds.length;
      const activeIds = new Set(activeCards(cards, state).map((card) => card.id));
      const difficult = state.difficultIds.filter((id) => activeIds.has(id)).length;
      return { learned, total: cards.length, remaining: Math.max(0, cards.length - learned), queueLength: state.queue.length, difficult, reviewLearned: Boolean(state.reviewLearned) };
    },
    async markLearned() {
      const card = current(); if (!card) return;
      await saveLearned(card.id, true);
      state.learnedIds = unique([...state.learnedIds, card.id]);
      state.difficultIds = state.difficultIds.filter((id) => id !== card.id);
      if (!state.reviewLearned) state.queue = state.queue.filter((id) => id !== card.id);
      advance();
    },
    reviewAgain() {
      const card = current(); if (!card) return;
      if (learnedSet().has(card.id)) return advance();
      state.difficultIds = unique([card.id, ...state.difficultIds]);
      deferCurrent(card.id, 3);
    },
    skip() { advance(); },
    random() {
      const currentId = state.currentId;
      const pool = state.reviewLearned ? learnedCards(cards, state) : activeCards(cards, state);
      const poolById = new Map(pool.map((card) => [card.id, card]));
      const candidates = pool.map((card) => card.id).filter((id) => id !== currentId);
      if (!candidates.length) return;
      state.lastId = currentId;
      state.currentId = candidates[Math.floor(Math.random() * candidates.length)];
      state.queue = unique([state.currentId, ...valid(state.queue, poolById).filter((id) => id !== state.currentId)]);
      persist();
    },
    reviewLearnedWords() {
      state.reviewLearned = true;
      state.queue = buildQueue(cards, state);
      state.currentId = state.queue[0] || '';
      persist();
    },
    normalStudy() {
      state.reviewLearned = false;
      state.queue = buildQueue(cards, state);
      state.currentId = state.queue[0] || '';
      persist();
    }
  };
}
