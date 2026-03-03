import puppeteer from 'puppeteer';
import { config } from './config.js';
import { clearChannelIdSheet, writeHeaderToSheet } from './modules/sheets.js';
import { scrollPage, crawlDataStream, waitForDomStable, getDomVideoCount } from './modules/crawler.js';
import { isOutputEnabled, saveBatch, writeJsonResults, getJsonOutputDir } from './modules/output.js';

export async function main(keywords) {
  if (!keywords || keywords.length === 0) {
    throw new Error('키워드가 없습니다.');
  }

  const crawlCount = config.crawlCount ?? 100;
  console.log(`필터: ${config.filterByKeyword ? '제목에 키워드 포함만' : '검색결과 전체'}`);

  const tabMap = { 1: '전체', 2: 'Shorts', 3: '동영상' };
  const tabLabel = tabMap[config.searchTab] || '동영상';
  console.log(`선택된 탭: ${tabLabel} (searchTab=${config.searchTab})`);

  const browser = await puppeteer.launch({
    headless: config.puppeteer.headless,
    args: config.puppeteer.args,
    defaultViewport: null,
  });

  const allResults = [];

  if (isOutputEnabled('spreadsheet')) {
    await clearChannelIdSheet();
    await writeHeaderToSheet();
  }
  if (isOutputEnabled('json')) {
    console.log(`크롤링 결과를 키워드별 JSON으로 저장합니다: ${getJsonOutputDir()}/`);
  }
  if (isOutputEnabled('mongo')) {
    console.log('크롤링 결과를 MongoDB에 저장합니다.');
  }
  if (!isOutputEnabled('spreadsheet') && !isOutputEnabled('json') && !isOutputEnabled('mongo')) {
    console.log('경고: output에서 spreadsheet, json, mongo가 모두 0입니다. 결과가 저장되지 않습니다.');
  }
  const page = await browser.newPage();

  for (const keyword of keywords) {
    const encodedKeyword = encodeURIComponent(keyword);
    const url = `https://www.youtube.com/results?search_query=${encodedKeyword}`;
    await page.goto(url, { waitUntil: 'networkidle2' });

    try {
      const clicked = await page.evaluate((label) => {
        const chips = document.querySelectorAll('#chips yt-chip-cloud-chip-renderer');
        for (const chip of chips) {
          const textEl =
            chip.querySelector('.ytChipShapeTextContent') ||
            chip.querySelector('.ytChipShapeChip') ||
            chip.querySelector('.ytChipShapeChip div');
          const text = textEl ? textEl.textContent.trim() : '';
          if (text === label) {
            const btn = chip.querySelector('button');
            if (btn) {
              btn.click();
              return true;
            }
            chip.click();
            return true;
          }
        }
        return false;
      }, tabLabel);
      if (!clicked) throw new Error(`'${tabLabel}' 탭을 찾을 수 없음`);
      await new Promise((r) => setTimeout(r, config.crawl.tabWaitMs));
      console.log(`${keyword}: '${tabLabel}' 탭으로 이동 완료`);
    } catch (e) {
      console.log(`${keyword}: 오류 발생 - ${e.message}`);
      continue;
    }

    const processedLinks = new Set();
    let currentBatch = [];
    let totalProcessed = 0;
    let noNewDataCount = 0;
    let previousLength = 0;
    let domCountBeforeScroll = 0;

    while (true) {
      const newData = await crawlDataStream(page, keyword, processedLinks);

      for (const item of newData) {
        currentBatch.push(item);
        if (currentBatch.length >= config.batchSize) {
          await saveBatch(currentBatch.slice(0, config.batchSize), allResults);
          currentBatch = currentBatch.slice(config.batchSize);
        }
      }

      totalProcessed += newData.length;
      const domCount = await getDomVideoCount(page);
      console.log(`${keyword}: 현재 ${totalProcessed}개 크롤링 (DOM 비디오 ${domCount}개)`);

      if (totalProcessed === previousLength) {
        noNewDataCount += 1;
        if (noNewDataCount >= config.crawl.noNewDataLimit) break;
      } else {
        noNewDataCount = 0;
      }
      previousLength = totalProcessed;

      if (crawlCount !== Infinity && totalProcessed >= crawlCount) {
        const remaining = crawlCount - (totalProcessed - currentBatch.length);
        if (remaining > 0) {
          await saveBatch(currentBatch.slice(0, remaining), allResults);
        }
        break;
      }

      domCountBeforeScroll = domCount;
      await scrollPage(page);
      await waitForDomStable(page, domCountBeforeScroll);

      if (currentBatch.length > 0) {
        await saveBatch(currentBatch, allResults);
        currentBatch = [];
      }
    }

    const dests = [];
    if (isOutputEnabled('spreadsheet')) dests.push('시트');
    if (isOutputEnabled('json') || isOutputEnabled('mongo')) dests.push('버퍼');
    const dest = dests.length ? dests.join(', ') + '에' : '저장 안 함';
    console.log(`\n${keyword}: 총 ${totalProcessed}개의 Shorts 데이터를 크롤링하여 ${dest} 추가했습니다.`);
  }

  if (config.devMode !== 1) {
    await browser.close();
  } else {
    console.log('\n[devMode] 크롬 창을 유지합니다. 수동으로 닫아주세요.');
  }
  await writeJsonResults(allResults);
}
