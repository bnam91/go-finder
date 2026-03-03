import os
import sys
from googleapiclient.discovery import build

# auth.py 모듈 경로 추가
sys.path.append(os.path.expanduser("~/Documents/github_cloud/module_auth"))
import auth

def fetch_first_five_rows(spreadsheet_id, sheet_name):
    creds = auth.get_credentials()
    service = build('sheets', 'v4', credentials=creds)
    range_a1 = f"{sheet_name}!A1:Z5"
    
    result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=range_a1,
        majorDimension="ROWS"
    ).execute()
    
    values = result.get('values', [])
    return values

def main():
    spreadsheet_id = "1YWiFGyJjNDbOC8eFTbS1HEhmxfZAC-hLvI8KdA1Gku8"
    sheet_name = "테스트"
    
    try:
        rows = fetch_first_five_rows(spreadsheet_id, sheet_name)
        if not rows or len(rows) == 0:
            print("데이터가 없습니다.")
            return
        
        for idx, row in enumerate(rows):
            print(f"[{idx}]\t" + "\t".join(str(cell) for cell in row))
    except Exception as e:
        print(f"Google Sheets API 호출 실패: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

