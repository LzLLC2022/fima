import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheetValues } from '@/lib/sheets';
import { getStockInfo } from '@/lib/stock';
import { sendTelegram, getOwnerChatId } from '@/lib/telegram';

const WATCHLIST_SHEET_NAME = 'Favorate';
const THRESHOLD = 0.05;  // 5%

/**
 * POST /api/watchlist/alert
 *
 * 인증:
 *   Authorization: Bearer <REPORT_SECRET>
 *
 * Body (모두 optional):
 *   { owner?: string, threshold?: number }
 *     - owner: 특정 Owner만 발송 (없으면 OWNER_CONFIG의 모든 Owner 순회, Sample 제외)
 *     - threshold: 5% 임계값 override (0.05 = 5%)
 *
 * 동작:
 *   각 Owner의 Favorate 시트를 읽어 등록 종목의 현재가/전일종가 대비 변동률을 확인.
 *   |changepct| >= threshold 인 종목이 있으면 해당 Owner의 텔레그램 채팅으로 한 건의 메시지에 묶어 발송.
 *   chat_id 는 Owner Spreadsheet의 Master 시트 `Telegram` 컬럼에서 조회 (Email 컬럼과 동일 패턴).
 *   변동률 유지되는 한 매시간 반복 발송 (사용자 요청).
 */
export async function POST(req: NextRequest) {
  // ── 인증 ──
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const secret = String(process.env.REPORT_SECRET ?? '').trim();
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 파라미터 ──
  const params = await req.json().catch(() => ({} as any));
  const targetOwner = String(params?.owner ?? '').trim();
  const thresholdNum = Number(params?.threshold);
  const threshold = (thresholdNum > 0 && thresholdNum < 1) ? thresholdNum : THRESHOLD;

  const owners = targetOwner
    ? [targetOwner]
    : Object.keys(OWNER_CONFIG).filter(o => o !== 'Sample');

  const summary: any[] = [];

  for (const owner of owners) {
    const cfg = OWNER_CONFIG[owner];
    if (!cfg?.sheetId) {
      summary.push({ owner, skipped: true, reason: 'sheetId 미설정' });
      continue;
    }

    // 시트 조회
    let rows: any[][];
    try {
      const data = await getSheetValues(cfg.sheetId, WATCHLIST_SHEET_NAME);
      if (!data || data.length < 2) { summary.push({ owner, items: 0, alerts: 0 }); continue; }
      const headers   = data[0].map((h: any) => String(h ?? '').trim());
      const tickerIdx = headers.findIndex((h: string) => h === 'Ticker');
      const groupIdx  = headers.findIndex((h: string) => h === 'Group');
      const regionIdx = headers.findIndex((h: string) => h === 'Region');
      if (tickerIdx === -1) { summary.push({ owner, error: 'Ticker 컬럼 없음' }); continue; }

      rows = data.slice(1).map((r: any[]) => [
        groupIdx  !== -1 ? String(r[groupIdx]  ?? '').trim() : '',
        regionIdx !== -1 ? String(r[regionIdx] ?? '').trim() : '',
        String(r[tickerIdx] ?? '').trim().toUpperCase(),
      ]).filter(r => r[2]);
    } catch (e: any) {
      summary.push({ owner, error: e?.message || 'sheet read failed' });
      continue;
    }

    if (rows.length === 0) { summary.push({ owner, items: 0, alerts: 0 }); continue; }

    // 채팅 ID 미설정 Owner는 시세 조회도 생략 (불필요한 API 호출 방지)
    // chat_id 는 Owner Spreadsheet의 Master 시트 `Telegram` 컬럼에서 조회.
    const chatId = await getOwnerChatId(cfg.sheetId);
    if (!chatId) {
      summary.push({ owner, items: rows.length, alerts: 0, skipped: true, reason: 'Master 시트 Telegram 컬럼 미설정 또는 TelegramRecv=N' });
      continue;
    }

    // 시세 병렬 조회
    const infos = await Promise.all(rows.map(r => getStockInfo(r[2]).catch(() => null)));

    const triggered = rows
      .map((r, i) => {
        const info = infos[i];
        const pct  = Number(info?.changepct) || 0;     // 비율 (0.05 = 5%)
        const price     = Number(info?.price) || 0;
        const yesterday = Number(info?.yesterday) || (price && pct ? price / (1 + pct) : 0);
        return {
          group:    r[0],
          region:   r[1],
          ticker:   r[2],
          name:     info?.name || r[2],
          price,
          yesterday,
          pct,
          currency: info?.currency || (r[1] === 'USA' ? 'USD' : 'KRW'),
        };
      })
      .filter(it => it.price > 0 && Math.abs(it.pct) >= threshold);

    if (triggered.length === 0) {
      summary.push({ owner, items: rows.length, alerts: 0 });
      continue;
    }

    // 변동률 큰 순으로 정렬
    triggered.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

    const fmtPrice = (v: number) => {
      const parts = v.toFixed(2).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return parts.join('.');
    };
    const fmtPct = (v: number) => (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
    // HTML parse_mode 용 escape
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const lines = triggered.map(it => {
      const diff = it.price - it.yesterday;
      const diffStr = (diff >= 0 ? '+' : '') + fmtPrice(diff);
      // 1줄째: 변동률 + 변동금액 (Bold + Underline 으로 강조 — 텔레그램은 색상 미지원)
      // 2줄째: 종목명 + 어제 → 오늘 가격
      return (
        `<b><u>${fmtPct(it.pct)}  ${diffStr} ${esc(it.currency)}</u></b>\n` +
        `${esc(it.ticker)} ${esc(it.name)}  ${fmtPrice(it.yesterday)} → ${fmtPrice(it.price)}`
      );
    });

    const header = `[관심종목 변동 알림 (${esc(owner)}) — ±${(threshold * 100).toFixed(0)}% 이상]`;
    const text = header + '\n\n' + lines.join('\n\n');

    const tg = await sendTelegram(chatId, text, { parseMode: 'HTML' });
    summary.push({
      owner,
      items: rows.length,
      alerts: triggered.length,
      sent: tg.ok,
      tg: tg.ok ? { status: tg.status } : tg,
    });
  }

  return NextResponse.json({ success: true, threshold, summary });
}
