import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheets, getSheetValues, MASTER_SHEET_NAME } from '@/lib/sheets';

/** 컬럼 인덱스 → 시트 알파벳 (A, B, ..., Z, AA, ...) */
function colToLetter(idx: number): string {
  let s = ''; idx++;
  while (idx > 0) { s = String.fromCharCode(65 + ((idx - 1) % 26)) + s; idx = Math.floor((idx - 1) / 26); }
  return s;
}

const DEFAULT_PCT = 5;
const DATA_ROW_IDX = 1;  // 첫 데이터 행

interface ColumnPlan {
  current: { chat: string; recv: boolean; up: number; down: number; };
  ranges: Record<'chat' | 'recv' | 'up' | 'down', string>;  // 값 셀
  headerRanges: Partial<Record<'chat' | 'recv' | 'up' | 'down', string>>;  // 신규 헤더가 필요한 컬럼만
}

const HEADER_NAME = {
  chat: 'Telegram',
  recv: 'TelegramRecv',
  up:   'TelegramUpPct',
  down: 'TelegramDownPct',
};

async function planColumns(sheetId: string): Promise<ColumnPlan> {
  const masterData = await getSheetValues(sheetId, MASTER_SHEET_NAME);
  if (!masterData || masterData.length < 1) throw new Error('Master 시트를 읽을 수 없습니다.');

  const headerRow = (masterData[0] || []).map((h: any) => String(h ?? '').trim());
  const lowerHeaders = headerRow.map((h: string) => h.toLowerCase());

  const findIdx = (...names: string[]) => lowerHeaders.findIndex((h: string) => names.includes(h));
  let chatIdx = findIdx('telegram', 'telegramchatid', 'telegram_chat_id');
  let recvIdx = findIdx('telegramrecv', 'telegram_recv');
  let upIdx   = findIdx('telegramuppct', 'telegram_up_pct');
  let downIdx = findIdx('telegramdownpct', 'telegram_down_pct');

  // 누락 컬럼은 헤더 뒤에 차례로 배치
  let nextCol = headerRow.length;
  const headerRanges: ColumnPlan['headerRanges'] = {};

  const ensure = (idx: number, key: keyof typeof HEADER_NAME): number => {
    if (idx !== -1) return idx;
    const newIdx = nextCol++;
    headerRanges[key] = `${MASTER_SHEET_NAME}!${colToLetter(newIdx)}1`;
    return newIdx;
  };

  chatIdx = ensure(chatIdx, 'chat');
  recvIdx = ensure(recvIdx, 'recv');
  upIdx   = ensure(upIdx,   'up');
  downIdx = ensure(downIdx, 'down');

  const currentChat = String(masterData[DATA_ROW_IDX]?.[chatIdx] ?? '').trim();
  const recvRaw     = String(masterData[DATA_ROW_IDX]?.[recvIdx] ?? '').trim().toLowerCase();
  const currentRecv = !(recvRaw === 'n' || recvRaw === '0' || recvRaw === 'false');
  const parsePctCell = (cellIdx: number): number => {
    const v = String(masterData[DATA_ROW_IDX]?.[cellIdx] ?? '').trim().replace('%', '');
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_PCT;
  };
  const currentUp   = parsePctCell(upIdx);
  const currentDown = parsePctCell(downIdx);

  const valRange = (idx: number) => `${MASTER_SHEET_NAME}!${colToLetter(idx)}${DATA_ROW_IDX + 1}`;

  return {
    current: { chat: currentChat, recv: currentRecv, up: currentUp, down: currentDown },
    ranges: {
      chat: valRange(chatIdx),
      recv: valRange(recvIdx),
      up:   valRange(upIdx),
      down: valRange(downIdx),
    },
    headerRanges,
  };
}

/**
 * GET /api/auth/change-telegram?owner=Lz
 * Master 시트의 현재 텔레그램 설정 반환
 */
