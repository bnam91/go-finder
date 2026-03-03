import { google } from 'googleapis';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';
import { config } from '../config.js';

const AUTH_PATH = '~Documents/github_cloud/module_auth/auth.js';
const resolvedAuthPath = AUTH_PATH.replace(
  /^~Documents/,
  path.join(os.homedir(), 'Documents'),
);
const { getCredentials } = await import(pathToFileURL(resolvedAuthPath).href);

function getSelectedSpreadsheet() {
  const alias = config.spreadsheet;
  const spreadsheetId = config.spreadsheets?.[alias];
  if (!spreadsheetId) {
    console.log(`스프레드시트 별칭 '${alias}'을(를) 찾을 수 없습니다. config.spreadsheets를 확인하세요.`);
    return null;
  }
  return { alias, spreadsheetId };
}

/** 채널 ID를 기록할 스프레드시트 (config.spreadsheet로 선택된 하나) */
function getChannelIdTargets() {
  const selected = getSelectedSpreadsheet();
  return selected ? [{ spreadsheetId: selected.spreadsheetId, alias: selected.alias }] : [];
}

/** 시트가 없으면 생성 */
async function ensureSheetExists(sheets, spreadsheetId, sheetTitle, alias) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title,sheets.properties.sheetId',
  });
  const exists = (meta.data.sheets || []).some(
    (s) => (s.properties?.title || '').trim() === sheetTitle.trim(),
  );
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetTitle } } }],
    },
  });
  console.log(`${alias ? `'${alias}' ` : ''}'${sheetTitle}' 시트가 없어 새로 생성했습니다.`);
}

export function getKeywordsFromSheet() {
  const selected = getSelectedSpreadsheet();
  if (!selected) return Promise.resolve([]);
  const { alias, spreadsheetId } = selected;
  return getCredentials().then(async (auth) => {
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${config.sheets.keyword}!A:A`,
    });
    const values = res.data.values || [];

    if (values.length === 0) {
      console.log(`스프레드시트('${alias}')에서 키워드를 찾을 수 없습니다.`);
      return [];
    }
    return values.filter((row) => row && row[0]).map((row) => row[0]);
  });
}

export function clearChannelIdSheet() {
  return getCredentials().then(async (auth) => {
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetTitle = config.sheets.channelId;
    const range = `${sheetTitle}!A:Z`;
    for (const { spreadsheetId, alias } of getChannelIdTargets()) {
      await ensureSheetExists(sheets, spreadsheetId, sheetTitle, alias);
      await sheets.spreadsheets.values.clear({ spreadsheetId, range });
      const label = alias ? `'${alias}' ` : '';
      console.log(`${label}'${sheetTitle}' 시트의 내용이 모두 지워졌습니다.`);
    }
  });
}

export function writeHeaderToSheet() {
  return getCredentials().then(async (auth) => {
    const sheets = google.sheets({ version: 'v4', auth });
    const header = [
      [
        'keyword',
        'thumbnail',
        'video_link',
        'title',
        'channel_name',
        'views',
        'upload_date',
        'duration',
        'channel_id',
      ],
    ];
    const range = `${config.sheets.channelId}!A1`;
    const body = { valueInputOption: 'RAW', requestBody: { values: header } };
    for (const { spreadsheetId, alias } of getChannelIdTargets()) {
      await sheets.spreadsheets.values.update({ spreadsheetId, range, ...body });
      const label = alias ? `'${alias}' ` : '';
      console.log(`${label}헤더가 'channel_id' 시트에 작성되었습니다.`);
    }
  });
}

export function appendBatchToSheet(dataBatch) {
  if (!dataBatch || dataBatch.length === 0) return Promise.resolve();

  return getCredentials().then(async (auth) => {
    const sheets = google.sheets({ version: 'v4', auth });
    const values = dataBatch.map((row) => Object.values(row));
    const range = `${config.sheets.channelId}!A1`;
    const body = {
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    };
    for (const { spreadsheetId, alias } of getChannelIdTargets()) {
      await sheets.spreadsheets.values.append({ spreadsheetId, range, ...body });
      const label = alias ? `'${alias}' ` : '';
      console.log(`${label}${dataBatch.length}개의 결과가 'channel_id' 시트에 추가되었습니다.`);
    }
  });
}

/** channel_id 시트에서 I열(채널 ID) 읽기. 헤더 제외 데이터만 반환 */
export function getChannelIdColumnFromSheet() {
  const selected = getSelectedSpreadsheet();
  if (!selected) return Promise.resolve({ channelIdsPerRow: [], rowCount: 0 });
  const { spreadsheetId, alias } = selected;
  return getCredentials().then(async (auth) => {
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetTitle = config.sheets.channelId;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetTitle}!I:I`,
    });
    const rows = res.data.values || [];
    const channelIdsPerRow = rows.slice(1).map((row) => (row[0] != null ? String(row[0]).trim() : ''));
    return { channelIdsPerRow, rowCount: channelIdsPerRow.length };
  });
}

