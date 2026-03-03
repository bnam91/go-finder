#!/usr/bin/env python3
"""
구독 목록을 추출하여 Google 시트에 입력합니다.
"""

import os
import sys
from datetime import datetime
from pathlib import Path

from googleapiclient.discovery import build

# auth 모듈 경로 추가 (read_sheet_test.py와 동일)
sys.path.append(os.path.expanduser("~/Documents/github_cloud/module_auth"))
import auth

from extract import extract_subscriptions


SPREADSHEET_ID = "1uhRcod87dbzZjHNeKpEvQVbscfVs_W6nptOct6qz0uc"
SHEET_NAME = "list"
SHEET2_NAME = "update:time"


ROW_HEIGHT = 42
COL_A_WIDTH = 42


def upload_to_sheet(channels: list[dict[str, str]]) -> None:
    """채널 목록을 Google 시트에 업로드합니다."""
    creds = auth.get_credentials()
    service = build("sheets", "v4", credentials=creds)

    # sheetId 조회
    spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    sheet_id = None
    for s in spreadsheet["sheets"]:
        if s["properties"]["title"] == SHEET_NAME:
            sheet_id = s["properties"]["sheetId"]
            break
    if sheet_id is None:
        raise ValueError(f"시트 '{SHEET_NAME}'을 찾을 수 없습니다.")

    # 헤더 + 데이터: [프로필, 채널명, 채널ID, 채널링크]
    # A: =IMAGE("url"), B: 채널명, C: 채널ID, D: =HYPERLINK("url", "바로가기")
    CHANNEL_BASE = "https://www.youtube.com/"
    values = [["프로필", "채널명", "채널ID", "채널링크"]]
    for ch in channels:
        img_url = ch.get("profile_image", "")
        img_formula = f'=IMAGE("{img_url}")' if img_url else ""
        channel_id = ch["channel_id"]
        channel_link = f"{CHANNEL_BASE}{channel_id}" if channel_id else ""
        link_formula = f'=HYPERLINK("{channel_link}", "바로가기")' if channel_link else ""
        values.append([img_formula, ch["name"], channel_id, link_formula])

    range_a1 = f"{SHEET_NAME}!A1:D{len(values)}"

    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=range_a1,
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()

    # 행 높이 42, A열 너비 42, 헤더 볼드+배경색 적용
    num_rows = len(values)
    requests = [
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": 0,
                    "endIndex": num_rows,
                },
                "properties": {"pixelSize": ROW_HEIGHT},
                "fields": "pixelSize",
            }
        },
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 0,
                    "endIndex": 1,
                },
                "properties": {"pixelSize": COL_A_WIDTH},
                "fields": "pixelSize",
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": 4,
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {"bold": True},
                        "backgroundColor": {
                            "red": 0.9,
                            "green": 0.9,
                            "blue": 0.9,
                        },
                    }
                },
                "fields": "userEnteredFormat(textFormat.bold,backgroundColor)",
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": num_rows,
                    "startColumnIndex": 0,
                    "endColumnIndex": 4,
                },
                "cell": {
                    "userEnteredFormat": {
                        "verticalAlignment": "MIDDLE",
                        "horizontalAlignment": "CENTER",
                    }
                },
                "fields": "userEnteredFormat.verticalAlignment,userEnteredFormat.horizontalAlignment",
            }
        },
    ]
    service.spreadsheets().batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={"requests": requests},
    ).execute()

    # 시트2에 실행시각 입력
    exec_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{SHEET2_NAME}!A1:B1",
        valueInputOption="USER_ENTERED",
        body={"values": [["실행시각", exec_time]]},
    ).execute()

    print(f"시트 '{SHEET_NAME}'에 {len(channels)}개 채널 입력 완료.")


def main():
    script_dir = Path(__file__).parent
    default_html = script_dir / "잘사는김대리_02.21.html"
    html_path = sys.argv[1] if len(sys.argv) > 1 else str(default_html)

    try:
        channels = extract_subscriptions(html_path)
    except FileNotFoundError as e:
        print(f"오류: {e}", file=sys.stderr)
        sys.exit(1)

    if not channels:
        print("추출된 채널이 없습니다.")
        return

    try:
        upload_to_sheet(channels)
    except Exception as e:
        print(f"Google 시트 업로드 실패: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
