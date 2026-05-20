/**
 * ============================================================
 * sheets.ts — Google Sheets API 래퍼 함수 모음
 * ============================================================
 *
 * 이 파일의 역할
 * ──────────────
 * Google Spreadsheet(가계부 시트)를 읽고 쓰고 삭제하는
 * 기본 동작을 함수로 묶어 놓은 "도구 상자"입니다.
 * 다른 API Route나 서버 함수에서 이 파일의 함수를 import해서 사용합니다.
 *
 * 파일 구조 (위→아래)
 * ──────────────────
 *  1. getAuth()          — Google 서비스 계정 인증 객체 생성 (내부용)
 *  2. getSheets()        — Google Sheets API 클라이언트 반환 (내부용)
 *  3. getSheetTabId()    — 시트 탭의 내부 ID 조회 (행 삭제 시 필요, 내부용)
 *  4. getSheetValues()   — 시트 전체 데이터를 2차원 배열로 읽기 (외부 공개)
 *  5. appendRow()        — 시트 마지막 행 다음에 새 행 추가 (외부 공개)
 *  6. updateRow()        — 특정 행의 내용을 덮어쓰기 (외부 공개)
 *  7. batchUpdateCells() — 여러 셀을 한 번에 업데이트 (외부 공개)
 *  8. deleteRow()        — 특정 행 1개를 삭제 (외부 공개)
 *  9. bulkDeleteRows()   — 여러 행을 한 번에 일괄 삭제 (외부 공개)
 *
 * 행 번호 규칙 (중요!)
 * ──────────────────
 *  - 시트 행 번호(sheetRowNumber): 1부터 시작 (Google Sheets 화면에 보이는 번호)
 *  - 배열 인덱스(index): 0부터 시작 (JavaScript 배열의 위치)
 *  - 예) 시트 2행 = 배열 index 1 = sheetRowNumber 2
 *    헤더가 1행이면, 실제 데이터 첫 행은 sheetRowNumber=2, 배열 index=1
 *
 * 환경변수 (Vercel 대시보드에서 설정)
 * ──────────────────────────────────
 *  - GOOGLE_CLIENT_EMAIL : 서비스 계정 이메일
 *  - GOOGLE_PRIVATE_KEY  : 서비스 계정 비공개 키 (줄바꿈 포함)
 * ============================================================
 */
import { google } from 'googleapis';

// 시트명·설정은 lib/config.ts 에서 관리
export { LEDGER_SHEET_NAME, MASTER_SHEET_NAME } from '@/lib/config';

// Vercel 환경변수: GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY (모든 owner 공유)
/**
 * Google 서비스 계정 인증 객체를 생성합니다.
 * Vercel 환경변수에서 서비스 계정 이메일과 비공개 키를 읽어 인증에 사용합니다.
 * ※ 내부 전용 함수 — 외부에서 직접 호출하지 않습니다.
 */
function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

/**
 * Google Sheets API v4 클라이언트를 반환합니다.
 * 아래의 모든 읽기/쓰기 함수가 이 클라이언트를 통해 API를 호출합니다.
 * ※ 내부 전용 함수 — 외부에서 직접 호출하지 않습니다.
 */
export async function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

/**
 * 시트 탭의 내부 ID(sheetId)를 조회합니다.
 * Google Sheets API의 deleteDimension(행 삭제) 요청에는 탭 이름이 아니라
 * 내부 sheetId가 필요하기 때문에 이 함수로 먼저 ID를 가져옵니다.
 * ※ 내부 전용 함수 — 외부에서 직접 호출하지 않습니다.
 *
 * @param spreadsheetId - Google Spreadsheet의 고유 ID
 * @param sheetName     - 탭 이름 (예: 'Ledger')
 * @returns             - 해당 탭의 내부 숫자 ID
 * @throws              - 해당 이름의 탭이 없을 경우 오류 발생
 */
async function getSheetTabId(spreadsheetId: string, sheetName: string): Promise<number> {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = res.data.sheets?.find(s => s.properties?.title === sheetName);
  if (sheet?.properties?.sheetId === undefined) throw new Error(`Sheet not found: ${sheetName}`);
  return sheet.properties.sheetId!;
}