/** channel_id 시트 J열에 헤더(followers) + 구독자 수 일괄 쓰기. values[0] = 2행, values[1] = 3행, ... */
export function writeSubscriberCountsToSheet(countsPerRow) {
  if (!countsPerRow || countsPerRow.length === 0) return Promise.resolve();
  return getCredentials().then(async (auth) => {
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetTitle = config.sheets.channelId;
    const dataRows = countsPerRow.map((c) => [c === '' || c == null ? '' : String(c)]);
    const values = [['followers'], ...dataRows];
    const range = `${sheetTitle}!J1:J${values.length}`;
    const body = { valueInputOption: 'RAW', requestBody: { values } };
    for (const { spreadsheetId, alias } of getChannelIdTargets()) {
      await sheets.spreadsheets.values.update({ spreadsheetId, range, ...body });
      const label = alias ? `'${alias}' ` : '';
      console.log(`${label}'${sheetTitle}' 시트 J열에 구독자 수 ${values.length}행 작성했습니다.`);
    }
  });
}

/** channel_id 시트에서 F열(views), J열(followers) 읽기. 헤더 제외, 데이터 행만 반환 */
export function getViewsAndFollowersFromSheet() {
  const selected = getSelectedSpreadsheet();
  if (!selected) return Promise.resolve({ viewsPerRow: [], followersPerRow: [], rowCount: 0 });
  const { spreadsheetId } = selected;
  return getCredentials().then(async (auth) => {
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetTitle = config.sheets.channelId;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetTitle}!F:J`,
    });
    const rows = res.data.values || [];
    const dataRows = rows.slice(1);
    const viewsPerRow = dataRows.map((row) => row[0] != null ? String(row[0]).trim() : '');
    const followersPerRow = dataRows.map((row) => row[4] != null ? String(row[4]).trim() : '');
    return { viewsPerRow, followersPerRow, rowCount: dataRows.length };
  });
}

/** channel_id 시트 K열에 헤더(VPF) + VPF 퍼센트 값 일괄 쓰기. values[0] = 2행, ... */
export function writeVPFToSheet(vpfPerRow) {
  if (!vpfPerRow || vpfPerRow.length === 0) return Promise.resolve();
  return getCredentials().then(async (auth) => {
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetTitle = config.sheets.channelId;
    const dataRows = vpfPerRow.map((v) => [v === '' || v == null ? '' : String(v)]);
    const values = [['VPF'], ...dataRows];
    const range = `${sheetTitle}!K1:K${values.length}`;
    const body = { valueInputOption: 'RAW', requestBody: { values } };
    for (const { spreadsheetId, alias } of getChannelIdTargets()) {
      await sheets.spreadsheets.values.update({ spreadsheetId, range, ...body });
      const label = alias ? `'${alias}' ` : '';
      console.log(`${label}'${sheetTitle}' 시트 K열(VPF) ${dataRows.length}행 작성했습니다.`);
    }
  });
}
