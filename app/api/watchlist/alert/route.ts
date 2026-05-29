import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheetValues } from '@/lib/sheets';
import { getStockInfo } from '@/lib/stock';
import { sendTelegram, getOwnerTelegramSettings } from '@/lib/telegram';
import { getOwnedPositions } from '@/lib/positions';

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
 *     - threshold: 임계값 override (0.05 = 5%) — 상승/하락 동일 적용 (테스트용)
 *
 * 동작:
 *   각 Owner의 보유종목(Ledger 누적) + 관심종목(Favorate 시트) 두 그룹의 현재가/전일종가 변동률 확인.
 *   상승 종목은 사용자 설정 `상승 %` 이상, 하락 종목은 `하락 %` 이상이면 알림.
 *   두 그룹에 같은 ticker가 있으면 **보유종목 섹션에만** 표시 (중복 제거).
 *   두 섹션을 한 텔레그램 메시지에 묶어서 발송.
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

    // 채팅 ID + 임계값 (Master 시트)
    const settings = await getOwnerTelegramSettings(cfg.sheetId);
    if (!settings.chatId) {
      summary.push({ owner, skipped: true, reason: 'Master 시트 Telegram 컬럼 미설정 또는 TelegramRecv=N' });
      continue;
    }
    const upThreshold   = overrideThreshold ?? (settings.upPct   > 0 ? settings.upPct   / 100 : DEFAULT_THRESHOLD);
    const downThreshold = overrideThreshold ?? (settings.downPct > 0 ? settings.downPct / 100 : DEFAULT_THRESHOLD);
    const chatId = settings.chatId;

    // ── 보유종목 + 관심종목 추출 ──
    const owned = await getOwnedPositions(cfg.sheetId);
    const ownedTickers = new Set(owned.map(o => o.ticker));

    // Favorate 시트 (관심종목)
    let favItems: Array<{ ticker: string; region: string }> = [];
    try {
      const data = await getSheetValues(cfg.sheetId, WATCHLIST_SHEET_NAME);
      if (data && data.length >= 2) {
        const headers   = data[0].map((h: any) => String(h ?? '').trim());
        const tickerIdx = headers.findIndex((h: string) => h === 'Ticker');
        const regionIdx = headers.findIndex((h: string) => h === 'Region');
        if (tickerIdx !== -1) {
          favItems = data.slice(1)
            .map((r: any[]) => ({
              ticker: String(r[tickerIdx] ?? '').trim().toUpperCase(),
              region: regionIdx !== -1 ? String(r[regionIdx] ?? '').trim() : '',
            }))
            .filter(it => it.ticker)
            // 보유종목과 겹치면 관심종목 섹션에서 제외 (보유 섹션이 우선)
            .filter(it => !ownedTickers.has(it.ticker));
        }
      }
    } catch { /* 시트 없으면 빈 목록 */ }

    if (owned.length === 0 && favItems.length === 0) {
      summary.push({ owner, ownedItems: 0, favItems: 0, alerts: 0 });
      continue;
    }

    // ── 시세 병렬 조회 ──
    const ownedInfoPromises = owned.map(p   => getStockInfo(p.ticker).catch(() => null));
    const favInfoPromises   = favItems.map(it => getStockInfo(it.ticker).catch(() => null));
    const [ownedInfos, favInfos] = await Promise.all([
      Promise.all(ownedInfoPromises),
      Promise.all(favInfoPromises),
    ]);

    const buildEntry = (ticker: string, name: string, region: string, info: any) => {
      const pct       = Number(info?.changepct) || 0;
      const price     = Number(info?.price) || 0;
      const yesterday = Number(info?.yesterday) || (price && pct ? price / (1 + pct) : 0);
      return {
        ticker,
        name:     info?.name || name || ticker,
        region,
        price,
        yesterday,
        pct,
        currency: info?.currency || (region === 'USA' ? 'USD' : 'KRW'),
      };
    };

    const passes = (it: { price: number; pct: number }) =>
      it.price > 0 && (it.pct >= upThreshold || it.pct <= -downThreshold);

    const ownedTriggered = owned
      .map((p, i) => buildEntry(p.ticker, p.name, p.region, ownedInfos[i]))
      .filter(passes)
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

    const favTriggered = favItems
      .map((it, i) => buildEntry(it.ticker, '', it.region, favInfos[i]))
      .filter(passes)
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

    if (ownedTriggered.length === 0 && favTriggered.length === 0) {
      summary.push({ owner, ownedItems: owned.length, favItems: favItems.length, alerts: 0 });
      continue;
    }

    // ── 메시지 빌드 ──
    const fmtPrice = (v: number) => {
      const parts = v.toFixed(2).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return parts.join('.');
    };
    const fmtPct = (v: number) => (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
    const esc    = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const renderLines = (items: typeof ownedTriggered) => items.map(it => {
      const diff    = it.price - it.yesterday;
      const diffStr = (diff >= 0 ? '+' : '') + fmtPrice(diff);
      const emoji   = it.pct >= 0 ? '🔴' : '🔵';
      return (
        `${emoji} ${esc(it.ticker)} ${esc(it.name)}\n` +
        `<blockquote>` +
        `<b>${fmtPct(it.pct)}  ${diffStr} ${esc(it.currency)}</b>\n` +
        `${fmtPrice(it.yesterday)} ⇒ ${fmtPrice(it.price)} ${esc(it.currency)}` +
        `</blockquote>`
      );
    }).join('\n');

    const upPctFmt   = (upThreshold   * 100).toFixed(upThreshold   < 0.01 ? 2 : 1).replace(/\.0$/, '');
    const downPctFmt = (downThreshold * 100).toFixed(downThreshold < 0.01 ? 2 : 1).replace(/\.0$/, '');
    const rangeText  = upPctFmt === downPctFmt ? `±${upPctFmt}%` : `상승 ${upPctFmt}% / 하락 ${downPctFmt}%`;

    const sections: string[] = [];
    if (ownedTriggered.length > 0) {
      sections.push(`[보유종목 변동 알림 (${esc(owner)}) — ${rangeText} 이상]\n\n` + renderLines(ownedTriggered));
    }
    if (favTriggered.length > 0) {
      sections.push(`[관심종목 변동 알림 (${esc(owner)}) — ${rangeText} 이상]\n\n` + renderLines(favTriggered));
    }
    const text = sections.join('\n\n');

    const tg = await sendTelegram(chatId, text, { parseMode: 'HTML' });
    summary.push({
      owner,
      ownedItems: owned.length,
      favItems:   favItems.length,
      ownedAlerts: ownedTriggered.length,
      favAlerts:   favTriggered.length,
      sent: tg.ok,
      tg:   tg.ok ? { status: tg.status } : tg,
    });
  }

  return NextResponse.json({
    success: true,
    threshold: overrideThreshold,
    summary,
  });
}
