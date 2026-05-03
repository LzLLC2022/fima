import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheetValues, MASTER_SHEET_NAME } from '@/lib/sheets';

// ── 숫자 포맷 헬퍼 ────────────────────────────────────────────────
function fmtKRW(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100_000_000) return (v / 100_000_000).toFixed(2) + '억';
  if (abs >= 10_000)      return Math.round(v / 10_000) + '만';
  return v.toLocaleString('ko-KR');
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '-';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function signColor(v: number | null | undefined): string {
  if (v == null) return '#4a5568';
  return v >= 0 ? '#2b6cb0' : '#c53030';
}

function signPrefix(v: number): string {
  return v >= 0 ? '+' : '';
}

// ── HTML 이메일 생성 ────────────────────────────────────────────
function buildEmailHtml(owner: string, data: any, dateStr: string): string {
  const s      = data.summary || {};
  const stocks = (data.stocks || []).filter((st: any) => st);

  const netInv   = s.netInvestmentKRW  ?? 0;
  const mktVal   = s.marketValueKRW    ?? 0;
  const pnlKRW   = s.pnlKRW            ?? 0;
  const pnlPct   = s.pnlPct            ?? 0;
  const ytd      = s.ytd;
  const mtd      = s.mtd;
  const daily    = s.daily;

  // 요약 카드 행
  const cardHtml = (label: string, val: string, sub: string, col: string) => `
    <td style="width:25%;padding:0 6px;">
      <div style="background:#f7fafc;border-radius:8px;padding:12px 10px;text-align:center;">
        <div style="font-size:11px;color:#718096;margin-bottom:4px;">${label}</div>
        <div style="font-size:15px;font-weight:700;color:#2d3748;">${val}</div>
        ${sub ? `<div style="font-size:11px;color:${col};margin-top:2px;">${sub}</div>` : ''}
      </div>
    </td>`;

  const periodCardHtml = (label: string, d: any) => {
    if (!d) return `
    <td style="width:33%;padding:0 6px;">
      <div style="background:#f7fafc;border-radius:8px;padding:12px 10px;text-align:center;">
        <div style="font-size:11px;color:#718096;margin-bottom:4px;">${label}</div>
        <div style="font-size:14px;font-weight:700;color:#a0aec0;">-</div>
      </div>
    </td>`;
    const col = signColor(d.pnlKRW);
    return `
    <td style="width:33%;padding:0 6px;">
      <div style="background:#f7fafc;border-radius:8px;padding:12px 10px;text-align:center;">
        <div style="font-size:11px;color:#718096;margin-bottom:4px;">${label}</div>
        <div style="font-size:14px;font-weight:700;color:${col};">${signPrefix(d.pnlKRW)}${fmtKRW(d.pnlKRW)} KRW</div>
        <div style="font-size:11px;color:${col};margin-top:2px;">${fmtPct(d.pnlPct)}</div>
      </div>
    </td>`;
  };

  // 종목 테이블 행
  const stockRows = stocks.map((st: any) => {
    const ytdCol   = signColor(st.annualReturnPct);
    const mtdCol   = signColor(st.monthlyReturnPct);
    const pnlCol   = signColor(st.pnlPct);
    return `
      <tr style="border-bottom:1px solid #edf2f7;">
        <td style="padding:8px 10px;font-weight:600;color:#2d3748;">${st.ticker}</td>
        <td style="padding:8px 10px;color:#4a5568;font-size:12px;">${st.name || '-'}</td>
        <td style="padding:8px 10px;text-align:right;color:#4a5568;">${st.currentPrice?.toFixed(2) ?? '-'} ${st.currency ?? ''}</td>
        <td style="padding:8px 10px;text-align:right;color:${pnlCol};font-weight:600;">${st.pnlPct != null ? fmtPct(st.pnlPct) : '-'}</td>
        <td style="padding:8px 10px;text-align:right;color:${ytdCol};font-weight:600;">${fmtPct(st.annualReturnPct)}</td>
        <td style="padding:8px 10px;text-align:right;color:${mtdCol};font-weight:600;">${fmtPct(st.monthlyReturnPct)}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:24px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- 헤더 -->
      <tr><td style="background:linear-gradient(135deg,#1a365d 0%,#2b6cb0 100%);border-radius:12px 12px 0 0;padding:24px 28px;">
        <div style="color:#fff;font-size:20px;font-weight:700;">📈 FiMa-Inv 포트폴리오 리포트</div>
        <div style="color:#90cdf4;font-size:13px;margin-top:4px;">${owner} · ${dateStr} 기준</div>
      </td></tr>

      <!-- 본문 -->
      <tr><td style="background:#fff;border-radius:0 0 12px 12px;padding:24px 28px;">

        <!-- 요약 카드 -->
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:10px;">📊 포트폴리오 요약</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr>
            ${cardHtml('순 투자액', fmtKRW(netInv) + ' KRW', '', '#4a5568')}
            ${cardHtml('평가액', fmtKRW(mktVal) + ' KRW', '', '#4a5568')}
            ${cardHtml('평가 손익', signPrefix(pnlKRW) + fmtKRW(pnlKRW) + ' KRW', fmtPct(pnlPct), signColor(pnlKRW))}
            ${cardHtml('수익률', fmtPct(pnlPct), '', signColor(pnlPct))}
          </tr>
        </table>

        <!-- YTD / MTD / Daily -->
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:10px;">📅 기간별 손익</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            ${periodCardHtml('YTD (연초 이후)', ytd)}
            ${periodCardHtml('MTD (월초 이후)', mtd)}
            ${periodCardHtml('Daily (전일 대비)', daily)}
          </tr>
        </table>

        <!-- 종목 테이블 -->
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:10px;">📋 보유 종목별 수익률</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#edf2f7;">
              <th style="padding:9px 10px;text-align:left;font-size:12px;color:#718096;font-weight:600;">티커</th>
              <th style="padding:9px 10px;text-align:left;font-size:12px;color:#718096;font-weight:600;">종목명</th>
              <th style="padding:9px 10px;text-align:right;font-size:12px;color:#718096;font-weight:600;">현재가</th>
              <th style="padding:9px 10px;text-align:right;font-size:12px;color:#718096;font-weight:600;">투자수익률</th>
              <th style="padding:9px 10px;text-align:right;font-size:12px;color:#718096;font-weight:600;">YTD</th>
              <th style="padding:9px 10px;text-align:right;font-size:12px;color:#718096;font-weight:600;">MTD</th>
            </tr>
          </thead>
          <tbody>${stockRows}</tbody>
        </table>

      </td></tr>

      <!-- 푸터 -->
      <tr><td style="padding:16px 0;text-align:center;">
        <div style="font-size:11px;color:#a0aec0;">FiMa-Inv · fima.lim.kr · 이 메일은 자동 발송됩니다</div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Master 시트에서 이메일 조회 ────────────────────────────────────
async function getOwnerEmail(sheetId: string): Promise<string> {
  try {
    const masterData = await getSheetValues(sheetId, MASTER_SHEET_NAME);
    if (!masterData || masterData.length < 2) return '';
    const headers     = masterData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const emailColIdx = headers.findIndex((h: string) => h === 'email');
    if (emailColIdx === -1) return '';
    for (let i = 1; i < masterData.length; i++) {
      const val = String(masterData[i]?.[emailColIdx] ?? '').trim();
      if (val) return val;
    }
  } catch { /* 조회 실패 시 빈 문자열 */ }
  return '';
}

// ── Resend HTTP API로 이메일 발송 ─────────────────────────────────
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY 환경변수가 없습니다.');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify({
      from   : 'FiMa-Inv <company@lim.kr>',
      to     : [to],
      subject: subject,
      html   : html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend 오류 ${res.status}: ${err}`);
  }
  return true;
}

