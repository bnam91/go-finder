/**
 * UI 설정값으로 크롤링 실행 (readline 없이)
 */
import './loadEnv.js';
import { config } from './config.js';
import { main as runCrawler } from './ytb_crawler.js';
import { main as runAnalysis } from './ytb_analysis.js';
import { getKeywordsFromSheet } from './modules/sheets.js';

/**
 * @param {Object} opts
 * @param {Object} opts.channelConfig - gotrap_config 채널 문서
 * @param {Object} opts.output - { mongo, spreadsheet, json } (0 또는 1)
 * @param {number} opts.searchTab - 1=전체, 2=Shorts, 3=동영상
 * @param {string} opts.keywordsInput - 쉼표 구분 키워드, 빈값이면 시트에서 읽음
 * @param {string|number} opts.crawlLimit - 50, 100, 200, 'max'
 * @param {string} opts.titleFilter - 'y' | 'n'
 * @param {boolean} opts.headless - true면 브라우저 창 숨김(헤드리스)
 */
export async function runCrawlWithConfig(opts) {
  const ch = opts.channelConfig;
  if (!ch) throw new Error('채널을 선택하세요.');

  config.spreadsheet = ch.channel_name;
  config.spreadsheets = { ...config.spreadsheets, [ch.channel_name]: ch.spreadsheet?.id };
  if (ch.spreadsheet?.sheets) config.sheets = { ...config.sheets, ...ch.spreadsheet.sheets };
  config.channelConfig = ch;
  config.output = [
    ['spreadsheet', opts.output?.spreadsheet ?? 0],
    ['json', opts.output?.json ?? 0],
    ['mongo', opts.output?.mongo ?? 1],
  ];
  config.searchTab = opts.searchTab ?? 3;
  config.jsonOutputPath = `./output/${ch.channel_name}/crawl-results.json`;

  const limitVal = opts.crawlLimit;
  config.crawlCount = limitVal === 'max' || limitVal === 'MAX' ? Infinity : Number(limitVal) || 100;
  config.filterByKeyword = /^y|yes|1$/i.test(String(opts.titleFilter || 'n').trim());
  config.puppeteer.headless = opts.headless ?? false;

  let keywords;
  if (opts.keywordsInput?.trim()) {
    keywords = opts.keywordsInput.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    keywords = await getKeywordsFromSheet();
  }

  if (!keywords?.length) {
    throw new Error('키워드가 없습니다. 입력하거나 시트에서 읽어오세요.');
  }

  await runCrawler(keywords);
  await runAnalysis();

  return { ok: true, keywords };
}
