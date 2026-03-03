import { parseDurationSeconds, isShorts } from '../utils/duration.js';

const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const YOUTUBE_PLAYLIST_ITEMS_URL = 'https://www.googleapis.com/youtube/v3/playlistItems';
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

export async function fetchChannelInfo(handleOrId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const raw = (handleOrId || '').trim().replace(/^@/, '');
  if (!raw) {
    throw new Error('채널 핸들/ID를 입력하세요 (예: @잘사는김대리)');
  }

  const url = new URL(YOUTUBE_CHANNELS_URL);
  url.searchParams.set('part', 'snippet,statistics,contentDetails');
  const isChannelId = /^UC[\w-]{22}$/.test(raw);
  if (isChannelId) {
    url.searchParams.set('id', raw);
  } else {
    url.searchParams.set('forHandle', raw);
  }
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message ?? data?.error?.errors?.[0]?.reason ?? res.statusText;
    throw new Error(`YouTube API 오류: ${msg}`);
  }

  if (!data?.items?.length) {
    return null;
  }

  return data.items[0];
}

/** videoId 배열에 대해 duration, 조회수 조회. 반환: Map<videoId, { duration, viewCount }> */
export async function fetchVideoDetails(videoIds) {
  if (!videoIds.length) return new Map();
  const apiKey = process.env.YOUTUBE_API_KEY;
  const url = new URL(YOUTUBE_VIDEOS_URL);
  url.searchParams.set('part', 'contentDetails,statistics');
  url.searchParams.set('id', videoIds.join(','));
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok || !data?.items) return new Map();

  const map = new Map();
  for (const item of data.items) {
    const id = item.id;
    const duration = parseDurationSeconds(item?.contentDetails?.duration);
    const viewCount = Number(item?.statistics?.viewCount ?? 0);
    map.set(id, { duration, viewCount });
  }
  return map;
}

/** Shorts 제외, 최근 동영상만 최대 maxResults개 반환. { items, detailsMap } */
export async function fetchRecentVideosExcludingShorts(uploadsPlaylistId, maxResults = 8) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const results = [];
  const detailsMap = new Map();
  let pageToken = null;

  while (results.length < maxResults) {
    const url = new URL(YOUTUBE_PLAYLIST_ITEMS_URL);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('playlistId', uploadsPlaylistId);
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message ?? data?.error?.errors?.[0]?.reason ?? res.statusText;
      throw new Error(`YouTube API 오류: ${msg}`);
    }
    const items = data?.items ?? [];
    if (!items.length) break;

    const videoIds = items.map((v) => v.snippet?.resourceId?.videoId).filter(Boolean);
    const batchDetails = await fetchVideoDetails(videoIds);
    for (const [id, d] of batchDetails) detailsMap.set(id, d);

    for (const item of items) {
      if (results.length >= maxResults) break;
      const videoId = item.snippet?.resourceId?.videoId;
      const { duration } = detailsMap.get(videoId) ?? {};
      if (!isShorts(duration)) {
        results.push(item);
      }
    }

    pageToken = data.nextPageToken ?? null;
    if (!pageToken) break;
  }

  return { items: results.slice(0, maxResults), detailsMap };
}
