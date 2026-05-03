import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheets, getSheetValues, MASTER_SHEET_NAME } from '@/lib/sheets';

/**
 * POST /api/auth/change-email
 * Body: { owner, pin, newEmail }
 *
 * 1. OWNER_CONFIG에서 spreadsheetId 조회
 * 2. Master 시트 "Pin" 컬럼으로 PIN 인증
 * 3. Master 시트 "EMail" 컬럼을 newEmail로 업데이트
 */
export async function POST(req: NextRequest) {
  try {
    const { owner, pin, newEmail } = await req.json().catch(() => ({}));
    const name = String(owner || '').trim();

    if (!name) {
      return NextResponse.json({ success: false, error: 'Account Owner가 필요합니다.' }, { status: 400 });
    }

    const cfg = OWNER_CONFIG[name];
    if (!cfg?.sheetId) {
      return NextResponse.json({ success: false, error: '등록되지 않은 사용자입니다.' }, { status: 401 });
    }

    // 이메일 유효성 검사
    const emailStr = String(newEmail ?? '').trim();
    if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      return NextResponse.json({ success: false, error: '올바른 이메일 형식이 아닙니다.' }, { status: 400 });
    }

    // ── Master 시트 읽기 ──
    const masterData = await getSheetValues(cfg.sheetId, MASTER_SHEET_NAME);
    if (!masterData || masterData.length < 1) {
      return NextResponse.json({ success: false, error: 'Master 시트를 읽을 수 없습니다.' }, { status: 500 });
    }

    const headers = masterData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const pinColIdx   = headers.findIndex((h: string) => h === 'pin');
    const emailColIdx = headers.findIndex((h: string) => h === 'email');

    if (emailColIdx === -1) {
      return NextResponse.json({ success: false, error: 'Master 시트에 EMail 컬럼이 없습니다.' }, { status: 400 });
    }

    // ── PIN 검증 ──
    if (pinColIdx !== -1) {
      let sheetPin = '';
      for (let i = 1; i < masterData.length; i++) {
        const val = String(masterData[i][pinColIdx] ?? '').trim();
        if (val) { sheetPin = val; break; }
      }
      if (sheetPin && String(pin ?? '') !== sheetPin) {
        return NextResponse.json({ success: false, error: 'PIN이 올바르지 않습니다.' }, { status: 401 });
      }
      if (!sheetPin && String(pin ?? '').trim() !== '') {
        return NextResponse.json({ success: false, error: 'PIN이 올바르지 않습니다.' }, { status: 401 });
      }
    }

    // ── EMail 셀 위치 찾기 (첫 번째 비어있지 않은 행, 없으면 1행) ──
    let emailRowIdx = 1;
    for (let i = 1; i < masterData.length; i++) {
      if (masterData[i] && masterData[i].length > emailColIdx) {
        emailRowIdx = i;
        break;
      }
    }

    // ── Master 시트 EMail 셀 업데이트 ──
    // 컬럼 인덱스 → 알파벳 변환 (A=0, Z=25, AA=26 ...)
    const colToLetter = (idx: number): string => {
      let s = '';
      idx++;
      while (idx > 0) {
        s = String.fromCharCode(65 + ((idx - 1) % 26)) + s;
        idx = Math.floor((idx - 1) / 26);
      }
      return s;
    };
    const colLetter = colToLetter(emailColIdx);
    const sheetRow  = emailRowIdx + 1; // 1-indexed
    const range     = `${MASTER_SHEET_NAME}!${colLetter}${sheetRow}`;

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
