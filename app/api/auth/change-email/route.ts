import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheets, getSheetValues, MASTER_SHEET_NAME } from '@/lib/sheets';

/** Master 시트에서 EMail 컬럼 값과 셀 위치를 반환하는 헬퍼 */
async function getEmailInfo(sheetId: string) {
  const masterData = await getSheetValues(sheetId, MASTER_SHEET_NAME);
  if (!masterData || masterData.length < 1) throw new Error('Master 시트를 읽을 수 없습니다.');

  const headers     = masterData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
  const emailColIdx = headers.findIndex((h: string) => h === 'email');
  if (emailColIdx === -1) throw new Error('Master 시트에 EMail 컬럼이 없습니다.');

  // 첫 번째 데이터 행에서 이메일 읽기
  let currentEmail = '';
  let emailRowIdx  = 1; // default: 헤더 다음 첫 행
  for (let i = 1; i < masterData.length; i++) {
    emailRowIdx = i;
    currentEmail = String(masterData[i]?.[emailColIdx] ?? '').trim();
    break; // 첫 번째 데이터 행 사용
  }

  // 컬럼 인덱스 → 알파벳 (A, B, ..., Z, AA, ...)
  const colToLetter = (idx: number): string => {
    let s = ''; idx++;
    while (idx > 0) { s = String.fromCharCode(65 + ((idx - 1) % 26)) + s; idx = Math.floor((idx - 1) / 26); }
    return s;
  };

  return {
    currentEmail,
    range: `${MASTER_SHEET_NAME}!${colToLetter(emailColIdx)}${emailRowIdx + 1}`,
  };
}

/**
 * GET /api/auth/change-email?owner=Lz
 * Master 시트의 현재 EMail 값 반환
 */
export async function GET(req: NextRequest) {
  try {
    const owner = req.nextUrl.searchParams.get('owner') || '';
    const name  = String(owner).trim();
    if (!name) return NextResponse.json({ success: false, error: 'owner가 필요합니다.' }, { status: 400 });

    const cfg = OWNER_CONFIG[name];
    if (!cfg?.sheetId) return NextResponse.json({ success: false, error: '등록되지 않은 사용자입니다.' }, { status: 401 });

    const { currentEmail } = await getEmailInfo(cfg.sheetId);
    return NextResponse.json({ success: true, email: currentEmail });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/auth/change-email
 * Body: { owner, newEmail }
 * Master 시트 EMail 컬럼 업데이트 (PIN 불필요)
 */
export async function POST(req: NextRequest) {
  try {
    const { owner, newEmail } = await req.json().catch(() => ({}));
    const name = String(owner || '').trim();

    if (!name) return NextResponse.json({ success: false, error: 'Account Owner가 필요합니다.' }, { status: 400 });

    const cfg = OWNER_CONFIG[name];
    if (!cfg?.sheetId) return NextResponse.json({ success: false, error: '등록되지 않은 사용자입니다.' }, { status: 401 });

    const emailStr = String(newEmail ?? '').trim();
    if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      return NextResponse.json({ success: false, error: '올바른 이메일 형식이 아닙니다.' }, { status: 400 });
    }

    const { range } = await getEmailInfo(cfg.sheetId);

    const sheets = await getSheets();
    await sheets.spreadsheets.values.update({
      spreadsheetId   : cfg.sheetId,
      range,
      valueInputOption: 'RAW',
      requestBody     : { values: [[emailStr]] },
    });

    return NextResponse.json({ success: true, message: '이메일이 변경되었습니다.' });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
