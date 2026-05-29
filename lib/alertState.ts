/**
 * ============================================================
 * alertState.ts — 보유/관심종목 변동 알림의 "직전 변동률" 상태 저장소
 * ============================================================
 *
 * 매시간 실행되는 /api/watchlist/alert 는 운영(Vercel) 서버리스 환경에서
 * 동작하므로 프로세스 메모리에 상태를 보관할 수 없습니다. 따라서 각 Owner
 * 스프레드시트의 숨김용 탭 `_AlertState` 에 "직전 실행에서 알림 대상이었던
 * 종목의 변동률"을 저장해 두고, 다음 실행에서 비교합니다.
 *
 * 시트 구조 (`_AlertState` 탭):
 *   A: Ticker  | B: Pct(소수, 예 0.0512) | C: UpdatedAt(ISO)
 *   1행은 헤더, 2행부터 데이터.
 *
 * 비교 규칙:
 *   - 이번 실행에서 임계값을 통과한 종목의 변동률이 직전 저장값과 동일하면 제외.
 *   - 직전에 알림 대상이 아니었던(맵에 없던) 종목은 영향 없음(정상 알림).
 * ============================================================
 */
import { getSheets, getSheetValues } from '@/lib/sheets';

export const ALERT_STATE_SHEET = '_AlertState';

/**
 * 직전 실행에서 알림 대상이었던 종목의 변동률 맵(ticker → pct)을 읽는다.
 * 탭이 없거나 비어 있으면 빈 맵을 반환한다.
 */
export async function readAlertState(spreadsheetId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const data = await getSheetValues(spreadsheetId, ALERT_STATE_SHEET);
    if (data && data.length >= 2) {
      for (let i = 1; i < data.length; i++) {
        const ticker = String(data[i]?.[0] ?? '').trim().toUpperCase();
        const pct    = Number(data[i]?.[1]);
        if (ticker && Number.isFinite(pct)) map.set(ticker, pct);
      }
    }
  } catch {
    /* 탭이 없으면(최초 실행) 빈 맵 */
  }
  return map;
}

/**
 * 이번 실행에서 임계값을 통과한 종목의 변동률 맵을 저장(전체 덮어쓰기)한다.
 * 탭이 없으면 생성하고, 기존 내용을 지운 뒤 새로 기록한다.
 * 맵이 비어 있으면 헤더만 남겨 직전 상태를 초기화한다.
 */
export async function writeAlertState(spreadsheetId: string, state: Map<string, number>): Promise<void> {
  const sheets = await getSheets();

  // 탭이 없으면 생성
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some((s: any) => s.properties?.title === ALERT_STATE_SHEET);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: ALERT_STATE_SHEET } } }] },
    });
  }

  // 기존 내용 비우고 새로 기록
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: ALERT_STATE_SHEET });
  const now = new Date().toISOString();
  const rows: any[][] = [['Ticker', 'Pct', 'UpdatedAt']];
  state.forEach((pct, ticker) => rows.push([ticker, pct, now]));
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${ALERT_STATE_SHEET}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}
