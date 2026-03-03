/**
 * 크롤링 결과 검수: 필수 필드 누락 여부 확인, valid/invalid 분리
 */

/** 시트에 쓸 때 필수로 채워져 있어야 하는 필드 */
export const REQUIRED_FIELDS = [
  'keyword',
  'thumbnail',
  'video_link',
  'title',
  'channel_name',
  'views',
  'upload_date',
  'duration',
  'channel_id',
];

/**
 * 한 행 검수
 * @param {Object} row - 크롤링된 한 건
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateRow(row) {
  if (!row || typeof row !== 'object') {
    return { valid: false, missing: [...REQUIRED_FIELDS] };
  }
  const missing = REQUIRED_FIELDS.filter((key) => {
    const v = row[key];
    return v == null || (typeof v === 'string' && v.trim() === '');
  });
  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * 배치 검수 후 valid / invalid 분리
 * @param {Object[]} batch - 크롤링 결과 배열
 * @returns {{ valid: Object[], invalid: { row: Object, missing: string[] }[] }}
 */
export function validateBatch(batch) {
  if (!Array.isArray(batch) || batch.length === 0) {
    return { valid: [], invalid: [] };
  }
  const valid = [];
  const invalid = [];
  for (const row of batch) {
    const { valid: ok, missing } = validateRow(row);
    if (ok) {
      valid.push(row);
    } else {
      invalid.push({ row, missing });
    }
  }
  return { valid, invalid };
}
