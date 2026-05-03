import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheets, getSheetValues, MASTER_SHEET_NAME } from '@/lib/sheets';

/** 컬럼 인덱스 → 시트 알파벳 (A, B, ..., Z, AA, ...) */
function colToLetter(idx: number): string {
  let s = ''; idx++;
  while (idx > 0) { s = String.fromCharCode(65 + ((idx - 1) % 26)) + s; idx = Math.floor((idx - 1) / 26); }
  return s;
}

/** Master 시트에서 Email / EmailRecv 정보를 읽어 반환 */
async function getMasterInfo(sheetId: string) {
  const masterData = await getSheetValues(sheetId, MASTER_SHEET_NAME);
  if (!masterData || masterData.length < 1) throw new Error('Master 시트를 읽을 수 없습니다.');

  const headers     = masterData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
  const emailColIdx = headers.findIndex((h: string) => h === 'email');
  if (emailColIdx === -1) throw new Error('Master 시트에 Email 컬럼이 없습니다.');

  const recvColIdx  = headers.findIndex((h: string) => h === 'emailrecv');

  // 첫 번째 데이터 행 인덱스
  const dataRowIdx = 1;

  const currentEmail = String(masterData[dataRowIdx]?.[emailColIdx] ?? '').trim();

  // EmailRecv: 컬럼 없거나 값 미설정이면 true (기본 수신)
  // 명시적으로 'N' / '0' / 'false' 인 경우만 false (수신 거부)
  // → 이메일 발송 로직(getOwnerEmail)과 동일한 기준
  let emailRecv = true;
  if (recvColIdx !== -1) {
    const v = String(masterData[dataRowIdx]?.[recvColIdx] ?? '').trim().toLowerCase();
    const isOptOut = v === 'n' || v === '0' || v === 'false';
    emailRecv = !isOptOut;
  }

  const emailRange = `${MASTER_SHEET_NAME}!${colToLetter(emailColIdx)}${dataRowIdx + 1}`;

  // EmailRecv 컬럼이 없으면 헤더 뒤에 새 컬럼 추가
  const recvActualIdx  = recvColIdx !== -1 ? recvColIdx : headers.length;
  const recvRange      = `${MASTER_SHEET_NAME}!${colToLetter(recvActualIdx)}${dataRowIdx + 1}`;
  const recvHeaderRange = recvColIdx === -1
    ? `${MASTER_SHEET_NAME}!${colToLetter(recvActualIdx)}1`
    : null;

  return { currentEmail, emailRecv, emailRange, recvRange, recvHeaderRange };
}

/**
 * GET /api/auth/change-email?owner=Lz
 * Master 시트의 현재 Email + EmailRecv 값 반환
 */
export async function GET(req: NextRequest) {
  try {
    const owner = req.nextUrl.searchParams.get('owner') || '';
    const name  = String(owner).trim();
    if (!name) return NextResponse.json({ success: false, error: 'owner가 필요합니다.' }, { status: 400 });

    const cfg = OWNER_CONFIG[name];
    if (!cfg?.sheetId) return NextResponse.json({ success: false, error: '등록되지 않은 사용자입니다.' }, { status: 401 });

    const { currentEmail, emailRecv } = await getMasterInfo(cfg.sheetId);
    return NextResponse.json({ success: true, email: currentEmail, emailRecv });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/auth/change-email
 * Body: { owner, newEmail, emailRecv }
 * Master 시트 Email + EmailRecv 컬럼 업데이트
 */
export async function POST(req: NextRequest) {
  try {
    const { owner, newEmail, emailRecv } = await req.json().catch(() => ({}));
    const name = String(owner || '').trim();

    if (!name) return NextResponse.json({ success: false, error: 'Account Owner가 필요합니다.' }, { status: 400 });

    const cfg = OWNER_CONFIG[name];
    if (!cfg?.sheetId) return NextResponse.json({ success: false, error: '등록되지 않은 사용자입니다.' }, { status: 401 });

    const emailStr = String(newEmail ?? '').trim();
    if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      return NextResponse.json({ success: false, error: '올바른 이메일 형식이 아닙니다.' }, { status: 400 });
    }

    const { emailRange, recvRange, recvHeaderRange } = await getMasterInfo(cfg.sheetId);
    const sheets = await getSheets();

    // Email 업데이트
    await sheets.spreadsheets.values.update({
      spreadsheetId   : cfg.sheetId,
      range           : emailRange,
      valueInputOption: 'RAW',
      requestBody     : { values: [[emailStr]] },
    });

    // EmailRecv 헤더가 없으면 먼저 생성
    if (recvHeaderRange) {
      await sheets.spreadsheets.values.update({
        spreadsheetId   : cfg.sheetId,
        range           : recvHeaderRange,
        valueInputOption: 'RAW',
        requestBody     : { values: [['EmailRecv']] },
      });
    }

    // EmailRecv 값 업데이트 (Y / N)
    const recvVal = emailRecv === true ? 'Y' : 'N';
    await sheets.spreadsheets.values.update({
      spreadsheetId   : cfg.sheetId,
      range           : recvRange,
      valueInputOption: 'RAW',
      requestBody     : { values: [[recvVal]] },
    });

    return NextResponse.json({ success: true, message: '저장되었습니다.' });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