// ── 메인 핸들러 ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Bearer 토큰 인증
  const auth   = req.headers.get('authorization') || '';
  const secret = process.env.REPORT_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body  = await req.json().catch(() => ({}));
  const targetOwner: string | undefined = body.owner;

  // 대상 owner 목록 결정
  const owners = targetOwner
    ? [targetOwner]
    : Object.keys(OWNER_CONFIG).filter(o => o !== 'Sample');

  const now     = new Date();
  const kstDate = new Date(now.getTime() + 9 * 3600 * 1000);
  const dateStr = `${kstDate.getUTCFullYear()}.${String(kstDate.getUTCMonth() + 1).padStart(2, '0')}.${String(kstDate.getUTCDate()).padStart(2, '0')}`;
  const subject = `[FiMa] 포트폴리오 리포트 ${dateStr}`;

  const results: { owner: string; status: string; email?: string; error?: string }[] = [];

  for (const owner of owners) {
    const cfg = OWNER_CONFIG[owner];
    if (!cfg?.sheetId) {
      results.push({ owner, status: 'skip', error: '등록되지 않은 사용자' });
      continue;
    }

    // 이메일 주소 조회
    const email = await getOwnerEmail(cfg.sheetId);
    if (!email) {
      results.push({ owner, status: 'skip', error: 'EMail 없음' });
      continue;
    }

    try {
      // 포트폴리오 데이터 조회 (내부 API 호출)
      const baseUrl  = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fima.lim.kr';
      const pfRes  = await fetch(`${baseUrl}/api/portfolio-analysis`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ owner }),
      });
      const pfData = await pfRes.json();

      if (!pfData.success || !pfData.summary) {
        results.push({ owner, status: 'fail', email, error: '포트폴리오 조회 실패' });
        continue;
      }

      // HTML 이메일 생성 및 발송
      const html = buildEmailHtml(owner, pfData, dateStr);
      await sendEmail(email, subject, html);

      results.push({ owner, status: 'sent', email });
    } catch (e: any) {
      results.push({ owner, status: 'error', email, error: e.message });
    }
  }

  const sent   = results.filter(r => r.status === 'sent').length;
  const failed = results.filter(r => r.status === 'error' || r.status === 'fail').length;

  return NextResponse.json({ success: true, sent, failed, results });
}
