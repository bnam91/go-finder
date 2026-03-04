import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { appendBatchToSheet } from './sheets.js';
import { validateBatch } from './validate.js';
import { filterBatch } from './bulkFilter.js';
import { saveKeywordsToMongo, saveCrawlDatesToMongo, getChannelAlias, isMongoSupported } from './mongo.js';

/** config.output 리스트에서 해당 방식이 1인지 확인 */
export function isOutputEnabled(name) {
  const row = config.output.find(([key]) => key === name);
  return row ? row[1] === 1 : false;
}

/** config.output에 따라 스프레드시트/JSON에 배치 저장. 검수 통과한 행만 저장하고, 누락 건은 재시도 대상으로 남김 */
export async function saveBatch(dataBatch, allResults) {
  if (!dataBatch || dataBatch.length === 0) return;
  const { valid, invalid } = validateBatch(dataBatch);
  if (invalid.length > 0) {
    const missingSummary = invalid
      .slice(0, 3)
      .map(({ row, missing }) => `[${row.video_link || '?'} 누락: ${missing.join(', ')}]`)
      .join(' ');
    console.log(`[검수] ${invalid.length}건 누락 → 재시도 대상 (예: ${missingSummary}${invalid.length > 3 ? ' ...' : ''})`);
  }
  if (valid.length === 0) return;

  let toSave = valid;
  if (config.applyBulkFilter) {
    const { passed, excluded, reasonCounts } = filterBatch(valid);
    toSave = passed;
    if (excluded.length > 0) {
      const reasonStr = [...reasonCounts.entries()].map(([r, c]) => `${r}: ${c}건`).join(', ');
      console.log(`[벌크필터] ${excluded.length}건 제외 (${reasonStr})`);
    }
  }

  if (toSave.length === 0) return;
  if (isOutputEnabled('json') || isOutputEnabled('mongo')) {
    allResults.push(...toSave);
    console.log(`${toSave.length}개의 결과를 버퍼에 추가했습니다. (총 ${allResults.length}건)`);
  }
  if (isOutputEnabled('spreadsheet')) {
    await appendBatchToSheet(toSave);
  }
}

/** 파일명에 사용할 수 없는 문자 치환 */
function sanitizeForFilename(str) {
  return (str || '').replace(/[/\\:*?"<>|]/g, '_').trim() || 'unnamed';
}

/** JSON 출력 디렉터리 경로 (config.jsonOutputPath 기준) */
export function getJsonOutputDir() {
  return path.dirname(path.resolve(config.jsonOutputPath));
}

/** 수집된 결과를 키워드별 개별 JSON 파일로 저장. crawl-dates.json도 생성/갱신. MongoDB 저장도 처리 */
export async function writeJsonResults(allResults) {
  const hasData = allResults && allResults.length > 0;
  const saveJson = isOutputEnabled('json');
  const saveMongo = isOutputEnabled('mongo');

  if (!saveJson && !saveMongo) return;
  if (!hasData) return;

  const dir = getJsonOutputDir();
  const now = new Date().toISOString();

  // 키워드별 그룹화 (JSON, MongoDB 공통)
  const byKeyword = {};
  for (const item of allResults) {
    const kw = item.keyword || '(키워드없음)';
    if (!byKeyword[kw]) byKeyword[kw] = [];
    byKeyword[kw].push(item);
  }

  const crawlDates = {};
  for (const kw of Object.keys(byKeyword)) {
    crawlDates[kw] = now;
  }

  // MongoDB 저장 (MongoDB 지원 채널 선택 시)
  if (saveMongo && isMongoSupported(config.spreadsheet)) {
    await saveKeywordsToMongo(allResults, config.spreadsheet);
    await saveCrawlDatesToMongo(crawlDates, config.spreadsheet);
  }

  // JSON 파일 저장
  if (saveJson) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const written = [];
    for (const [kw, items] of Object.entries(byKeyword)) {
      const safeName = sanitizeForFilename(kw) + '.json';
      const filePath = path.join(dir, safeName);
      fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf8');
      written.push(safeName);
    }
    console.log(`\n총 ${allResults.length}건의 결과를 키워드별 파일로 저장했습니다: ${written.join(', ')}`);

    const crawlDatesPath = path.join(dir, 'crawl-dates.json');
    let fileDoc = { channel_name: config.spreadsheet, channel_alias: getChannelAlias(config.spreadsheet), keyword: {} };
    if (fs.existsSync(crawlDatesPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(crawlDatesPath, 'utf8'));
        fileDoc = { ...fileDoc, ...parsed, keyword: { ...(parsed.keyword || {}), ...crawlDates } };
      } catch (_) {
        fileDoc.keyword = { ...crawlDates };
      }
    } else {
      fileDoc.keyword = { ...crawlDates };
    }
    fs.writeFileSync(crawlDatesPath, JSON.stringify(fileDoc, null, 2), 'utf8');
    console.log(`크롤링 날짜를 기록했습니다: ${crawlDatesPath}`);
  }
}
