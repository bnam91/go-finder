/** ISO 8601 duration(PT1M30S 등)을 초 단위로 변환 */
export function parseDurationSeconds(isoDuration) {
  if (!isoDuration || typeof isoDuration !== 'string') return null;
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const [, h, m, s] = match;
  return (parseInt(h || 0, 10) * 3600) + (parseInt(m || 0, 10) * 60) + parseInt(s || 0, 10);
}

/** Shorts는 세로(9:16) 형식, 최대 3분(180초)까지 가능 */
export function isShorts(durationSeconds) {
  return durationSeconds != null && durationSeconds <= 180;
}
