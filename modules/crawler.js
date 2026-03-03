import { config } from '../config.js';
import { validateRow } from './validate.js';

/** 페이지의 비디오 요소 개수 (ytd-video-renderer = title-wrapper 부모) */
export async function getDomVideoCount(page) {
  const count = await page.evaluate(() => {
    const els = document.querySelectorAll('ytd-video-renderer');
    return els.length;
  });
  return count;
}

/** 스크롤 후 기본 대기 */
export function scrollPage(page) {
  return page.keyboard.press('End').then(() => new Promise((r) => setTimeout(r, config.crawl.scrollWaitMs)));
}

/** 스크롤 후 DOM 안정화 대기: 새 콘텐츠 로드 후 개수가 2회 연속 같을 때까지 대기 */
export async function waitForDomStable(page, previousDomCount) {
  const pollMs = config.crawl.domStablePollMs ?? 1500;
  const maxPolls = config.crawl.domStableMaxPolls ?? 6;
  let prevCount = 0;

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    const currentCount = await getDomVideoCount(page);
    if (prevCount > 0 && currentCount === prevCount) return currentCount;
    prevCount = currentCount;
  }
  return prevCount;
}

/** '조회수 2.3천회', '조회수 1.5만회', '조회수 345회' 등 → 숫자(정수)로 변환 */
function parseViewsToNumber(viewsStr) {
  if (!viewsStr || typeof viewsStr !== 'string') return '';
  const trimmed = viewsStr.trim();
  const withUnit = trimmed.match(/([\d.]+)\s*(천|만)/);
  if (withUnit) {
    const num = parseFloat(withUnit[1]);
    if (withUnit[2] === '천') return String(Math.round(num * 1000));
    if (withUnit[2] === '만') return String(Math.round(num * 10000));
  }
  const plain = trimmed.match(/([\d,]+)\s*회/);
  if (plain) return plain[1].replace(/,/g, '');
  return trimmed;
}

/** 채널 href에서 채널 ID/핸들 추출 (/channel/UCxxx, /@handle, /c/custom 등) */
function extractChannelIdFromHref(href) {
  if (!href || typeof href !== 'string') return '';
  const clean = href.replace(/\/$/, '').trim();
  const match = clean.match(/\/(channel\/UC[\w-]{22}|@[^/]+|c\/[^/]+|user\/[^/]+)(?:\/|$)/i);
  if (match) {
    const part = match[1];
    if (part.startsWith('channel/')) return part.slice(8);
    if (part.startsWith('@')) return part;
    return part; // /c/xxx, /user/xxx → 그대로 반환 (API에서 search로 resolve 시도)
  }
  return clean.split('/').pop() || '';
}

/** 상대 경로를 YouTube 전체 URL로 변환 */
function toFullWatchUrl(href) {
  if (!href) return '';
  const url = href.startsWith('http') ? href : `https://www.youtube.com${href.startsWith('/') ? href : '/' + href}`;
  try {
    const u = new URL(url);
    const v = u.searchParams.get('v');
    return v ? `https://www.youtube.com/watch?v=${v}` : url;
  } catch {
    return url;
  }
}

export async function processElement(element, keyword) {
  try {
    const thumbnailLinkEl = await element.$('a#thumbnail');
    if (!thumbnailLinkEl) return null;
    const watchHref = await thumbnailLinkEl.evaluate((el) => el.getAttribute('href'));
    if (!watchHref) return null;
    const videoLink = toFullWatchUrl(watchHref);

    const thumbnailImgEl = await element.$('#thumbnail img');
    const thumbnail = thumbnailImgEl
      ? await thumbnailImgEl.evaluate((el) => el.getAttribute('src') || '')
      : '';

    const titleEl = await element.$('#video-title');
    if (!titleEl) return null;
    const title = await titleEl.evaluate((el) => el.getAttribute('title'));
    if (!title) return null;

    const channelEl = await element.$('#channel-info #text-container yt-formatted-string a');
    const channelName = channelEl ? await channelEl.evaluate((el) => el.textContent.trim()) : '';

    const metaBlocks = await element.$$('span.inline-metadata-item');
    const viewsRaw = metaBlocks[0] ? await metaBlocks[0].evaluate((el) => el.textContent.trim()) : '';
    const views = parseViewsToNumber(viewsRaw);
    const uploadDate = metaBlocks[1] ? await metaBlocks[1].evaluate((el) => el.textContent.trim()) : '';

    const durationBadgeEl = await element.$('ytd-thumbnail .yt-badge-shape__text');
    let duration = durationBadgeEl
      ? await durationBadgeEl.evaluate((el) => el.textContent.trim()) || ''
      : '';
    if (!duration) {
      const videoTitleLink = await element.$('a#video-title');
      const ariaLabel = videoTitleLink ? await videoTitleLink.evaluate((el) => el.getAttribute('aria-label')) : null;
      if (ariaLabel) {
        const fullMatch = ariaLabel.match(/(\d+)분\s*(\d+)초/);
        const shortMatch = ariaLabel.match(/(\d+)초/);
        if (fullMatch) duration = `${fullMatch[1]}:${fullMatch[2].padStart(2, '0')}`;
        else if (shortMatch) duration = `0:${shortMatch[1].padStart(2, '0')}`;
      }
    }
    if (!duration) duration = 'Shorts';

    let channelLinkEl = await element.$('#channel-info ytd-channel-name a');
    if (!channelLinkEl) {
      channelLinkEl = await element.$('a[href*="/channel/"], a[href*="/@"], a[href*="/c/"]');
    }
    const channelHref = channelLinkEl ? await channelLinkEl.evaluate((el) => el.getAttribute('href')) : null;
    const channelId = channelHref ? extractChannelIdFromHref(channelHref) : '';

    return {
      keyword,
      thumbnail,
      video_link: videoLink,
      title,
      channel_name: channelName,
      views,
      upload_date: uploadDate,
      duration,
      channel_id: channelId,
    };
  } catch (e) {
    console.log(`${keyword}: 데이터 추출 중 오류 발생 - ${e.message}`);
    return null;
  }
}

export async function crawlDataStream(page, keyword, processedLinks) {
  const elements = await page.$$('#dismissible');
  const newData = [];

  for (const element of elements) {
    try {
      const thumb = await element.$('a#thumbnail');
      if (!thumb) continue;
      const href = await thumb.evaluate((el) => el.getAttribute('href'));
      if (!href) continue;
      const videoLink = toFullWatchUrl(href);
      if (processedLinks.has(videoLink)) continue;

      const data = await processElement(element, keyword);
      if (!data || !data.title) continue;
      if (config.filterByKeyword && !data.title.includes(keyword)) {
        processedLinks.add(videoLink);
        continue;
      }
      const { valid } = validateRow(data);
      if (valid) {
        newData.push(data);
        processedLinks.add(videoLink);
      }
      // invalid면 processedLinks에 넣지 않아 다음 스크롤에서 재시도됨
    } catch (e) {
      console.log(`${keyword}: 요소 처리 중 오류 발생 - ${e.message}`);
    }
  }
  return newData;
}
