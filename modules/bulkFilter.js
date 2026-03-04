/**
 * 벌크 크롤링 시 적용할 필터
 * - title에 한글이 없으면 제외
 * - views 200 이하 제외
 * - upload_date에 '년 전' 포함 시 제외
 */

const KOREAN_REGEX = /[가-힣]/;
const MIN_VIEWS = 201; // 200 초과 = 201 이상

/**
 * @param {Object} item - 크롤링 결과 항목
 * @returns {{ pass: boolean, reason?: string }}
 */
export function applyBulkFilter(item) {
  const title = String(item.title || '').trim();
  if (!KOREAN_REGEX.test(title)) {
    return { pass: false, reason: '제목에 한글 없음' };
  }

  const viewsNum = Number(item.views) || 0;
  if (viewsNum < MIN_VIEWS) {
    return { pass: false, reason: `views ${viewsNum} (200 이하)` };
  }

  const uploadDate = String(item.upload_date || '').trim();
  if (uploadDate.includes('년 전')) {
    return { pass: false, reason: "upload_date '년 전' 포함" };
  }

  return { pass: true };
}

/**
 * @param {Object[]} items
 * @returns {{ passed: Object[], excluded: Object[], excludedReasons: Map<string, number> }}
 */
export function filterBatch(items) {
  const passed = [];
  const excluded = [];
  const reasonCounts = new Map();

  for (const item of items) {
    const { pass, reason } = applyBulkFilter(item);
    if (pass) {
      passed.push(item);
    } else {
      excluded.push(item);
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
  }

  return { passed, excluded, reasonCounts };
}
