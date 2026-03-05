/**
 * YouTube channel info scraper
 * Reads channel IDs from Google Sheet (input!I2:I), scrapes channel/about and channel/videos,
 * writes results to output sheet with English headers.
 *
 * Usage: node channel-analysis/youtube-channel-scraper.js [output] [input] [dev]
 *
 * Output: mongo | sheet | all (기본: all)
 * Input:  from_sheet | from_mongo (기본: from_sheet)
 *   - from_sheet: input 시트 I열에서 channel_id 읽기
 *   - from_mongo: gotrap_keywords_* 컬렉션 선택 → distinct channel_id (이미 분석된 채널 스킵)
 *
 * 예: npm run channel-analysis from_mongo                    # MongoDB 컬렉션에서 입력
 *     npm run channel-analysis mongo from_mongo workers=5    # 5개 병렬 워커
 *     npm run channel-analysis from_mongo refresh            # 이미 분석된 채널 최신화
 *
 * 병렬 시: gotrap_output_*에 status(대기중/작업중/완료), workerId 표시. workers=N
 */
import '../loadEnv.js';
import { createInterface } from 'readline';
import puppeteer from 'puppeteer';
import { google } from 'googleapis';
import {
  saveChannelAnalysisToMongo,
  closeMongoClient,
  listGotrapKeywordCollections,
  getChannelIdsFromKeywordsCollection,
  getAnalyzedChannelIds,
  getOutputCollectionFromSource,
  seedChannelQueue,
  claimChannel,
  completeChannel,
  releaseChannel,
} from '../modules/mongo.js';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

const args = process.argv.slice(2);
const DEV_MODE = args.includes('dev');
const REFRESH_MODE = args.includes('refresh');
const outputMode = args.find((a) => ['mongo', 'sheet', 'all'].includes(a)) || 'all';
const fromMode = args.find((a) => ['from_sheet', 'from_mongo'].includes(a)) || 'from_sheet';
const workersArg = args.find((a) => /^workers?=\d+$/i.test(a) || /^--workers?=\d+$/i.test(a));
const WORKERS = workersArg ? parseInt(workersArg.split('=').pop(), 10) : 1;
const OUTPUT_SPREADSHEET = outputMode === 'sheet' || outputMode === 'all';
const OUTPUT_MONGO = outputMode === 'mongo' || outputMode === 'all';
const FROM_SHEET = fromMode === 'from_sheet';
const FROM_MONGO = fromMode === 'from_mongo';

