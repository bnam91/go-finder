/**
 * cd /Users/a1/github/dev_youtube && node scripts/subscriptions.js '@잘사는김대리'
 */

/**
 * YouTube Data API v3 - 구독 목록 조회
 * - 공개 구독: API 키만으로 조회
 * - 비공개 구독: OAuth 2.0 필요 (--oauth 옵션)
 */
import { google } from 'googleapis';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

const YOUTUBE_SUBSCRIPTIONS_URL = 'https://www.googleapis.com/youtube/v3/subscriptions';

async function fetchWithApiKey(channelId, maxResults) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY 환경변수가 설정되지 않았습니다.');

  const all = [];
  let pageToken = null;

  do {
    const url = new URL(YOUTUBE_SUBSCRIPTIONS_URL);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('channelId', channelId);
    url.searchParams.set('maxResults', String(Math.min(maxResults - all.length, 50)));
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (!res.ok) {
      const code = data?.error?.code;
      const reason = data?.error?.errors?.[0]?.reason;
      if (code === 403 && (reason === 'subscriptionForbidden' || reason === 'forbidden')) {
        const err = new Error('구독 목록이 비공개입니다. --oauth 옵션으로 실행하세요.');
        err.needOAuth = true;
        throw err;
      }
      const msg = data?.error?.message ?? data?.error?.errors?.[0]?.reason ?? res.statusText;
      throw new Error(`YouTube API 오류: ${msg}`);
    }

    const items = data?.items ?? [];
    all.push(...items);
    pageToken = data?.nextPageToken ?? null;
  } while (pageToken && all.length < maxResults);

  return all.slice(0, maxResults);
}

async function fetchWithOAuth(channelId, maxResults) {
  const AUTH_PATH = '~Documents/github_cloud/module_auth/auth.js';
  const resolvedPath = AUTH_PATH.replace(/^~Documents/, path.join(os.homedir(), 'Documents'));
  const { getCredentials } = await import(pathToFileURL(resolvedPath).href);

  const auth = await getCredentials();
  const youtube = google.youtube({ version: 'v3', auth });

  const all = [];
  let pageToken = null;

  do {
    const res = await youtube.subscriptions.list({
      part: ['snippet'],
      channelId,
      maxResults: Math.min(maxResults - all.length, 50),
      pageToken: pageToken || undefined,
    });

    const items = res.data?.items ?? [];
    all.push(...items);
    pageToken = res.data?.nextPageToken ?? null;
  } while (pageToken && all.length < maxResults);

  return all.slice(0, maxResults);
}

/**
 * @param {string} channelId - 채널 ID
 * @param {number} maxResults - 최대 개수
 * @param {{ useOAuth?: boolean }} [opts] - useOAuth: true면 OAuth 사용 (비공개 구독용)
 */
export async function fetchSubscriptionList(channelId, maxResults = 50, opts = {}) {
  if (opts.useOAuth) {
    return fetchWithOAuth(channelId, maxResults);
  }

  try {
    return await fetchWithApiKey(channelId, maxResults);
  } catch (err) {
    if (err.needOAuth) throw err;
    throw err;
  }
}
