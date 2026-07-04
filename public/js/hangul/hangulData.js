// Bảng chữ cái Hangul — dữ liệu tĩnh cho trang /hangul.
// example = âm tiết mẫu để phát âm qua TTS (đọc jamo trần TTS thường không chuẩn).
export const CONSONANTS = [
    { jamo: 'ㄱ', name: '기역', roman: 'g/k', example: '가' },
    { jamo: 'ㄴ', name: '니은', roman: 'n', example: '나' },
    { jamo: 'ㄷ', name: '디귿', roman: 'd/t', example: '다' },
    { jamo: 'ㄹ', name: '리을', roman: 'r/l', example: '라' },
    { jamo: 'ㅁ', name: '미음', roman: 'm', example: '마' },
    { jamo: 'ㅂ', name: '비읍', roman: 'b/p', example: '바' },
    { jamo: 'ㅅ', name: '시옷', roman: 's', example: '사' },
    { jamo: 'ㅇ', name: '이응', roman: 'ng/-', example: '아' },
    { jamo: 'ㅈ', name: '지읒', roman: 'j', example: '자' },
    { jamo: 'ㅊ', name: '치읓', roman: 'ch', example: '차' },
    { jamo: 'ㅋ', name: '키읔', roman: 'k', example: '카' },
    { jamo: 'ㅌ', name: '티읕', roman: 't', example: '타' },
    { jamo: 'ㅍ', name: '피읖', roman: 'p', example: '파' },
    { jamo: 'ㅎ', name: '히읗', roman: 'h', example: '하' }
];

export const DOUBLE_CONSONANTS = [
    { jamo: 'ㄲ', name: '쌍기역', roman: 'kk', example: '까' },
    { jamo: 'ㄸ', name: '쌍디귿', roman: 'tt', example: '따' },
    { jamo: 'ㅃ', name: '쌍비읍', roman: 'pp', example: '빠' },
    { jamo: 'ㅆ', name: '쌍시옷', roman: 'ss', example: '싸' },
    { jamo: 'ㅉ', name: '쌍지읒', roman: 'jj', example: '짜' }
];

export const VOWELS = [
    { jamo: 'ㅏ', name: '아', roman: 'a', example: '아' },
    { jamo: 'ㅑ', name: '야', roman: 'ya', example: '야' },
    { jamo: 'ㅓ', name: '어', roman: 'eo', example: '어' },
    { jamo: 'ㅕ', name: '여', roman: 'yeo', example: '여' },
    { jamo: 'ㅗ', name: '오', roman: 'o', example: '오' },
    { jamo: 'ㅛ', name: '요', roman: 'yo', example: '요' },
    { jamo: 'ㅜ', name: '우', roman: 'u', example: '우' },
    { jamo: 'ㅠ', name: '유', roman: 'yu', example: '유' },
    { jamo: 'ㅡ', name: '으', roman: 'eu', example: '으' },
    { jamo: 'ㅣ', name: '이', roman: 'i', example: '이' }
];

export const COMPOUND_VOWELS = [
    { jamo: 'ㅐ', name: '애', roman: 'ae', example: '애' },
    { jamo: 'ㅒ', name: '얘', roman: 'yae', example: '얘' },
    { jamo: 'ㅔ', name: '에', roman: 'e', example: '에' },
    { jamo: 'ㅖ', name: '예', roman: 'ye', example: '예' },
    { jamo: 'ㅘ', name: '와', roman: 'wa', example: '와' },
    { jamo: 'ㅙ', name: '왜', roman: 'wae', example: '왜' },
    { jamo: 'ㅚ', name: '외', roman: 'oe', example: '외' },
    { jamo: 'ㅝ', name: '워', roman: 'wo', example: '워' },
    { jamo: 'ㅞ', name: '웨', roman: 'we', example: '웨' },
    { jamo: 'ㅟ', name: '위', roman: 'wi', example: '위' },
    { jamo: 'ㅢ', name: '의', roman: 'ui', example: '의' }
];

export const ALL_JAMO = [...CONSONANTS, ...DOUBLE_CONSONANTS, ...VOWELS, ...COMPOUND_VOWELS];

// Sinh bộ câu hỏi quiz: cho jamo → chọn romanization đúng trong 4 lựa chọn.
// rng cho phép truyền hàm ngẫu nhiên (test truyền deterministic).
export function buildQuiz(count = 10, rng = Math.random) {
    const pool = [...ALL_JAMO].sort(() => rng() - 0.5).slice(0, Math.min(count, ALL_JAMO.length));
    return pool.map((item) => {
        const wrong = ALL_JAMO.filter((x) => x.roman !== item.roman)
            .sort(() => rng() - 0.5).slice(0, 3).map((x) => x.roman);
        const options = [...wrong, item.roman].sort(() => rng() - 0.5);
        return { jamo: item.jamo, name: item.name, example: item.example, correct: item.roman, options };
    });
}