function askStep(question) {
  if (!DEV_MODE) return Promise.resolve();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n[DEV] ${question} (엔터로 다음 진행) `, () => {
      rl.close();
      resolve();
    });
  });
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer?.trim() || '');
    });
  });
}

const SPREADSHEET_ID = '1cSYDxR_QwgWM7qeJwQSZBfB7ZQ9mSBkberjYZKinys0';

const AUTH_PATH = '~Documents/github_cloud/module_auth/auth.js';
const resolvedAuthPath = AUTH_PATH.replace(
  /^~Documents/,
  path.join(os.homedir(), 'Documents'),
);
const { getCredentials } = await import(pathToFileURL(resolvedAuthPath).href);

async function getChannelIdsFromSheet() {
  const auth = await getCredentials();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'input!I2:I',
  });
  const values = res.data.values || [];
  if (!values.length) {
    console.log('No data found in the spreadsheet.');
    return [];
  }
  return values.filter((row) => row && row[0]).map((row) => String(row[0]).trim());
}

/** MongoDB gotrap_keywords_* 컬렉션에서 채널 ID 로드. refresh면 이미 분석된 채널도 포함(최신화) */
async function getChannelIdsFromMongo() {
  const collections = await listGotrapKeywordCollections();
  if (!collections.length) {
    console.log('gotrap_keywords_* 접두어 컬렉션이 없습니다.');
    return { channelIds: [], sourceCollection: null };
  }

  console.log('\n[gotrap_keywords_* 컬렉션 목록]');
  collections.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));

  const answer = await ask('\n번호 입력 (또는 컬렉션명 직접 입력): ');
  let selected = collections[parseInt(answer, 10) - 1];
  if (!selected && collections.includes(answer)) selected = answer;
  if (!selected) {
    console.log('유효한 선택이 아닙니다.');
    return { channelIds: [], sourceCollection: null };
  }

  const allIds = await getChannelIdsFromKeywordsCollection(selected);
  const outputColl = getOutputCollectionFromSource(selected);
  let channelIds = [...new Set(allIds)];

  if (!REFRESH_MODE) {
    const analyzed = await getAnalyzedChannelIds(outputColl);
    channelIds = channelIds.filter((id) => !analyzed.has(id));
    console.log(`\n${selected} → ${outputColl}: 전체 ${allIds.length}개, 스킵 ${allIds.length - channelIds.length}개 → 처리 ${channelIds.length}개`);
  } else {
    console.log(`\n${selected} → ${outputColl}: [refresh] 전체 ${channelIds.length}개 최신화`);
  }
  return { channelIds, sourceCollection: selected };
}

function waitAndFindElement(page, selector, timeout = 20000) {
  return page
    .waitForSelector(selector, { timeout })
    .then(() => page.$(selector))
    .catch(() => {
      console.log(`Element not found: ${selector}`);
      return null;
    });
}

function cleanText(text, removeWords = []) {
  let result = text;
  for (const word of removeWords) {
    result = result.replace(word, '');
  }
  return result.trim();
}

function extractEmail(text) {
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/;
  const match = text.match(emailRegex);
  return match ? match[0] : '';
}

function convertSubscribers(subs) {
  if (subs === '정보 없음' || !subs) return 0;
  if (subs.includes('만명')) {
    return Math.floor(parseFloat(subs.replace('만명', '')) * 10000);
  }
  if (subs.includes('천명')) {
    return Math.floor(parseFloat(subs.replace('천명', '')) * 1000);
  }
  return parseInt(subs.replace('명', '').replace(/,/g, ''), 10) || 0;
}

function convertViews(views) {
  if (!views || views === '없음') return 0;
  let v = views.replace('조회수 ', '').replace('회', '').replace(/,/g, '');
  if (v.includes('만')) {
    return Math.floor(parseFloat(v.replace('만', '')) * 10000);
  }
  if (v.includes('천')) {
    return Math.floor(parseFloat(v.replace('천', '')) * 1000);
  }
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

function checkEmail(email) {
  if (!email) return 'NULL';
  if (email.endsWith('@naver.com') || email.endsWith('@gmail.com')) return 'TRUE';
  return 'FALSE';
}

function buildMongoDoc(channelInfo, videosInfo) {
  const subs = convertSubscribers(channelInfo.subscribers);
  const doc = {
    channelId: channelInfo.channelId,
    channelName: channelInfo.channelName || '',
    channelDescription: channelInfo.channelDescription || '',
    subscribers: subs,
    subscriberCondition: subs >= 200 && subs <= 50000,
    totalVideos: channelInfo.videoCount || '',
    totalViews: channelInfo.viewCount || '',
    joinDate: channelInfo.joinDate || '',
    email: channelInfo.email || '',
    naverGmail: checkEmail(channelInfo.email),
    // channelUrl: `https://www.youtube.com/${channelInfo.channelId || ''}`,
  };
  for (let i = 0; i < 3; i++) {
    const v = videosInfo[i] || {};
    doc[`recentVideo${i + 1}Title`] = v.title || '';
    doc[`recentVideo${i + 1}PublishDate`] = v.uploadTime || '';
    doc[`recentVideo${i + 1}Views`] = convertViews(v.views);
  }
  return doc;
}

