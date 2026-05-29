import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { sendTelegram, getOwnerTelegramSettings } from '@/lib/telegram';

/**
 * POST /api/holdings-report
 *
 * 인증:
 *   Authorization: Bearer <REPORT_SECRET>
 *
 * Body (모두 optional):
 *   { owner?: string }
 *     - owner: 특정 Owner만 발송 (없으면 OWNER_CONFIG의 모든 Owner 순회, Sample 제외)
 *
 * 동작:
 *   각 Owner의 보유종목 현황(평가/손익)을 텔레그램으로 발송.
 *   매주 화~토 07:00 KST (= 월~금 22:00 UTC) GitHub Actions cron이 호출.
 *   포트폴리오 계산은 /api/portfolio 를 self-fetch 하여 재사용.
 *
 * 메시지 포맷 (종목별 3줄, blockquote 박스):
 *   <b>TICKER 종목명</b>
 *   보유 X주 · 매입단가 Y CUR · 매입금액 Z KRW
 *   손익 +A KRW (+B%) · 평가 C KRW
 */

const fmtK     = (v: number) => Math.floor(v).toLocaleString('ko-KR');
const fmtN     = (v: number, d = 2) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d });
const fmtPct   = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
const fmtSigned = (v: number) => (v >= 0 ? '+' : '') + fmtK(v);
const esc      = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** KST(UTC+9) 기준 YYYY-MM-DD (요일) */
function kstDateLabel(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const dows = ['일', '월', '화', '수', '목', '금', '토'];
  return `${y}-${m}-${d}(${dows[kst.getUTCDay()]})`;
}

