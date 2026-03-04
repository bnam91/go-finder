/**
 * Electron 앱 없이 바로 크롤링 실행
 * 채널: 비빔면_더블루, 탭: Shorts, 크롤링수: 200, 제목필터: 아니오, 저장: MongoDB
 * followers API 미사용, 벌크 필터(한글/views>200/년 전 제외) 선택 적용
 *
 * 사용법:
 *   node crawl-standalone.js              # 채널 시트 A열에서 키워드 읽음
 *   node crawl-standalone.js a            # 키워드 시트 A열에서 읽음
 *   node crawl-standalone.js b            # 키워드 시트 B열에서 읽음
 *   node crawl-standalone.js a b          # A열+B열 병렬 크롤링
 *   node crawl-standalone.js a b c        # A+B+C열 병렬 (3개 이상 가능)
 *   node crawl-standalone.js 키워드1,키워드2   # 키워드 직접 지정
 */
import './loadEnv.js';
import { createInterface } from 'readline';
import { config } from './config.js';
import { main as runCrawler } from './ytb_crawler.js';
import { getKeywordsFromSheet, getKeywordsFromSpreadsheetByColumn } from './modules/sheets.js';
import { getChannels } from './utils/channelConfig.js';
import { closeMongoClient } from './modules/mongo.js';
import { writeJsonResults } from './modules/output.js';

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const CHANNEL_NAME = '비빔면_더블루';
const SEARCH_TAB = 2; // Shorts
const CRAWL_COUNT = 100;
const FILTER_BY_KEYWORD = false; // 아니오
const OUTPUT_MONGO = 1;

/** 칼럼별 키워드 그룹 시트 (환경변수 STANDALONE_KEYWORD_SPREADSHEET_ID로 변경 가능) */
const KEYWORD_SPREADSHEET_ID = process.env.STANDALONE_KEYWORD_SPREADSHEET_ID || '1cSYDxR_QwgWM7qeJwQSZBfB7ZQ9mSBkberjYZKinys0';
const KEYWORD_SHEET_NAME = process.env.STANDALONE_KEYWORD_SHEET || 'keywords';

async function getChannelConfig() {
  const channels = await getChannels();
  const ch = channels.find((c) => c.channel_name === CHANNEL_NAME);
  if (!ch) {
    throw new Error(
      `채널 '${CHANNEL_NAME}'이(가) gotrap_config에 없습니다. Electron 앱에서 먼저 채널을 추가해주세요.`
    );
  }
  return ch;
}

/** 인자가 시트 열 지정인지 확인 (a-z 또는 0-25, A열=인덱스0) */
function parseColumnArg(arg) {
  if (!arg || typeof arg !== 'string') return null;
  const s = arg.trim().toLowerCase();
  if (s.length === 1 && s >= 'a' && s <= 'z') return s;
  const num = parseInt(s, 10);
  if (Number.isInteger(num) && num >= 0 && num <= 25) return String.fromCharCode(97 + num);
  return null;
}

/** 단일 열 또는 직접 지정 키워드 */
async function getKeywords(arg) {
  const colLetter = parseColumnArg(arg);
  if (colLetter) {
    const keywords = await getKeywordsFromSpreadsheetByColumn(KEYWORD_SPREADSHEET_ID, colLetter, KEYWORD_SHEET_NAME);
    console.log(`키워드 시트 ${colLetter.toUpperCase()}열에서 ${keywords.length}개 로드`);
    return keywords;
  }
  if (arg?.trim() && arg.includes(',')) {
    return arg.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (arg?.trim()) {
    return [arg.trim()];
  }
  return await getKeywordsFromSheet();
}

/** 병렬 모드: argv[2]부터 열 문자가 2개 이상인지 확인. [{ arg, colLetter }, ...] */
function getParallelColumns() {
  const args = process.argv.slice(2);
  const cols = [];
  const seen = new Set();
  for (const arg of args) {
    const col = parseColumnArg(arg);
    if (col && !seen.has(col)) {
      seen.add(col);
      cols.push({ arg, colLetter: col });
    }
  }
  return cols.length >= 2 ? cols : null;
}

async function main() {
  const parallelCols = getParallelColumns();
  const isParallel = !!parallelCols;

  console.log(`\n--- 크롤링 실행 (채널: ${CHANNEL_NAME}, 탭: Shorts, 수: ${CRAWL_COUNT}${isParallel ? ', 병렬: ' + parallelCols.map((c) => c.colLetter.toUpperCase() + '열').join('+') : ''}) ---\n`);

  const ch = await getChannelConfig();

  const filterInput = await ask('필터조건을 크롤링시에 적용할까요? (한글제목/views>200/년 전 제외) [y/n, 기본: n]: ');
  config.applyBulkFilter = /^y|yes|1$/i.test(filterInput || 'n');

  config.spreadsheet = ch.channel_name;
  config.spreadsheets = { ...config.spreadsheets, [ch.channel_name]: ch.spreadsheet?.id };
  if (ch.spreadsheet?.sheets) config.sheets = { ...config.sheets, ...ch.spreadsheet.sheets };
  config.channelConfig = ch;
  config.output = [
    ['spreadsheet', 0],
    ['json', 0],
    ['mongo', OUTPUT_MONGO],
  ];
  config.searchTab = SEARCH_TAB;
  config.crawlCount = CRAWL_COUNT;
  config.filterByKeyword = FILTER_BY_KEYWORD;
  config.jsonOutputPath = `./output/${ch.channel_name}/crawl-results.json`;
  config.puppeteer.headless = process.env.HEADLESS === 'true';
  config.skipFollowersApi = true; // standalone에서는 followers API 미사용

  if (isParallel) {
    const keywordsList = await Promise.all(parallelCols.map(({ arg }) => getKeywords(arg)));
    const hasAny = keywordsList.some((kw) => kw?.length);
    if (!hasAny) {
      throw new Error('키워드가 없습니다. 지정한 열에 스프레드시트에 등록해주세요.');
    }
    parallelCols.forEach(({ colLetter }, i) => {
      const kw = keywordsList[i];
      console.log(`[${colLetter.toUpperCase()}열] 키워드: ${kw?.length ? kw.join(', ') : '(없음)'}`);
    });
    console.log(`벌크필터: ${config.applyBulkFilter ? '적용' : '미적용'}\n`);

    const results = await Promise.all(
      keywordsList.map((keywords, i) =>
        keywords?.length
          ? runCrawler(keywords, { skipSave: true, label: `${parallelCols[i].colLetter.toUpperCase()}열` })
          : Promise.resolve([])
      )
    );
    const merged = results.flat();
    if (merged.length > 0) {
      await writeJsonResults(merged);
    }
    console.log(`\n병렬 크롤링 완료. 총 ${merged.length}건 저장.`);
  } else {
    const keywords = await getKeywords(process.argv[2]);
    if (!keywords?.length) {
      throw new Error('키워드가 없습니다. 인자로 전달하거나 스프레드시트에 등록해주세요.');
    }
    console.log(`키워드: ${keywords.join(', ')}`);
    console.log(`벌크필터: ${config.applyBulkFilter ? '적용' : '미적용'}\n`);

    await runCrawler(keywords);
  }

  await closeMongoClient(); // 쓰기 플러시 후 연결 종료 (프로세스 조기 종료 방지)
  console.log('\n크롤링 완료.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