async function getChannelInfo(page, channelId) {
  const baseUrl = 'https://www.youtube.com/';
  const aboutUrl = `${baseUrl}${channelId}/about`;
  const videosUrl = `${baseUrl}${channelId}/videos`;

  try {
    // About page
    console.log(`[Step] About 페이지 이동: ${aboutUrl}`);
    await page.goto(aboutUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));
    await askStep(`About 페이지(${aboutUrl})가 로드됐습니까?`);

    let channelDescription = '정보 없음';
    const descEl = await waitAndFindElement(page, '#description-container');
    if (descEl) {
      channelDescription = await page.evaluate((el) => el.textContent.trim(), descEl);
    }
    const email = extractEmail(channelDescription);
    if (DEV_MODE) console.log(`[DEV] 채널 소개 추출: ${channelDescription.slice(0, 80)}...`);
    await askStep('채널 소개/이메일 추출 완료. 확인했습니까?');

    const infoElements = await page.$$('td.style-scope.ytd-about-channel-renderer');
    let subscribers = '정보 없음';
    let videoCount = '정보 없음';
    let viewCount = '정보 없음';
    let joinDate = '정보 없음';

    for (const el of infoElements) {
      const text = await page.evaluate((e) => e.textContent.trim(), el);
      if (text.includes('구독자')) subscribers = cleanText(text, ['구독자']);
      else if (text.includes('동영상')) videoCount = cleanText(text, ['동영상', '개']);
      else if (text.includes('조회수')) viewCount = cleanText(text, ['조회수', '회']);
      else if (text.includes('가입일')) joinDate = cleanText(text, ['가입일:']);
    }
    if (DEV_MODE) console.log(`[DEV] 구독자: ${subscribers}, 영상수: ${videoCount}, 조회수: ${viewCount}, 가입일: ${joinDate}`);
    await askStep('About 페이지 정보(구독자/영상수 등) 확인했습니까?');

    // Videos page
    console.log(`[Step] Videos 페이지 이동: ${videosUrl}`);
    await page.goto(videosUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 4000));
    await askStep(`Videos 페이지(${videosUrl})가 로드됐습니까?`);

    // 채널 헤더 로드 대기 (2025 신규: yt-page-header-view-model / 구형: ytd-channel-name)
    await page
      .waitForSelector('h1.dynamicTextViewModelH1, yt-page-header-renderer, ytd-channel-name', { timeout: 15000 })
      .catch(() => null);
    await askStep('채널 헤더(ytd-channel-name 등) 로드 대기 완료. 확인했습니까?');

    // YouTube channel name selectors (2025년 신규 레이아웃: yt-page-header-view-model)
    const channelNameSelectors = [
      'h1.dynamicTextViewModelH1 span',
      'yt-dynamic-text-view-model.yt-page-header-view-model__page-header-title span',
      '.yt-page-header-view-model__page-header-title span',
      'ytd-channel-name a',
      'ytd-channel-name yt-formatted-string',
      '#channel-name yt-formatted-string',
    ];

    let channelName = null;
    for (const selector of channelNameSelectors) {
      const nameEl = await page.$(selector).catch(() => null);
      if (nameEl) {
        const text = await page.evaluate((el) => el?.textContent?.trim(), nameEl);
        if (text) {
          channelName = text;
          if (DEV_MODE) console.log(`[DEV] 채널명 발견! 셀렉터: "${selector}" → "${channelName}"`);
          break;
        }
      } else if (DEV_MODE) {
        console.log(`[DEV] 셀렉터 실패: "${selector}"`);
      }
    }
    if (DEV_MODE && !channelName) console.log('[DEV] 모든 채널명 셀렉터 실패');
    await askStep(channelName ? `채널명 "${channelName}" 추출됐습니까?` : '채널명을 찾지 못했습니다. 페이지 DOM을 확인해보세요.');

    if (!channelName) {
      return { error: 'Channel name not found' };
    }

    const videoItems = await page.$$('div#dismissible.style-scope.ytd-rich-grid-media');
    if (DEV_MODE) console.log(`[DEV] 비디오 목록 요소 ${videoItems.length}개 발견`);
    const videosInfo = [];

    for (let i = 0; i < Math.min(3, videoItems.length); i++) {
      const item = videoItems[i];
      try {
        const titleEl = await item.$('#video-title');
        const title = titleEl ? await page.evaluate((el) => el.textContent.trim(), titleEl) : '';

        const metaSpans = await item.$$('#metadata-line span.inline-metadata-item');
        const videoViewCount = metaSpans[0]
          ? await page.evaluate((el) => el.textContent.trim(), metaSpans[0])
          : '정보 없음';
        const uploadTime = metaSpans[1]
          ? await page.evaluate((el) => el.textContent.trim(), metaSpans[1])
          : '정보 없음';

        videosInfo.push({
          title,
          views: videoViewCount,
          uploadTime,
        });
      } catch {
        // skip
      }
    }
    if (DEV_MODE) console.log(`[DEV] 최근 영상 ${videosInfo.length}개 추출 완료`);
    await askStep('최근 영상 정보 추출 완료. 확인했습니까?');

    return {
      channelName,
      channelDescription,
      email,
      subscribers,
      videoCount,
      viewCount,
      joinDate,
      channelId,
      videosInfo,
    };
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