export async function POST(req: NextRequest) {
  // ── 인증 ──
  const authHeader = req.headers.get('authorization') || '';
  const token  = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const secret = String(process.env.REPORT_SECRET ?? '').trim();
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await req.json().catch(() => ({} as any));
  const targetOwner = String(params?.owner ?? '').trim();
  const owners = targetOwner
    ? [targetOwner]
    : Object.keys(OWNER_CONFIG).filter(o => o !== 'Sample');

  const baseUrl = String(process.env.REPORT_BASE_URL || 'https://fima.lim.kr').replace(/\/$/, '');
  const dateLabel = kstDateLabel();
  const summary: any[] = [];

  for (const owner of owners) {
    const cfg = OWNER_CONFIG[owner];
    if (!cfg?.sheetId) {
      summary.push({ owner, skipped: true, reason: 'sheetId 미설정' });
      continue;
    }

    // 텔레그램 설정 조회
    const settings = await getOwnerTelegramSettings(cfg.sheetId);
    if (!settings.chatId) {
      summary.push({ owner, skipped: true, reason: 'Master 시트 Telegram 컬럼 미설정 또는 TelegramRecv=N' });
      continue;
    }

    // /api/portfolio 호출 (self-fetch)
    let portfolio: any;
    try {
      const res = await fetch(`${baseUrl}/api/portfolio`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ owner }),
      });
      portfolio = await res.json();
      if (!portfolio?.success) {
        summary.push({ owner, error: 'portfolio: ' + (portfolio?.error || 'unknown') });
        continue;
      }
    } catch (e: any) {
      summary.push({ owner, error: 'portfolio fetch failed: ' + (e?.message || 'unknown') });
      continue;
    }

    const items: any[] = [...(portfolio.stocks || []), ...(portfolio.funds || [])];
    if (items.length === 0) {
      summary.push({ owner, items: 0, skipped: true, reason: '보유 종목 없음' });
      continue;
    }

    // 종목별 박스 (3줄: 종목명 / 수량·단가·매입 / 손익·수익률·평가)
    const lines = items.map((it: any) => {
      const ticker      = String(it.ticker || '');
      const name        = String(it.name || '');
      const qty         = Number(it.quantity)    || 0;
      const avgPrice    = Number(it.avgPrice)    || 0;   // 현지통화
      const purchaseAmt = Number(it.purchaseAmt) || 0;   // KRW
      const pnl         = Number(it.pnl)         || 0;   // KRW
      const marketValue = Number(it.marketValue) || 0;   // KRW
      const divKRW      = Number(it.divKRW)      || 0;   // KRW (누적배당금, portfolio API 가 거래일별 환산 후 floor 누적)
      const currency    = String(it.currency || 'KRW');
      // 손익률은 KRW 기준으로 통일 (사용자에게 가장 직관적)
      const pnlPct      = purchaseAmt > 0 ? (pnl / purchaseAmt * 100) : 0;

      // 종목명 표시: "TICKER 종목명" (한국 종목은 ticker 가 보통 6자리 코드)
      const headLine = ticker && name && ticker !== name
        ? `<b>${esc(ticker)} ${esc(name)}</b>`
        : `<b>${esc(name || ticker)}</b>`;

      // 배당이 있는 종목만 4번째 줄로 추가 (없는 종목은 노이즈 방지)
      const divLine = divKRW > 0
        ? `\n누적배당금 ${fmtK(divKRW)} KRW`
        : '';

      return (
        `<blockquote>` +
        `${headLine}\n` +
        `보유 ${fmtN(qty, 4)}주 · 매입단가 ${fmtN(avgPrice, 2)} ${esc(currency)} · 매입금액 ${fmtK(purchaseAmt)} KRW\n` +
        `손익 <b>${fmtSigned(pnl)} KRW</b> (${fmtPct(pnlPct)}) · 평가 ${fmtK(marketValue)} KRW` +
        divLine +
        `</blockquote>`
      );
    });

    // 헤더 (총 평가/총 손익)
    const totalPurchase = items.reduce((s, it) => s + (Number(it.purchaseAmt) || 0), 0);
    const totalValue    = items.reduce((s, it) => s + (Number(it.marketValue) || 0), 0);
    const totalPnl      = totalValue - totalPurchase;
    const totalPnlPct   = totalPurchase > 0 ? (totalPnl / totalPurchase * 100) : 0;

    const header =
      `[보유종목 현황 (${esc(owner)}) — ${dateLabel}]\n` +
      `📊 평가 <b>${fmtK(totalValue)} KRW</b> · 손익 <b>${fmtSigned(totalPnl)} KRW</b> (${fmtPct(totalPnlPct)})\n\n`;

    const text = header + lines.join('\n');

    // 텔레그램 4096자 제한 — 한 메시지에 안 들어가면 종목 청크로 분할 발송
    const MAX = 4000;
    let tg;
    if (text.length <= MAX) {
      tg = await sendTelegram(settings.chatId, text, { parseMode: 'HTML' });
    } else {
      // 청크 분할: header 는 첫 메시지만, 종목 라인을 누적해서 MAX 안에 맞춤
      const chunks: string[] = [];
      let cur = header;
      for (const line of lines) {
        const sep = cur === header ? '' : '\n';
        if ((cur.length + sep.length + line.length) > MAX) {
          chunks.push(cur);
          cur = line;
        } else {
          cur += sep + line;
        }
      }
      if (cur) chunks.push(cur);

      let allOk = true;
      let lastStatus: any = null;
      for (let i = 0; i < chunks.length; i++) {
        const part = chunks.length > 1 ? chunks[i] + `\n\n— ${i + 1}/${chunks.length} —` : chunks[i];
        const r = await sendTelegram(settings.chatId, part, { parseMode: 'HTML' });
        if (!r.ok) { allOk = false; lastStatus = r; }
        else       { lastStatus = { status: r.status }; }
      }
      tg = allOk ? { ok: true, status: lastStatus?.status } : { ok: false, ...lastStatus };
    }

    summary.push({
      owner,
      items:      items.length,
      totalValue: Math.floor(totalValue),
      totalPnl:   Math.floor(totalPnl),
      sent:       tg.ok,
      tg:         tg.ok ? { status: tg.status } : tg,
    });
  }

  return NextResponse.json({ success: true, dateLabel, summary });
}