/**
 * 시트의 모든 데이터를 2차원 배열로 읽어옵니다.
 *
 * @param spreadsheetId - Google Spreadsheet의 고유 ID
 *                        (URL에서 /d/XXXXXX/edit 의 XXXXXX 부분)
 * @param sheetName     - 시트 하단 탭 이름 (예: 'Ledger', 'Master')
 * @returns             - rows[행번호-1][열번호-1] 형태의 2차원 배열
 *                        예) rows[0] = 첫 번째 행(헤더), rows[1] = 두 번째 행(첫 데이터)
 *
 * 옵션 설명:
 *  - UNFORMATTED_VALUE: 쉼표·단위 없는 순수 숫자/문자 반환 (계산에 유리)
 *  - FORMATTED_STRING : 날짜를 '2026-01-01' 문자열로 반환 (시리얼 숫자 방지)
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
 * 시트의 기존 데이터 바로 아래에 새 행을 추가합니다.
 *
 * @param spreadsheetId - Google Spreadsheet의 고유 ID
 * @param sheetName     - 대상 시트 탭 이름
 * @param values        - 추가할 셀 값 배열 (A열부터 순서대로)
 *                        예) ['2026-01-01', '삼성전자', 100, 75000]
 *
 * 날짜 처리: Date 객체는 자동으로 'YYYY-MM-DD' 문자열로 변환됩니다.
 * null/undefined 값은 빈 문자열('')로 처리됩니다.
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

  // range를 '시트명!A:A'로 고정: A열 기준으로 테이블 감지하여 L열 오기입 방지
  // INSERT_ROWS: 시트 행이 꽉 차도 자동으로 새 행을 삽입 (grid limit 초과 방지)
  // RAW: 날짜 문자열("2026-01-01")이 시리얼 숫자로 변환되지 않도록
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [formatted] },
  });
}

/**
 * 시트의 특정 행 내용을 새 값으로 덮어씁니다.
 *
 * @param spreadsheetId   - Google Spreadsheet의 고유 ID
 * @param sheetName       - 대상 시트 탭 이름
 * @param sheetRowNumber  - 수정할 행 번호 (1-indexed, 즉 시트에 보이는 행 번호 그대로)
 *                          예) 헤더가 1행이면, 첫 데이터 행은 sheetRowNumber=2
 * @param values          - 새로 쓸 셀 값 배열 (A열부터 순서대로)
 *
 * 주의: values 배열 길이만큼 A열부터 덮어씁니다.
 *       lastCol은 values.length로 자동 계산됩니다.
 *       예) values 길이 4 → A열~D열 범위를 업데이트
 */
export async function updateRow(spreadsheetId: string, sheetName: string, sheetRowNumber: number, values: any[]): Promise<void> {
  const sheets = await getSheets();
  const lastCol = String.fromCharCode(64 + values.length); // 열 수 → 알파벳 열명 변환 (예: 4 → 'D')
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
 * 여러 개의 셀을 한 번의 API 호출로 일괄 업데이트합니다.
 * 각기 다른 위치의 셀을 여러 개 바꿔야 할 때 API 호출 횟수를 줄여 성능을 높입니다.
 *
 * @param spreadsheetId - Google Spreadsheet의 고유 ID
 * @param updates       - 업데이트할 셀 목록 배열
 *                        각 항목: { range: 'SheetName!A2', value: 새 값 }
 *                        예) [{ range: 'Ledger!C5', value: 80000 },
 *                             { range: 'Ledger!E5', value: '매도' }]
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
 * 시트의 특정 행 1개를 삭제합니다.
 * 내부적으로 bulkDeleteRows를 호출합니다.
 *
 * @param spreadsheetId   - Google Spreadsheet의 고유 ID
 * @param sheetName       - 대상 시트 탭 이름
 * @param sheetRowNumber  - 삭제할 행 번호 (1-indexed, 시트에 보이는 행 번호 그대로)
 *                          주의: 행이 삭제되면 그 아래 행들의 번호가 1씩 당겨집니다.
 */
export async function deleteRow(spreadsheetId: string, sheetName: string, sheetRowNumber: number): Promise<void> {
  await bulkDeleteRows(spreadsheetId, sheetName, [sheetRowNumber]);
}

/**
 * 여러 행을 한 번의 API 호출로 일괄 삭제합니다.
 * 여러 거래를 동시에 삭제할 때 API 호출 횟수를 최소화하여 성능을 높입니다.
 *
 * @param spreadsheetId - Google Spreadsheet의 고유 ID
 * @param sheetName     - 대상 시트 탭 이름
 * @param rowNumbers    - 삭제할 행 번호 배열 (1-indexed, 순서 무관)
 *                        예) [3, 7, 12] → 3행, 7행, 12행 삭제
 *                        내부에서 자동으로 내림차순 정렬 후 삭제합니다.
 *
 * 내림차순 정렬 이유:
 *   위의 행을 먼저 지우면 아래 행들의 번호가 바뀌어 엉뚱한 행이 삭제됩니다.
 *   아래 행부터 지우면 위 행 번호가 변하지 않으므로 정확히 삭제됩니다.
 */
export async function bulkDeleteRows(
  spreadsheetId: string,
  sheetName: string,
  rowNumbers: number[],
): Promise<void> {
  if (!rowNumbers.length) return;
  const sheets  = await getSheets();
  const sheetId = await getSheetTabId(spreadsheetId, sheetName);
  // 높은 행번호부터 삭제해야 이전 삭제로 인한 행번호 이동 영향 없음
  const sorted = [...rowNumbers].sort((a, b) => b - a);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: sorted.map(rowNum => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowNum - 1,
            endIndex: rowNum,
          },
        },
      })),
    },
  });
}