async function updateSheetWithResult(channelInfo, videosInfo, sheets, isFirstRun) {
  const headers = [
    'Channel Name',
    'Channel Description',
    'Subscribers',
    'Subscriber Condition',
    'Total Videos',
    'Total Views',
    'Join Date',
    'Email',
    'Naver/Gmail',
    'Recent Video 1 Title',
    'Recent Video 1 Publish Date',
    'Recent Video 1 Views',
    'Recent Video 2 Title',
    'Recent Video 2 Publish Date',
    'Recent Video 2 Views',
    'Recent Video 3 Title',
    'Recent Video 3 Publish Date',
    'Recent Video 3 Views',
    'Channel URL',
  ];

  const rowData = [
    channelInfo.channelName || '',
    channelInfo.channelDescription || '',
    convertSubscribers(channelInfo.subscribers),
    '', // formula will be set below
    channelInfo.videoCount || '',
    channelInfo.viewCount || '',
    channelInfo.joinDate || '',
    channelInfo.email || '',
    checkEmail(channelInfo.email),
  ];

  for (let i = 0; i < 3; i++) {
    if (i < videosInfo.length) {
      rowData.push(
        videosInfo[i].title || '',
        videosInfo[i].uploadTime || '',
        convertViews(videosInfo[i].views)
      );
    } else {
      rowData.push('', '', '');
    }
  }

  rowData.push(`https://www.youtube.com/${channelInfo.channelId || ''}`);

  if (isFirstRun) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'output!A:S',
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'output!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'output!A:A',
  });
  const nextRow = (res.data.values || []).length + 1;
  rowData[3] = `=AND(C${nextRow} >= 200, C${nextRow} <= 50000)`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `output!A${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowData] },
  });
}

/** 병렬 워커: MongoDB 큐에서 대기중 → 작업중 → 완료 */
async function runParallelWorkers(outputColl, sourceCollection) {
  const headless = !DEV_MODE; // 개발모드일 때만 브라우저 표시
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  async function worker(workerId) {
    const browser = await puppeteer.launch({
      headless,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    let processed = 0;
    let errors = 0;
    try {
      const page = await browser.newPage();
      await page.setUserAgent(userAgent);

      while (true) {
        const claimed = await claimChannel(outputColl, workerId);
        if (!claimed?.channelId) break;

        const channelId = claimed.channelId;
        const result = await getChannelInfo(page, channelId);

        if (result.error) {
          console.log(`[${workerId}] 실패 ${channelId}: ${result.error}`);
          await releaseChannel(outputColl, channelId);
          errors++;
        } else {
          const { videosInfo, ...channelInfo } = result;
          const mongoDoc = buildMongoDoc(channelInfo, videosInfo);
          await completeChannel(outputColl, channelId, mongoDoc, sourceCollection);
          processed++;
          console.log(`[${workerId}] 완료 ${channelId} (${channelInfo.channelName})`);
        }

        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500));
      }
      return { processed, errors };
    } finally {
      await browser.close();
    }
  }

  console.log(`\n[병렬] ${WORKERS}개 워커 시작. 큐: ${outputColl}\n`);
  const results = await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => worker(`w${i + 1}`))
  );
  const total = results.reduce((a, r) => a + r.processed, 0);
  const totalErrors = results.reduce((a, r) => a + r.errors, 0);
  console.log(`\n[병렬 완료] 처리 ${total}개, 실패 ${totalErrors}개`);
}

async function main() {
  if (DEV_MODE) {
    console.log('\n========== 개발모드: 단계별로 엔터를 눌러 진행합니다 ==========\n');
  }
  console.log(
    `[Input] ${fromMode}, [Output] ${outputMode}, [Refresh] ${REFRESH_MODE}, [Workers] ${WORKERS}\n`
  );

  let channelIds = [];
  let sourceCollection = null;

  if (FROM_SHEET) {
    console.log('[Step 1] input 시트에서 채널 ID 로드 중...');
    channelIds = await getChannelIdsFromSheet();
  } else {
    console.log('[Step 1] MongoDB gotrap_keywords_* 컬렉션에서 채널 ID 로드 중...');
    const result = await getChannelIdsFromMongo();
    channelIds = result.channelIds;
    sourceCollection = result.sourceCollection;
  }

  if (!channelIds.length) {
    console.log('처리할 채널 ID가 없습니다.');
    if (FROM_MONGO || OUTPUT_MONGO) await closeMongoClient();
    return;
  }
  console.log(`[Step 1] 채널 ID ${channelIds.length}개: ${channelIds.slice(0, 5).join(', ')}${channelIds.length > 5 ? '...' : ''}`);
  await askStep('채널 ID 목록 확인했습니까?');

  // 병렬 모드: from_mongo + output mongo + workers > 1 (시트 저장은 병렬 미지원)
  if (FROM_MONGO && OUTPUT_MONGO && WORKERS > 1) {
    if (OUTPUT_SPREADSHEET) console.log('[참고] 병렬 모드에서는 output 시트 저장이 되지 않습니다. mongo만 저장됩니다.\n');
    const outputColl = getOutputCollectionFromSource(sourceCollection);
    const seeded = await seedChannelQueue(outputColl, channelIds);
    console.log(`[큐 시드] ${seeded}개 대기중으로 등록\n`);
    await runParallelWorkers(outputColl, sourceCollection);
    await closeMongoClient();
    return;
  }

  // 단일 브라우저 순차 처리
  const auth = await getCredentials();
  const sheets = google.sheets({ version: 'v4', auth });
  let isFirstRun = true;
  const errorLog = [];

  console.log('[Step 2] 브라우저 실행 중...');
  const browser = await puppeteer.launch({
    headless: !DEV_MODE, // 개발모드일 때만 브라우저 표시
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  await askStep('브라우저가 켜졌습니까?');

  try {
    console.log('[Step 3] 새 페이지 생성 및 User-Agent 설정...');
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await askStep('페이지 준비 완료. 채널 크롤링 시작할까요?');

    for (let i = 0; i < channelIds.length; i++) {
      const channelId = channelIds[i];
      console.log(`\n[Step ${4 + i}] Processing: ${i + 1}/${channelIds.length} - Channel ID: ${channelId}`);
      await askStep(`채널 "${channelId}" 크롤링 시작할까요?`);

      const result = await getChannelInfo(page, channelId);

      if (result.error) {
        const errMsg = `Channel ID ${channelId}: ${result.error}`;
        console.log(`Failed to get channel info. ${errMsg}`);
        errorLog.push(errMsg);
      } else {
        const { videosInfo, ...channelInfo } = result;
        console.log('\nChannel info:');
        Object.entries(channelInfo).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
        console.log('\nRecent videos:');
        videosInfo.forEach((v, j) => {
          console.log(`  ${j + 1}. Title: ${v.title}`);
          console.log(`     Views: ${v.views}`);
          console.log(`     Upload: ${v.uploadTime}`);
        });

        if (OUTPUT_SPREADSHEET) {
          await updateSheetWithResult(channelInfo, videosInfo, sheets, isFirstRun);
          console.log(`\nChannel ID ${channelId} result updated to spreadsheet.`);
        }
        if (OUTPUT_MONGO) {
          const mongoDoc = buildMongoDoc(channelInfo, videosInfo);
          await saveChannelAnalysisToMongo(mongoDoc, sourceCollection, { upsert: REFRESH_MODE });
        }
        isFirstRun = false;
      }

      if (i < channelIds.length - 1) {
        const waitTime = 1000 + Math.random() * 3000;
        console.log(`\nWaiting ${(waitTime / 1000).toFixed(2)}s before next channel...`);
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }

    console.log('\nAll channels processed.');

    if (errorLog.length) {
      console.log('\nErrors:');
      errorLog.forEach((e) => console.log(e));
    } else {
      console.log('\nAll channel info processed without errors.');
    }
  } finally {
    await browser.close();
    if (FROM_MONGO || OUTPUT_MONGO) await closeMongoClient();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
