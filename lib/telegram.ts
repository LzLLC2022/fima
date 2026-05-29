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
export async function getOwnerChatId(sheetId: string): Promise<string> {
  try {
    const masterData = await getSheetValues(sheetId, MASTER_SHEET_NAME);
    if (!masterData || masterData.length < 2) return '';
    const headers = masterData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const chatColIdx = headers.findIndex((h: string) => h === 'telegram' || h === 'telegramchatid' || h === 'telegram_chat_id');
    if (chatColIdx === -1) return '';
    const recvColIdx = headers.findIndex((h: string) => h === 'telegramrecv' || h === 'telegram_recv');

    for (let i = 1; i < masterData.length; i++) {
      const raw = String(masterData[i]?.[chatColIdx] ?? '').trim();
      if (!raw) continue;

      // 명시적 수신 거부 토글 체크 (없거나 빈 값이면 수신함)
      if (recvColIdx !== -1) {
        const recv = String(masterData[i]?.[recvColIdx] ?? '').trim().toLowerCase();
        if (recv === 'n' || recv === '0' || recv === 'false') return '';
      }

      return raw;
    }
  } catch { /* 조회 실패 시 빈 문자열 */ }
  return '';
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
