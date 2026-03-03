/**
 * 영상별 조회수 분석: 평균 조회수 계산 및 평균보다 높은 영상 식별
 */
function getViewCounts(videos, detailsMap) {
  return videos
    .map((item) => {
      const videoId = item.snippet?.resourceId?.videoId;
      const viewCount = detailsMap.get(videoId)?.viewCount;
      return viewCount != null ? viewCount : null;
    })
    .filter((v) => v != null);
}

/**
 * 평균 조회수와 평균 이상인 영상 videoId 목록 반환
 * @param {Array} videos - playlistItems
 * @param {Map} detailsMap - Map<videoId, { viewCount }>
 * @returns {{ average: number, aboveAverage: Set<string> }}
 */
export function analyzeViewCounts(videos, detailsMap) {
  const viewCounts = getViewCounts(videos, detailsMap);
  const average = viewCounts.length ? viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length : 0;
  const aboveAverage = new Set();

  videos.forEach((item) => {
    const videoId = item.snippet?.resourceId?.videoId;
    const viewCount = detailsMap.get(videoId)?.viewCount;
    if (viewCount != null && viewCount > average) {
      aboveAverage.add(videoId);
    }
  });

  return { average, aboveAverage };
}
