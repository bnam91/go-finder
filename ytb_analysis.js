import './loadEnv.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { isOutputEnabled, getJsonOutputDir } from './modules/output.js';
import {
  getChannelIdColumnFromSheet,
  writeSubscriberCountsToSheet,
  getViewsAndFollowersFromSheet,
  writeVPFToSheet,
} from './modules/sheets.js';
import { loadKeywordsFromMongo, replaceKeywordsInMongo, isMongoSupported } from './modules/mongo.js';

const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

/** 채널 ID/핸들 정규화 (동일 채널 중복 API 호출 방지) */
function normalizeChannelKey(id) {
  return (id || '').trim().replace(/^@/, '');
}

/**
 * /c/xxx, /user/xxx 형식을 search API로 채널 ID로 변환
 */
async function resolveChannelIdBySearch(raw, apiKey) {
  const searchUrl = new URL(YOUTUBE_SEARCH_URL);
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('type', 'channel');
  searchUrl.searchParams.set('q', raw.includes('/') ? raw : `youtube.com/${raw}`);
  searchUrl.searchParams.set('key', apiKey);
  const res = await fetch(searchUrl.toString());
  const data = await res.json();
  if (!res.ok || !data?.items?.length) return null;
  return data.items[0].id?.channelId || null;
}

/**
 * 채널 ID로 구독자 수 조회 (YouTube Data API v3 channels.list, part=statistics)
 * @param {string} [channelId] - 채널 ID (없으면 process.env.CHANNEL_ID 사용)
 * @returns {Promise<{ subscriberCount: string } | null>} 구독자 수 정보 또는 null
 */
export async function fetchSubscriberCount(channelId) {
  const id = channelId ?? process.env.CHANNEL_ID;
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!id) {
    throw new Error('채널 ID가 없습니다. 인자로 넘기거나 CHANNEL_ID 환경변수를 설정하세요.');
  }
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const raw = (id || '').trim().replace(/^@/, '');
  let channelIdToUse = raw;

  // /c/xxx, /user/xxx 형식이면 search로 채널 ID resolve
  if (/^(c|user)\//i.test(raw)) {
    const resolved = await resolveChannelIdBySearch(raw, apiKey);
    if (resolved) channelIdToUse = resolved;
  }

  const url = new URL(YOUTUBE_CHANNELS_URL);
  url.searchParams.set('part', 'statistics');
  const isChannelId = /^UC[\w-]{22}$/.test(channelIdToUse);
  if (isChannelId) {
    url.searchParams.set('id', channelIdToUse);
  } else {
    url.searchParams.set('forHandle', channelIdToUse.replace(/^@/, ''));
  }
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message ?? data?.error?.errors?.[0]?.reason ?? res.statusText;
    throw new Error(`YouTube API 오류: ${msg}`);
  }

  if (!data?.items?.length) {
    return null; // 잘못된 채널 ID 또는 비공개
  }

  const { statistics } = data.items[0];
  return {
    subscriberCount: statistics.subscriberCount ?? '0',
  };
}

/** fetchSubscriberCount 래퍼 - 실패 시 null 반환, 배치 중단 방지 */
async function fetchSubscriberCountSafe(key) {
  try {
    const result = await fetchSubscriberCount(key);
    return result ? result.subscriberCount : '';
  } catch (err) {
    console.warn(`[구독자 조회 실패] ${key}: ${err.message}`);
    return '';
  }
}

/**
 * 채널 ID를 받으면 콘솔에 구독자 수 출력.
 * 인자가 없으면 channel_id 시트 I열을 읽어 고유 채널만 API 호출 후 J열에 구독자 수 기록.
 */
