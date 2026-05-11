import { google } from 'googleapis';

// 시트명·설정은 lib/config.ts 에서 관리
export { LEDGER_SHEET_NAME, MASTER_SHEET_NAME } from '@/lib/config';

// Vercel 환경변수: GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY (모든 owner 공유)
function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

export async function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

/**
 * 시트 내부 탭 ID 조회 (deleteDimension용)
 */
async function getSheetTabId(spreadsheetId: string, sheetName: string): Promise<number> {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = res.data.sheets?.find(s => s.properties?.title === sheetName);
  if (sheet?.properties?.sheetId === undefined) throw new Error(`Sheet not found: ${sheetName}`);
  return sheet.properties.sheetId!;
}

/**
 * 시트 전체 데이터 읽기
 * @param spreadsheetId - owner의 Google Spreadsheet ID
 * @param sheetName     - 시트 탭 이름 (예: 'Ledger')
 */
export async function getSheetValues(spreadsheetId: string, sheetName: string): Promise<any[][]> {
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return (response.data.values || []) as any[][];
}

/**
 * 시트에 행 추가
 */
export async function appendRow(spreadsheetId: string, sheetName: string, values: any[]): Promise<void> {
  const sheets = await getSheets();
  const formatted = values.map(v => {
    if (v instanceof Date) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, '0');
      const d = String(v.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    if (v === null || v === undefined) return '';
    return v;
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: 'RAW',   // 날짜 문자열이 시리얼로 변환되지 않도록 RAW 사용
    requestBody: { values: [formatted] },
  });
}

/**
 * 특정 행 업데이트 (sheetRowNumber: 1-indexed 시트 행 번호)
 */
export async function updateRow(spreadsheetId: string, sheetName: string, sheetRowNumber: number, values: any[]): Promise<void> {
  const sheets = await getSheets();
  const lastCol = String.fromCharCode(64 + values.length);
  const range = `${sheetName}!A${sheetRowNumber}:${lastCol}${sheetRowNumber}`;
  const formatted = values.map(v => (v === null || v === undefined ? '' : v));
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [formatted] },
  });
}

/**
 * 여러 셀을 한 번에 업데이트 (batchUpdate)
 * @param updates - [{ range: 'SheetName!A2', value: any }, ...]
 */
export async function batchUpdateCells(
  spreadsheetId: string,
  updates: { range: string; value: any }[],
): Promise<void> {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: updates.map(u => ({
        range: u.range,
        values: [[u.value]],
      })),
    },
  });
}

/**
 * 특정 행 삭제 (sheetRowNumber: 1-indexed 시트 행 번호)
 */
export async function deleteRow(spreadsheetId: string, sheetName: string, sheetRowNumber: number): Promise<void> {
  const sheets = await getSheets();
  const sheetId = await getSheetTabId(spreadsheetId, sheetName);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: sheetRowNumber - 1,
            endIndex: sheetRowNumber,
          },
        },
      }],
    },
  });
}