export async function GET(req: NextRequest) {
  try {
    const owner = (req.nextUrl.searchParams.get('owner') || '').trim();
    if (!owner) return NextResponse.json({ success: false, error: 'owner가 필요합니다.' }, { status: 400 });

    const cfg = OWNER_CONFIG[owner];
    if (!cfg?.sheetId) return NextResponse.json({ success: false, error: '등록되지 않은 사용자입니다.' }, { status: 401 });

    const plan = await planColumns(cfg.sheetId);
    return NextResponse.json({
      success:  true,
      chatId:   plan.current.chat,
      recv:     plan.current.recv,
      upPct:    plan.current.up,
      downPct:  plan.current.down,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/auth/change-telegram
 * Body: { owner, chatId, recv, upPct, downPct }
 * Master 시트 4개 컬럼 업데이트 (헤더 없으면 자동 생성)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const owner = String(body?.owner || '').trim();
    if (!owner) return NextResponse.json({ success: false, error: 'Account Owner가 필요합니다.' }, { status: 400 });

    const cfg = OWNER_CONFIG[owner];
    if (!cfg?.sheetId) return NextResponse.json({ success: false, error: '등록되지 않은 사용자입니다.' }, { status: 401 });

    // 입력 검증
    const chatId = String(body?.chatId ?? '').trim();
    if (chatId && !/^-?\d{3,}$/.test(chatId)) {
      return NextResponse.json({ success: false, error: '텔레그램 ID는 숫자(또는 음수 채널 ID)만 허용됩니다.' }, { status: 400 });
    }
    const recv = body?.recv === true || body?.recv === 'Y' || body?.recv === 'y' || body?.recv === 1;
    const parsePct = (raw: any, label: string): number => {
      const v = Number(String(raw ?? '').replace('%', ''));
      if (!Number.isFinite(v) || v <= 0 || v > 100) {
        throw new Error(`${label}은(는) 0보다 크고 100 이하 숫자여야 합니다.`);
      }
      return Math.round(v * 100) / 100;  // 소수 2자리
    };
    let upPct: number, downPct: number;
    try {
      upPct   = parsePct(body?.upPct,   '상승 임계값');
      downPct = parsePct(body?.downPct, '하락 임계값');
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 400 });
    }

    const plan = await planColumns(cfg.sheetId);
    const sheets = await getSheets();

    // 1) 누락 헤더 먼저 생성 (병렬)
    const headerUpdates = (Object.entries(plan.headerRanges) as Array<[keyof typeof HEADER_NAME, string]>).map(
      ([key, range]) => sheets.spreadsheets.values.update({
        spreadsheetId:    cfg.sheetId,
        range,
        valueInputOption: 'RAW',
        requestBody:      { values: [[HEADER_NAME[key]]] },
      })
    );
    if (headerUpdates.length) await Promise.all(headerUpdates);

    // 2) 값 업데이트 (병렬). chatId가 비어도 빈 문자열로 명시 저장 — 사용자가 의도적으로 지웠을 수 있음
    await Promise.all([
      sheets.spreadsheets.values.update({
        spreadsheetId:    cfg.sheetId,
        range:            plan.ranges.chat,
        valueInputOption: 'RAW',
        requestBody:      { values: [[chatId]] },
      }),
      sheets.spreadsheets.values.update({
        spreadsheetId:    cfg.sheetId,
        range:            plan.ranges.recv,
        valueInputOption: 'RAW',
        requestBody:      { values: [[recv ? 'Y' : 'N']] },
      }),
      sheets.spreadsheets.values.update({
        spreadsheetId:    cfg.sheetId,
        range:            plan.ranges.up,
        valueInputOption: 'RAW',
        requestBody:      { values: [[upPct]] },
      }),
      sheets.spreadsheets.values.update({
        spreadsheetId:    cfg.sheetId,
        range:            plan.ranges.down,
        valueInputOption: 'RAW',
        requestBody:      { values: [[downPct]] },
      }),
    ]);

    return NextResponse.json({ success: true, message: '저장되었습니다.' });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
