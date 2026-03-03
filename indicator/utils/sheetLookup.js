/**
 * Google 시트에서 채널명으로 채널ID 조회
 * 시트 구조: A=프로필, B=채널명, C=채널ID, D=채널링크
 */
import { google } from 'googleapis';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

const SPREADSHEET_ID = '1uhRcod87dbzZjHNeKpEvQVbscfVs_W6nptOct6qz0uc';
const SHEET_NAME = 'list';
const CHANNEL_NAME_COL = 1; // B열 (인덱스 1)
const CHANNEL_ID_COL = 2;   // C열 (인덱스 2)

const AUTH_PATH = '~Documents/github_cloud/module_auth/auth.js';
const resolvedAuthPath = AUTH_PATH.replace(
  /^~Documents/,
  path.join(os.homedir(), 'Documents'),
);

/**
 * 시트에서 채널명에 검색어가 포함된 모든 행을 찾아 반환
 * @param {string} searchTerm - 검색어 (예: '주연')
 * @returns {Promise<Array<{ channelName: string, channelId: string }>>} 매칭 목록 (빈 배열이면 없음)
 */
export async function resolveChannelIdFromSheet(searchTerm) {
  const trimmed = (searchTerm || '').trim();
  if (!trimmed) return [];

  const { getCredentials } = await import(pathToFileURL(resolvedAuthPath).href);
  const auth = await getCredentials();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:D`,
    majorDimension: 'ROWS',
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const matches = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const channelName = (row[CHANNEL_NAME_COL] ?? '').toString().trim();
    const channelId = (row[CHANNEL_ID_COL] ?? '').toString().trim();

    if (channelName.includes(trimmed) && channelId) {
      const id = channelId.startsWith('@') ? channelId : `@${channelId}`;
      matches.push({ channelName, channelId: id });
    }
  }

  return matches;
}

/**
 * 시트에 입력된 모든 채널 목록 반환 (헤더 제외)
 * @returns {Promise<Array<{ channelName: string, channelId: string }>>}
 */
export async function getAllChannelsFromSheet() {
  const { getCredentials } = await import(pathToFileURL(resolvedAuthPath).href);
  const auth = await getCredentials();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:D`,
    majorDimension: 'ROWS',
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const channels = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const channelName = (row[CHANNEL_NAME_COL] ?? '').toString().trim();
    const channelId = (row[CHANNEL_ID_COL] ?? '').toString().trim();

    if (channelId) {
      const id = channelId.startsWith('@') ? channelId : `@${channelId}`;
      channels.push({ channelName: channelName || id, channelId: id });
    }
  }

  return channels;
}
