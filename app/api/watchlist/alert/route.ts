import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheetValues } from '@/lib/sheets';
import { getStockInfo } from '@/lib/stock';
import { sendTelegram, getOwnerTelegramSettings } from '@/lib/telegram';

const WATCHLIST_SHEET_NAME = 'Favorate';
const DEFAULT_THRESHOLD = 0.05;  // 5% (사용자가 시트에 임계값을 등록 안 한 경우 fallback)

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
  // body의 threshold가 오면 상승/하락 동일 적용으로 override (테스트용). 없으면 Master 시트값 사용.
  const thresholdNum = Number(params?.threshold);
  const overrideThreshold = (thresholdNum > 0 && thresholdNum < 1) ? thresholdNum : null;

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

    // 채팅 ID + 임계값 모두 Master 시트에서 조회
    const settings = await getOwnerTelegramSettings(cfg.sheetId);
    if (!settings.chatId) {
      summary.push({ owner, items: rows.length, alerts: 0, skipped: true, reason: 'Master 시트 Telegram 컬럼 미설정 또는 TelegramRecv=N' });
      continue;
    }
    // 사용자별 상승/하락 임계값 (시트값 → ratio). override 가 오면 둘 다 동일.
    const upThreshold   = overrideThreshold ?? (settings.upPct   > 0 ? settings.upPct   / 100 : DEFAULT_THRESHOLD);
    const downThreshold = overrideThreshold ?? (settings.downPct > 0 ? settings.downPct / 100 : DEFAULT_THRESHOLD);
    const chatId = settings.chatId;

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
      .filter(it => {
        if (it.price <= 0) return false;
        // 상승은 upThreshold 이상, 하락은 downThreshold 이상 절댓값
        return it.pct >= upThreshold || it.pct <= -downThreshold;
      });

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
      const emoji  = it.pct >= 0 ? '🔴' : '🔵';  // 한국 관행: 상승 빨강 / 하락 파랑
      // 박스 밖: 이모지 + 티커 + 종목명
      // 박스 안 1줄: 변동률 + 변동금액 (Bold)
      // 박스 안 2줄: 전일가 => 현재가 (한 줄)
      return (
        `${emoji} ${esc(it.ticker)} ${esc(it.name)}\n` +
        `<blockquote>` +
        `<b>${fmtPct(it.pct)}  ${diffStr} ${esc(it.currency)}</b>\n` +
        `${fmtPrice(it.yesterday)} ⇒ ${fmtPrice(it.price)} ${esc(it.currency)}` +
        `</blockquote>`
      );
    });

    const upPctFmt   = (upThreshold   * 100).toFixed(upThreshold   < 0.01 ? 2 : 1).replace(/\.0$/, '');
    const downPctFmt = (downThreshold * 100).toFixed(downThreshold < 0.01 ? 2 : 1).replace(/\.0$/, '');
    const rangeText = upPctFmt === downPctFmt ? `±${upPctFmt}%` : `상승 ${upPctFmt}% / 하락 ${downPctFmt}%`;
    const header = `[관심종목 변동 알림 (${esc(owner)}) — ${rangeText} 이상]`;
    const text = header + '\n\n' + lines.join('\n');

    const tg = await sendTelegram(chatId, text, { parseMode: 'HTML' });
    summary.push({
      owner,
      items: rows.length,
      alerts: triggered.length,
      sent: tg.ok,
      tg: tg.ok ? { status: tg.status } : tg,
    });
  }

  return NextResponse.json({
    success: true,
    threshold: overrideThreshold,    // override 가 적용된 경우만 단일 값, 없으면 null (Owner별 시트값 사용)
    summary,
  });
}
