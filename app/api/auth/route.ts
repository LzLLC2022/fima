import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheetValues, MASTER_SHEET_NAME } from '@/lib/sheets';

/** GET: 등록된 owner 이름 목록 반환 (PIN 미포함) */
export async function GET() {
  const owners = Object.keys(OWNER_CONFIG);
  return NextResponse.json({ owners });
}

/**
 * POST: owner + PIN 검증
 *
 * 검증 순서:
 *   1. OWNER_CONFIG에 등록된 owner인지 확인 (spreadsheetId 조회)
 *   2. 해당 스프레드시트의 Master 시트에서 "Pin" 컬럼 값 조회
 *   3. Master 시트에 Pin 컬럼이 있으면 → 시트 PIN과 비교
 *      Master 시트에 Pin 컬럼이 없거나 비어 있으면 → 로그인 허용 (PIN 없음)
 */
export async function POST(req: NextRequest) {
  try {
    const { owner, pin } = await req.json();
    const name = String(owner || '').trim();

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Account Owner를 입력하세요.' },
        { status: 400 }
      );
    }

    const cfg = OWNER_CONFIG[name];
    if (!cfg?.sheetId) {
      return NextResponse.json(
        { success: false, error: '등록되지 않은 사용자입니다.' },
        { status: 401 }
      );
    }

    // ── Master 시트에서 Pin 컬럼 읽기 ──
    let sheetPin = '';
    try {
      const masterData = await getSheetValues(cfg.sheetId, MASTER_SHEET_NAME);
      if (masterData && masterData.length >= 1) {
        const headers = masterData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
        const pinIdx   = headers.findIndex((h: string) => h === 'pin');
        if (pinIdx !== -1) {
          // 헤더 아래 행 중 첫 번째 비어 있지 않은 Pin 값 사용
          for (let i = 1; i < masterData.length; i++) {
            const val = String(masterData[i][pinIdx] ?? '').trim();
            if (val) { sheetPin = val; break; }
          }
        }
      }
    } catch {
      // Master 시트 접근 실패 → 구 방식(env PIN) 폴백
      sheetPin = (cfg as any).pin ?? '';
    }

    // ── PIN 검증 ──
    // sheetPin이 비어 있으면 PIN 없이 로그인 허용
    if (sheetPin && String(pin ?? '') !== sheetPin) {
      return NextResponse.json(
        { success: false, error: 'PIN이 올바르지 않습니다.' },
        { status: 401 }
      );
    }

    return NextResponse.json({ success: true, owner: name });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
