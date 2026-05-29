/**
 * 텔레그램 Bot API 발송 헬퍼
 *
 * 환경변수:
 *   TELEGRAM_BOT_TOKEN              — 공용 봇 토큰
 *   TELEGRAM_CHAT_ID_<OWNER_UPPER>  — Owner별 채팅 ID
 *
 * 사용 예:
 *   await sendTelegram('Lz', '메시지 내용', { parseMode: 'HTML' });
 */

export interface TelegramResult {
  ok: boolean;
  skipped?: boolean;     // 환경변수 미설정으로 보내지 않은 경우
  reason?: string;
  status?: number;
  body?: any;
}

/** Owner 이름 → 환경변수 키 (예: 'Lz' → 'TELEGRAM_CHAT_ID_LZ') */
export function chatIdEnvKey(owner: string): string {
  return 'TELEGRAM_CHAT_ID_' + String(owner || '').trim().toUpperCase();
}

/** Owner의 텔레그램 chat_id 조회. 없으면 빈 문자열 반환. */
export function getChatIdForOwner(owner: string): string {
  return String(process.env[chatIdEnvKey(owner)] ?? '').trim();
}

export async function sendTelegram(
  owner: string,
  text: string,
  opts: { parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'; disablePreview?: boolean } = {}
): Promise<TelegramResult> {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) return { ok: false, skipped: true, reason: 'TELEGRAM_BOT_TOKEN 미설정' };

  const chatId = getChatIdForOwner(owner);
  if (!chatId) return { ok: false, skipped: true, reason: `${chatIdEnvKey(owner)} 미설정` };

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