export async function main(channelId) {
  const id = channelId ?? process.env.CHANNEL_ID ?? process.argv[2];

  if (id) {
    try {
      const result = await fetchSubscriberCount(id);
      if (!result) {
        console.log('해당 채널을 찾을 수 없거나 비공개입니다.');
        return;
      }
      const count = Number(result.subscriberCount);
      const formatted = count.toLocaleString('ko-KR');
      console.log(`구독자 수: ${formatted}`);
    } catch (err) {
      console.error(err.message);
      throw err;
    }
    return;
  }

  // 인자 없음 → JSON 또는 시트에 구독자 수·VPF 추가
  try {
    if (!process.env.YOUTUBE_API_KEY && (isOutputEnabled('json') || isOutputEnabled('mongo') || isOutputEnabled('spreadsheet'))) {
      console.warn('[구독자 수] YOUTUBE_API_KEY가 설정되지 않았습니다. .env에 추가하면 followers를 채울 수 있습니다.');
    }
    // JSON 저장이 활성화된 경우: 키워드별 JSON 파일에 followers, vpf 추가
    if (isOutputEnabled('json')) {
      const dir = getJsonOutputDir();
      if (!fs.existsSync(dir)) return;

      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'crawl-dates.json');
      if (files.length === 0) return;

      const allItems = [];
      const fileContents = new Map(); // filePath -> items

      for (const file of files) {
        const filePath = path.join(dir, file);
        let items = [];
        try {
          const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          items = Array.isArray(raw) ? raw : Object.values(raw).flat();
        } catch (_) {
          continue;
        }
        if (items.length === 0) continue;
        fileContents.set(filePath, items);
        allItems.push(...items);
      }

      if (allItems.length === 0) return;

      const uniqueKeys = [];
      const seen = new Set();
      for (const item of allItems) {
        const key = normalizeChannelKey(item.channel_id);
        if (key && !seen.has(key)) {
          seen.add(key);
          uniqueKeys.push(key);
        }
      }

      const countByKey = new Map();
      for (const item of allItems) {
        const key = normalizeChannelKey(item.channel_id);
        if (key && item.followers && String(item.followers).trim()) {
          countByKey.set(key, String(item.followers).trim());
        }
      }
      for (const key of uniqueKeys) {
        if (!countByKey.has(key)) {
          countByKey.set(key, await fetchSubscriberCountSafe(key));
        }
      }

      for (const [filePath, items] of fileContents) {
        for (const item of items) {
          const key = normalizeChannelKey(item.channel_id);
          item.followers = key ? countByKey.get(key) ?? '' : '';
          const v = Number(item.views) || 0;
          const f = Number(item.followers) || 0;
          item.vpf = f === 0 ? '' : ((v / f) * 100).toFixed(2);
        }
        fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf8');
      }
      console.log(`총 ${allItems.length}건의 JSON에 구독자 수 및 VPF를 추가했습니다.`);
    }

    // MongoDB 저장이 활성화된 경우: MongoDB에서 로드 → followers/vpf 추가 → 저장
    if (isOutputEnabled('mongo') && isMongoSupported(config.spreadsheet)) {
      const allItems = await loadKeywordsFromMongo(config.spreadsheet);
      if (allItems.length > 0) {
        const uniqueKeys = [];
        const seen = new Set();
        for (const item of allItems) {
          const key = normalizeChannelKey(item.channel_id);
          if (key && !seen.has(key)) {
            seen.add(key);
            uniqueKeys.push(key);
          }
        }

        const countByKey = new Map();
        for (const item of allItems) {
          const key = normalizeChannelKey(item.channel_id);
          if (key && item.followers && String(item.followers).trim()) {
            countByKey.set(key, String(item.followers).trim());
          }
        }
        for (const key of uniqueKeys) {
          if (!countByKey.has(key)) {
            countByKey.set(key, await fetchSubscriberCountSafe(key));
          }
        }

        for (const item of allItems) {
          const key = normalizeChannelKey(item.channel_id);
          item.followers = key ? countByKey.get(key) ?? '' : '';
          const v = Number(item.views) || 0;
          const f = Number(item.followers) || 0;
          item.vpf = f === 0 ? '' : ((v / f) * 100).toFixed(2);
        }

        const byKeyword = {};
        for (const item of allItems) {
          const kw = item.keyword || '(키워드없음)';
          if (!byKeyword[kw]) byKeyword[kw] = [];
          byKeyword[kw].push(item);
        }
        await replaceKeywordsInMongo(byKeyword, config.spreadsheet);
        console.log(`총 ${allItems.length}건의 MongoDB 데이터에 구독자 수 및 VPF를 추가했습니다.`);
      }
    }

    // 시트 저장이 활성화된 경우: channel_id 시트 I열 읽어 J열(구독자), K열(VPF) 쓰기
    if (isOutputEnabled('spreadsheet')) {
      const [{ channelIdsPerRow, rowCount }, { followersPerRow = [] }] = await Promise.all([
        getChannelIdColumnFromSheet(),
        getViewsAndFollowersFromSheet(),
      ]);
      if (rowCount === 0) {
        if (!isOutputEnabled('json') && !isOutputEnabled('mongo')) {
          console.log('사용법: node ytb_analysis.js <채널ID 또는 @핸들>  예: node ytb_analysis.js @ITSUB');
          console.log('또는 channel_id 시트 I열에 채널 ID를 넣은 뒤 main.js 또는 ytb_analysis.js를 실행하세요.');
        }
        return;
      }

      const uniqueKeys = [];
      const seen = new Set();
      for (const raw of channelIdsPerRow) {
        const key = normalizeChannelKey(raw);
        if (key && !seen.has(key)) {
          seen.add(key);
          uniqueKeys.push(key);
        }
      }

      const countByKey = new Map();
      for (let i = 0; i < channelIdsPerRow.length; i++) {
        const key = normalizeChannelKey(channelIdsPerRow[i]);
        const existing = followersPerRow[i];
        if (key && existing && String(existing).trim()) {
          countByKey.set(key, String(existing).trim());
        }
      }
      for (const key of uniqueKeys) {
        if (!countByKey.has(key)) {
          countByKey.set(key, await fetchSubscriberCountSafe(key));
        }
      }

      const countsPerRow = channelIdsPerRow.map((raw) => {
        const key = normalizeChannelKey(raw);
        return key ? countByKey.get(key) ?? '' : '';
      });

      await writeSubscriberCountsToSheet(countsPerRow);

      const { viewsPerRow, followersPerRow: followersAfterWrite, rowCount: vpfRowCount } =
        await getViewsAndFollowersFromSheet();
      if (vpfRowCount > 0) {
        const vpfPerRow = viewsPerRow.map((views, i) => {
          const followers = followersAfterWrite[i];
          const v = Number(views) || 0;
          const f = Number(followers) || 0;
          if (f === 0) return '';
          return ((v / f) * 100).toFixed(2);
        });
        await writeVPFToSheet(vpfPerRow);
      }
    }
  } catch (err) {
    console.error(err.message);
    throw err;
  }
}

// 이 파일을 직접 실행했을 때만 main() 실행 (node ytb_analysis.js [채널ID])
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
