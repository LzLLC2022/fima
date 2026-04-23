import { google } from 'googleapis';

export const SHEET_ID          = process.env.GOOGLE_SHEET_ID!;
export const LEDGER_SHEET_NAME = 'Ledger';
export const MASTER_SHEET_NAME = 'Master';

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
