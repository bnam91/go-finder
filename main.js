import './loadEnv.js';
import { createInterface } from 'readline';
import { main as runCrawler } from './ytb_crawler.js';
import { main as runAnalysis } from './ytb_analysis.js';
import { getKeywordsFromSheet } from './modules/sheets.js';
import { promptRunConfig } from './utils/runConfig.js';
import { config } from './config.js';

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getKeywords() {
  const input = await ask('키워드를 입력하세요 (쉼표로 구분 시 여러 키워드, 그 외는 하나의 검색어 / 빈값이면 시트에서 읽어옵니다): ');
  if (input) {
    return input.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return await getKeywordsFromSheet();
}

promptRunConfig()
  .then((runConfig) => {
    if (!runConfig) {
      console.log('실행을 취소합니다.');
      process.exit(1);
    }
    const ch = runConfig.channelConfig;
    config.spreadsheet = runConfig.spreadsheet;
    config.spreadsheets = { ...config.spreadsheets, [runConfig.spreadsheet]: ch.spreadsheet?.id };
    if (ch.spreadsheet?.sheets) config.sheets = { ...config.sheets, ...ch.spreadsheet.sheets };
    config.channelConfig = ch;
    config.output = [
      ['spreadsheet', runConfig.output.spreadsheet],
      ['json', runConfig.output.json],
      ['mongo', runConfig.output.mongo || 0],
    ];
    config.searchTab = runConfig.searchTab;
    config.jsonOutputPath = `./output/${runConfig.spreadsheet}/crawl-results.json`;
    return getKeywords();
  })
  .then((keywords) => {
    if (!keywords.length) {
      console.log('키워드가 없습니다. 프로그램을 종료합니다.');
      process.exit(1);
    }
    return runCrawler(keywords);
  })
  .then(() => runAnalysis())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
