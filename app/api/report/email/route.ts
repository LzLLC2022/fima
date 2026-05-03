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

// ── SVG 월별 누적 수익률 라인 차트 ──────────────────────────────────
function buildReturnChart(monthly: any[], indices: any): string {
  if (!monthly || monthly.length < 2) return '';

  const W = 540, H = 200, PL = 48, PR = 16, PT = 20, PB = 36;
  const cW = W - PL - PR, cH = H - PT - PB;

  // 데이터 추출
  const labels  = monthly.map((m: any) => String(m.month || '').slice(5)); // MM
  const pfVals  = monthly.map((m: any) => m.portfolioReturnPct ?? 0);
  const koVals  = (indices?.KOSPI  || []).map((d: any) => d.pct ?? 0);
  const spVals  = (indices?.sp500  || []).map((d: any) => d.pct ?? 0);
  const nqVals  = (indices?.nasdaq || []).map((d: any) => d.pct ?? 0);

  const n = monthly.length;
  const allVals = [...pfVals, ...koVals.slice(0, n), ...spVals.slice(0, n), ...nqVals.slice(0, n)];
  const minV = Math.min(...allVals, 0);
  const maxV = Math.max(...allVals, 0);
  const range = maxV - minV || 1;

  const xOf = (i: number) => PL + (i / (n - 1)) * cW;
  const yOf = (v: number) => PT + cH - ((v - minV) / range) * cH;

  const polyline = (vals: number[], color: string, dash = '') => {
    if (!vals.length) return '';
    const pts = vals.slice(0, n).map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  };

  // y축 눈금 (3개)
  const ticks = [minV, (minV + maxV) / 2, maxV];
  const yTicks = ticks.map(v => {
    const y = yOf(v).toFixed(1);
    const lbl = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
    return `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>
            <text x="${PL - 4}" y="${(+y + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="#718096">${lbl}</text>`;
  }).join('');

  // 0 기준선
  const y0 = yOf(0).toFixed(1);
  const zeroLine = `<line x1="${PL}" y1="${y0}" x2="${W - PR}" y2="${y0}" stroke="#a0aec0" stroke-width="1" stroke-dasharray="4,3"/>`;

  // x축 레이블
  const xLabels = labels.map((lb, i) => {
    if (n > 8 && i % 2 !== 0) return '';
    return `<text x="${xOf(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#718096">${lb}</text>`;
  }).join('');

  // 범례
  const legend = [
    { label: '포트폴리오', color: '#2b6cb0' },
    { label: 'KOSPI',      color: '#e53e3e' },
    { label: 'S&P500',     color: '#38a169' },
    { label: 'NASDAQ',     color: '#805ad5' },
  ].map((l, i) => `<rect x="${PL + i * 90}" y="4" width="14" height="3" fill="${l.color}" rx="1"/><text x="${PL + i * 90 + 17}" y="9" font-size="9" fill="#4a5568">${l.label}</text>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="display:block;max-width:100%;">
  ${yTicks}
  ${zeroLine}
  ${polyline(koVals, '#e53e3e', '5,3')}
  ${polyline(spVals, '#38a169', '5,3')}
  ${polyline(nqVals, '#805ad5', '5,3')}
  ${polyline(pfVals, '#2b6cb0')}
  ${xLabels}
  ${legend}
</svg>`;
}

// ── SVG 월별 수익금액 바 차트 ─────────────────────────────────────
function buildPnlBarChart(monthly: any[]): string {
  if (!monthly || monthly.length < 2) return '';

  const W = 540, H = 160, PL = 54, PR = 16, PT = 16, PB = 32;
  const cW = W - PL - PR, cH = H - PT - PB;
  const n = monthly.length;

  const vals = monthly.map((m: any) => {
    const cur  = m.marketValueKRW ?? 0;
    const prev = m.prevMarketValueKRW ?? (m.marketValueKRW - (m.pnlKRW ?? 0));
    return (m.pnlKRW ?? 0);
  });

  const maxAbs = Math.max(...vals.map(Math.abs), 1);
  const barW   = Math.max(4, Math.floor(cW / n) - 3);
  const xOf    = (i: number) => PL + (i + 0.5) * (cW / n);
  const y0     = PT + cH / 2;

  const bars = vals.map((v, i) => {
    const bh   = Math.abs(v) / maxAbs * (cH / 2 - 2);
    const x    = (xOf(i) - barW / 2).toFixed(1);
    const y    = v >= 0 ? (y0 - bh).toFixed(1) : y0.toFixed(1);
    const col  = v >= 0 ? '#3182ce' : '#fc8181';
    const lbl  = monthly[i].month?.slice(5) ?? '';
    return `<rect x="${x}" y="${y}" width="${barW}" height="${bh.toFixed(1)}" fill="${col}" rx="1"/>
            <text x="${xOf(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#718096">${lbl}</text>`;
  }).join('');

  // 0 기준선
  const zeroLine = `<line x1="${PL}" y1="${y0}" x2="${W - PR}" y2="${y0}" stroke="#a0aec0" stroke-width="1"/>`;

  // y축 눈금 (상단/하단)
  const fmtShort = (v: number) => {
    const abs = Math.abs(v);
    const sign = v >= 0 ? '+' : '-';
    if (abs >= 100_000_000) return sign + (abs / 100_000_000).toFixed(1) + '억';
    if (abs >= 10_000)      return sign + Math.round(abs / 10_000) + '만';
    return sign + abs.toLocaleString('ko-KR');
  };
  const yTicks = [maxAbs, 0, -maxAbs].map(v => {
    const y = (PT + cH / 2 - (v / maxAbs) * (cH / 2)).toFixed(1);
    return `<line x1="${PL - 3}" y1="${y}" x2="${PL}" y2="${y}" stroke="#cbd5e0" stroke-width="1"/>
            <text x="${PL - 5}" y="${(+y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#718096">${fmtShort(v)}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="display:block;max-width:100%;">
  ${yTicks}
  ${zeroLine}
  ${bars}
</svg>`;
}

// ── HTML 이메일 생성 ────────────────────────────────────────────
function buildEmailHtml(owner: string, data: any, dateStr: string): string {
  const s       = data.summary  || {};
  const stocks  = (data.stocks  || []).filter((st: any) => st);
  const monthly = data.monthly  || [];
  const indices = data.indices  || {};

  const netInv   = s.netInvestmentKRW  ?? 0;
  const mktVal   = s.marketValueKRW    ?? 0;
  const pnlKRW   = s.pnlKRW            ?? 0;
  const pnlPct   = s.pnlPct            ?? 0;
  const ytd      = s.ytd;
  const mtd      = s.mtd;
  const daily    = s.daily;

  // 차트 SVG
  const returnChartSvg = buildReturnChart(monthly, indices);
  const pnlBarSvg      = buildPnlBarChart(monthly);

  // 요약 카드
  const cardHtml = (label: string, val: string, sub: string, col: string) => `
    <td style="width:25%;padding:0 5px;">
      <div style="background:#f7fafc;border-radius:8px;padding:12px 8px;text-align:center;">
        <div style="font-size:11px;color:#718096;margin-bottom:4px;">${label}</div>
        <div style="font-size:14px;font-weight:700;color:#2d3748;">${val}</div>
        ${sub ? `<div style="font-size:11px;color:${col};margin-top:2px;">${sub}</div>` : ''}
      </div>
    </td>`;

  const periodCardHtml = (label: string, d: any) => {
    if (!d) return `
    <td style="width:33%;padding:0 5px;">
      <div style="background:#f7fafc;border-radius:8px;padding:12px 8px;text-align:center;">
        <div style="font-size:11px;color:#718096;margin-bottom:4px;">${label}</div>
        <div style="font-size:14px;font-weight:700;color:#a0aec0;">-</div>
      </div>
    </td>`;
    const col = signColor(d.pnlKRW);
    return `
    <td style="width:33%;padding:0 5px;">
      <div style="background:#f7fafc;border-radius:8px;padding:12px 8px;text-align:center;">
        <div style="font-size:11px;color:#718096;margin-bottom:4px;">${label}</div>
        <div style="font-size:14px;font-weight:700;color:${col};">${signPrefix(d.pnlKRW)}${fmtKRW(d.pnlKRW)} KRW</div>
        <div style="font-size:11px;color:${col};margin-top:2px;">${fmtPct(d.pnlPct)}</div>
      </div>
    </td>`;
  };

  // 종목 테이블 행
  const stockRows = stocks.map((st: any) => {
    const ytdCol = signColor(st.annualReturnPct);
    const mtdCol = signColor(st.monthlyReturnPct);
    const pnlCol = signColor(st.pnlPct);
    return `
      <tr style="border-bottom:1px solid #edf2f7;">
        <td style="padding:7px 8px;font-weight:600;color:#2d3748;font-size:12px;">${st.ticker}</td>
        <td style="padding:7px 8px;color:#4a5568;font-size:11px;">${st.name || '-'}</td>
        <td style="padding:7px 8px;text-align:right;color:#4a5568;font-size:12px;">${st.currentPrice?.toFixed(2) ?? '-'} ${st.currency ?? ''}</td>
        <td style="padding:7px 8px;text-align:right;color:${pnlCol};font-weight:600;font-size:12px;">${st.pnlPct != null ? fmtPct(st.pnlPct) : '-'}</td>
        <td style="padding:7px 8px;text-align:right;color:${ytdCol};font-weight:600;font-size:12px;">${fmtPct(st.annualReturnPct)}</td>
        <td style="padding:7px 8px;text-align:right;color:${mtdCol};font-weight:600;font-size:12px;">${fmtPct(st.monthlyReturnPct)}</td>
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
        <div style="color:#fff;font-size:20px;font-weight:700;">📈 FiMa-Inv 포트폴리오</div>
        <div style="color:#90cdf4;font-size:13px;margin-top:4px;">${owner} · ${dateStr} 기준</div>
      </td></tr>

      <!-- 본문 -->
      <tr><td style="background:#fff;border-radius:0 0 12px 12px;padding:24px 28px;">

        <!-- 요약 카드 -->
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:10px;">📊 포트폴리오 요약</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
          <tr>
            ${cardHtml('순 투자액', fmtKRW(netInv) + ' KRW', '', '#4a5568')}
            ${cardHtml('평가액', fmtKRW(mktVal) + ' KRW', '', '#4a5568')}
            ${cardHtml('평가 손익', signPrefix(pnlKRW) + fmtKRW(pnlKRW) + ' KRW', fmtPct(pnlPct), signColor(pnlKRW))}
            ${cardHtml('수익률', fmtPct(pnlPct), '', signColor(pnlPct))}
          </tr>
        </table>

        <!-- YTD / MTD / Daily -->
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:10px;">📅 기간별 손익</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr>
            ${periodCardHtml('YTD (연초 이후)', ytd)}
            ${periodCardHtml('MTD (월초 이후)', mtd)}
            ${periodCardHtml('Daily (전일 대비)', daily)}
          </tr>
        </table>

        <!-- 월별 누적 수익률 차트 -->
        ${returnChartSvg ? `
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:8px;">📈 월별 누적 수익률 비교</div>
        <div style="background:#f7fafc;border-radius:8px;padding:12px;margin-bottom:20px;overflow:hidden;">
          ${returnChartSvg}
        </div>` : ''}

        <!-- 월별 수익금액 바 차트 -->
        ${pnlBarSvg ? `
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:8px;">💰 월별 수익금액 (KRW)</div>
        <div style="background:#f7fafc;border-radius:8px;padding:12px;margin-bottom:20px;overflow:hidden;">
          ${pnlBarSvg}
        </div>` : ''}

        <!-- 종목 테이블 -->
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:10px;">📋 보유 종목별 수익률</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#edf2f7;">
              <th style="padding:8px;text-align:left;font-size:11px;color:#718096;font-weight:600;">티커</th>
              <th style="padding:8px;text-align:left;font-size:11px;color:#718096;font-weight:600;">종목명</th>
              <th style="padding:8px;text-align:right;font-size:11px;color:#718096;font-weight:600;">현재가</th>
              <th style="padding:8px;text-align:right;font-size:11px;color:#718096;font-weight:600;">투자수익률</th>
              <th style="padding:8px;text-align:right;font-size:11px;color:#718096;font-weight:600;">YTD</th>
              <th style="padding:8px;text-align:right;font-size:11px;color:#718096;font-weight:600;">MTD</th>
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

  const body        = await req.json().catch(() => ({}));
  const targetOwner: string | undefined = body.owner;

  // 대상 owner 목록 결정
  const owners = targetOwner
    ? [targetOwner]
    : Object.keys(OWNER_CONFIG).filter(o => o !== 'Sample');

  const now     = new Date();
  const kstDate = new Date(now.getTime() + 9 * 3600 * 1000);
  const dateStr = `${kstDate.getUTCFullYear()}.${String(kstDate.getUTCMonth() + 1).padStart(2, '0')}.${String(kstDate.getUTCDate()).padStart(2, '0')}`;

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
      const baseUrl = process.env.REPORT_BASE_URL || 'https://fima.lim.kr';
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

      // owner별 제목: [Lz] 2026.05.03 포트폴리오
      const subject = `[${owner}] ${dateStr} 포트폴리오`;

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
