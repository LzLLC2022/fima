import { google } from 'googleapis';

// 시트명은 lib/config.ts 에서 관리합니다.
export { LEDGER_SHEET_NAME, MASTER_SHEET_NAME } from '@/lib/config';

// Vercel 환경변수: GOOGLE_SHEET_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY
export const SHEET_ID = process.env.GOOGLE_SHEET_ID!;

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
 * 시트 전체 데이터 읽기
 * - 숫자는 숫자형, 날짜는 "YYYY-MM-DD" 형식 문자열로 반환
 */
export async function getSheetValues(sheetName: string): Promise<any[][]> {
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: sheetName,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return (response.data.values || []) as any[][];
}

/**
 * 시트 내부 sheetId 조회 (batchUpdate용)
 */
async function getSheetId(sheetName: string): Promise<number> {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = res.data.sheets?.find(s => s.properties?.title === sheetName);
  if (sheet?.properties?.sheetId === undefined) throw new Error(`Sheet not found: ${sheetName}`);
  return sheet.properties.sheetId!;
}

/**
 * 특정 행 업데이트 (sheetRowNumber: 1-indexed 시트 행 번호)
 */
export async function updateRow(sheetName: string, sheetRowNumber: number, values: any[]): Promise<void> {
  const sheets = await getSheets();
  const lastCol = String.fromCharCode(64 + values.length); // A=65
  const range = `${sheetName}!A${sheetRowNumber}:${lastCol}${sheetRowNumber}`;
  const formatted = values.map(v => (v === null || v === undefined ? '' : v));
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [formatted] },
  });
}

/**
 * 특정 행 삭제 (sheetRowNumber: 1-indexed 시트 행 번호)
 */
export async function deleteRow(sheetName: string, sheetRowNumber: number): Promise<void> {
  const sheets = await getSheets();
  const sheetId = await getSheetId(sheetName);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: sheetRowNumber - 1,  // 0-indexed
            endIndex:   sheetRowNumber,       // exclusive
          },
        },
      }],
    },
  });
}

/**
 * 시트에 행 추가
 */
export async function appendRow(sheetName: string, values: any[]): Promise<void> {
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
    spreadsheetId: SHEET_ID,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [formatted] },
  });
}
