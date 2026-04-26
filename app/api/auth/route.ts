import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';

/** GET: 등록된 owner 이름 목록 반환 (PIN 미포함) */
export async function GET() {
  const owners = Object.keys(OWNER_CONFIG);
  return NextResponse.json({ owners });
}

/** POST: owner + PIN 검증 */
export async function POST(req: NextRequest) {
  try {
    const { owner, pin } = await req.json();
    const name = String(owner || '').trim();

    if (!name) {
      return NextResponse.json({ success: false, error: 'Account Owner를 입력하세요.' }, { status: 400 });
    }

    const cfg = OWNER_CONFIG[name];
    if (!cfg) {
      return NextResponse.json({ success: false, error: '등록되지 않은 사용자입니다.' }, { status: 401 });
    }

    // PIN 검증: config에 PIN이 있으면 반드시 일치해야 함
    if (cfg.pin && String(pin ?? '') !== cfg.pin) {
      return NextResponse.json({ success: false, error: 'PIN이 올바르지 않습니다.' }, { status: 401 });
    }

    return NextResponse.json({ success: true, owner: name });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
