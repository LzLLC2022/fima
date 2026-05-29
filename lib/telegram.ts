/**
 * 텔레그램 Bot API 발송 헬퍼
 *
 * 환경변수:
 *   TELEGRAM_BOT_TOKEN  — 공용 봇 토큰 (모든 Owner 공유)
 *
 * chat_id 는 각 Owner의 Google Spreadsheet Master 시트의 `Telegram` 컬럼에서 관리.
 * (Email 컬럼과 동일한 패턴 — 헤더 case-insensitive, 비어있지 않은 첫 행 값을 사용)
 * 선택 컬럼:
 *   - `TelegramRecv` (또는 `telegramrecv`) 가 'N' / '0' / 'false' 이면 발송 거부.
 *
 * 사용 예:
 *   const chatId = await getOwnerChatId(sheetId);
 *   if (chatId) await sendTelegram(chatId, '메시지');
 */

import { getSheetValues, MASTER_SHEET_NAME } from '@/lib/sheets';

export interface TelegramResult {
  ok: boolean;
  skipped?: boolean;     // 봇 토큰/chat_id 미설정으로 보내지 않은 경우
  reason?: string;
  status?: number;
  body?: any;
}

/**
 * Owner의 Spreadsheet Master 시트에서 텔레그램 chat_id 조회.
 * 비어있거나 TelegramRecv=N 이면 빈 문자열 반환.
 */
export interface TelegramSettings {
  chatId:    string;   // 빈 문자열이면 미설정/수신거부
  recv:      boolean;  // 명시적 수신여부 (TelegramRecv 컬럼)
  upPct:     number;   // 상승 알림 임계값 % (예: 5 = 5%, 기본 5)
  downPct:   number;   // 하락 알림 임계값 % (기본 5)
}

const DEFAULT_PCT = 5;

/**
 * Owner의 Spreadsheet Master 시트에서 텔레그램 설정 일괄 조회.
 * 컬럼명 (대소문자/언더스코어 무시):
 *   - Telegram         (필수, chat_id)
 *   - TelegramRecv     (선택, Y/N - 미설정 시 Y)
 *   - TelegramUpPct    (선택, 숫자 % - 미설정 시 5)
 *   - TelegramDownPct  (선택, 숫자 % - 미설정 시 5)
 */
export async function getOwnerTelegramSettings(sheetId: string): Promise<TelegramSettings> {
  const empty: TelegramSettings = { chatId: '', recv: true, upPct: DEFAULT_PCT, downPct: DEFAULT_PCT };
  try {
    const masterData = await getSheetValues(sheetId, MASTER_SHEET_NAME);
    if (!masterData || masterData.length < 2) return empty;
    const headers = masterData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const chatColIdx = headers.findIndex((h: string) => h === 'telegram' || h === 'telegramchatid' || h === 'telegram_chat_id');
    if (chatColIdx === -1) return empty;
    const recvColIdx = headers.findIndex((h: string) => h === 'telegramrecv' || h === 'telegram_recv');
    const upColIdx   = headers.findIndex((h: string) => h === 'telegramuppct' || h === 'telegram_up_pct');
    const downColIdx = headers.findIndex((h: string) => h === 'telegramdownpct' || h === 'telegram_down_pct');

    // 첫 번째 비어있지 않은 chat_id 행을 사용
    for (let i = 1; i < masterData.length; i++) {
      const raw = String(masterData[i]?.[chatColIdx] ?? '').trim();
      if (!raw) continue;

      // TelegramRecv: 명시적 'N' 만 수신 거부, 그 외(빈 값/'Y'/'1'/etc)는 수신
      let recv = true;
      if (recvColIdx !== -1) {
        const v = String(masterData[i]?.[recvColIdx] ?? '').trim().toLowerCase();
        if (v === 'n' || v === '0' || v === 'false') recv = false;
      }

      const parsePct = (cellIdx: number): number => {
        if (cellIdx === -1) return DEFAULT_PCT;
        const v = String(masterData[i]?.[cellIdx] ?? '').trim().replace('%', '');
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_PCT;
      };

      return {
        chatId: recv ? raw : '',
        recv,
        upPct:   parsePct(upColIdx),
        downPct: parsePct(downColIdx),
      };
    }
  } catch { /* 조회 실패 시 기본값 */ }
  return empty;
}

/** 하위 호환: chat_id 만 필요할 때. */
export async function getOwnerChatId(sheetId: string): Promise<string> {
  const s = await getOwnerTelegramSettings(sheetId);
  return s.chatId;
}

/**
 * 텔레그램 메시지 발송.
 * @param chatId 발송 대상 chat_id (보통 Master 시트에서 `getOwnerChatId()`로 조회한 값)
 */
export async function sendTelegram(
  chatId: string,
  text: string,
  opts: { parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'; disablePreview?: boolean } = {}
): Promise<TelegramResult> {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token)   return { ok: false, skipped: true, reason: 'TELEGRAM_BOT_TOKEN 미설정' };
  if (!chatId)  return { ok: false, skipped: true, reason: 'chat_id 미설정 (Master 시트 Telegram 컬럼 확인)' };

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body: any = {
    chat_id: chatId,
    text,
    disable_web_page_preview: opts.disablePreview !== false,
  };
  if (opts.parseMode) body.parse_mode = opts.parseMode;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok && json?.ok === true, status: res.status, body: json };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'fetch failed' };
  }
}
