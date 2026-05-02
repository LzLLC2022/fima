import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheets, getSheetValues, MASTER_SHEET_NAME } from '@/lib/sheets';

/**
 * POST /api/auth/change-pin
 * Body: { owner, currentPin, newPin }
 *
 * 1. OWNER_CONFIG에서 spreadsheetId 조회
 * 2. Master 시트 "Pin" 컬럼에서 현재 PIN 읽기
 * 3. currentPin 일치 확인
 * 4. Master 시트 Pin 셀을 newPin으로 업데이트
 */
export async function POST(req: NextRequest) {
  try {
    const { owner, currentPin, newPin } = await req.json().catch(() => ({}));
    const name = String(owner || '').trim();

    if (!name) {
      return NextResponse.json({ success: false, error: 'Account Owner가 필요합니다.' }, { status: 400 });
    }

    const cfg = OWNER_CONFIG[name];
    if (!cfg?.sheetId) {
      return NextResponse.json({ success: false, error: '등록되지 않은 사용자입니다.' }, { status: 401 });
    }

    // 신규 PIN 유효성 검사 (최소 4자리)
    const newPinStr = String(newPin ?? '').trim();
    if (newPinStr.length < 4) {
      return NextResponse.json({ success: false, error: 'PIN은 4자리 이상이어야 합니다.' }, { status: 400 });
    }

    // ── Master 시트 읽기 ──
    const masterData = await getSheetValues(cfg.sheetId, MASTER_SHEET_NAME);
    if (!masterData || masterData.length < 1) {
      return NextResponse.json({ success: false, error: 'Master 시트를 읽을 수 없습니다.' }, { status: 500 });
    }

    const headers = masterData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const pinColIdx = headers.findIndex((h: string) => h === 'pin');

    if (pinColIdx === -1) {
      return NextResponse.json({ success: false, error: 'Master 시트에 Pin 컬럼이 없습니다.' }, { status: 400 });
    }

    // 첫 번째 비어 있지 않은 Pin 값 + 행 번호 찾기
    let sheetPin = '';
    let pinRowIdx = -1; // 0-based (헤더 제외)
    for (let i = 1; i < masterData.length; i++) {
      const val = String(masterData[i][pinColIdx] ?? '').trim();
      if (val) {
        sheetPin = val;
        pinRowIdx = i;
        break;
      }
    }

    // Pin이 없으면 첫 번째 데이터 행에 쓰기
    if (pinRowIdx === -1) {
      sheetPin  = '';
      pinRowIdx = 1; // 헤더 다음 첫 행
    }

    // ── 현재 PIN 검증 ──
    // sheetPin이 비어있으면 currentPin도 비어있어야 함
    if (sheetPin && String(currentPin ?? '') !== sheetPin) {
      return NextResponse.json({ success: false, error: '기존 PIN이 올바르지 않습니다.' }, { status: 401 });
    }
    if (!sheetPin && String(currentPin ?? '').trim() !== '') {
      return NextResponse.json({ success: false, error: '기존 PIN이 올바르지 않습니다.' }, { status: 401 });
    }

    // ── Master 시트 Pin 셀 업데이트 ──
    const colLetter = String.fromCharCode(65 + pinColIdx); // A=65
    const sheetRow  = pinRowIdx + 1; // 1-indexed
    const range     = `${MASTER_SHEET_NAME}!${colLetter}${sheetRow}`;

    const sheets = await getSheets();
    await sheets.spreadsheets.values.update({
      spreadsheetId : cfg.sheetId,
      range,
      valueInputOption: 'RAW',
      requestBody    : { values: [[newPinStr]] },
    });

    return NextResponse.json({ success: true, message: 'PIN이 변경되었습니다.' });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
