import { google } from "googleapis";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

// auth.js 모듈 가져오기 (요청한 경로)
const AUTH_PATH = "~Documents/github_cloud/module_auth/auth.js";
const resolvedAuthPath = AUTH_PATH.replace(
  /^~Documents/,
  path.join(os.homedir(), "Documents"),
);
const { getCredentials } = await import(pathToFileURL(resolvedAuthPath).href);

async function fetchFirstFiveRows(spreadsheetId, sheetName) {
  const creds = await getCredentials();
  const sheets = google.sheets({ version: "v4", auth: creds });
  const rangeA1 = `${sheetName}!A1:E5`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    majorDimension: "ROWS",
  });

  const values = res.data.values || [];
  return values;
}

async function main() {
  const spreadsheetId = "1YWiFGyJjNDbOC8eFTbS1HEhmxfZAC-hLvI8KdA1Gku8";
  const sheetName = "테스트";

  try {
    const rows = await fetchFirstFiveRows(spreadsheetId, sheetName);
    if (!rows || rows.length === 0) {
      console.log("데이터가 없습니다.");
      return;
    }
    rows.forEach((row, idx) => {
      console.log(`[${idx}]\t` + row.map(String).join("\t"));
    });
  } catch (e) {
    console.error("Google Sheets API 호출 실패:", e);
    process.exitCode = 1;
  }
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}


