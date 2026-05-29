import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheetValues } from '@/lib/sheets';
import { getStockInfo } from '@/lib/stock';
import { sendTelegram, getOwnerTelegramSettings } from '@/lib/telegram';
import { getOwnedPositions } from '@/lib/positions';
import { readAlertState, writeAlertState } from '@/lib/alertState';

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

    // ── 직전 실행과 '동일 변동률'인 종목은 메시지에서 제외 ──
    //   장 마감 후 가격 변화가 없어 매시간 같은 변동률로 반복 알림되는 것을 방지한다.
    //   직전에 알림 대상이 아니었던 종목은 영향 없음(정상 알림).
    const prevState = await readAlertState(cfg.sheetId);
    const roundPct  = (p: number) => Math.round(p * 10000) / 10000;  // 표시 정밀도(소수 2자리 %) 기준
    // 이번 실행에서 임계값을 통과한 모든 종목의 현재 변동률 → 다음 실행 비교용 상태
    const newState = new Map<string, number>();
    [...ownedTriggered, ...favTriggered].forEach(it => newState.set(it.ticker, roundPct(it.pct)));
    // 메시지 발송 여부와 무관하게 '이번에 임계값 통과한' 종목 기준으로 상태 저장
    // (이번·직전 모두 비어 있으면 쓸 필요 없음 → 불필요한 _AlertState 탭 생성 방지)
    if (newState.size > 0 || prevState.size > 0) {
      await writeAlertState(cfg.sheetId, newState).catch(() => { /* 상태 저장 실패는 알림을 막지 않음 */ });
    }

    const isChanged = (it: { ticker: string; pct: number }) =>
      !prevState.has(it.ticker) || prevState.get(it.ticker) !== roundPct(it.pct);
    const ownedToSend = ownedTriggered.filter(isChanged);
    const favToSend   = favTriggered.filter(isChanged);

    if (ownedToSend.length === 0 && favToSend.length === 0) {
      summary.push({
        owner, ownedItems: owned.length, favItems: favItems.length, alerts: 0,
        triggered: ownedTriggered.length + favTriggered.length,
        skippedSamePct: ownedTriggered.length + favTriggered.length,
      });
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
    const rangeText  = `+${upPctFmt}% 이상, -${downPctFmt}% 이하`;

    // 보유종목 / 관심종목은 각각 별도 텔레그램 메시지로 발송 (사용자 요청)
    const ownerSummary: any = {
      owner,
      ownedItems: owned.length,
      favItems:   favItems.length,
      ownedAlerts: ownedToSend.length,
      favAlerts:   favToSend.length,
      // 임계값은 통과했으나 직전과 변동률이 같아 제외된 건수
      skippedSamePct: (ownedTriggered.length - ownedToSend.length) + (favTriggered.length - favToSend.length),
    };

    if (ownedToSend.length > 0) {
      const ownedText = `[보유종목 변동 알림 (${esc(owner)}) — ${rangeText}]\n\n` + renderLines(ownedToSend);
      const tgOwned = await sendTelegram(chatId, ownedText, { parseMode: 'HTML' });
      ownerSummary.ownedSent = tgOwned.ok;
      ownerSummary.tgOwned   = tgOwned.ok ? { status: tgOwned.status } : tgOwned;
    }
    if (favToSend.length > 0) {
      const favText = `[관심종목 변동 알림 (${esc(owner)}) — ${rangeText}]\n\n` + renderLines(favToSend);
      const tgFav = await sendTelegram(chatId, favText, { parseMode: 'HTML' });
      ownerSummary.favSent = tgFav.ok;
      ownerSummary.tgFav   = tgFav.ok ? { status: tgFav.status } : tgFav;
    }

    summary.push(ownerSummary);
  }

  return NextResponse.json({
    success: true,
    threshold: overrideThreshold,
    summary,
  });
}
