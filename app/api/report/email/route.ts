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

// ── QuickChart.io 이미지 URL 생성 (Gmail 호환 PNG) ──────────────────

/** 월별 누적 수익률 비교 — 라인 차트 */
function buildReturnChartUrl(monthly: any[], indices: any): string {
  if (!monthly || monthly.length < 2) return '';

  const n      = monthly.length;
  const labels = monthly.map((m: any) => String(m.month || '').slice(5));

  // 월별 누적 수익률: 첫 월 기준 (returnPct는 전체 누적이므로 그대로 사용)
  const pfVals = monthly.map((m: any) => parseFloat((m.returnPct ?? 0).toFixed(2)));

  // 지수 수익률 (API가 returnPct 필드로 반환)
  const toArr = (key: string) =>
    ((indices?.[key] || []) as any[]).slice(0, n).map((d: any) =>
      parseFloat((d.returnPct ?? d.pct ?? 0).toFixed(2)));

  const koVals = toArr('KOSPI');
  const spVals = toArr('SP500');
  const nqVals = toArr('NASDAQ');

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '포트폴리오', data: pfVals, borderColor: '#2b6cb0', backgroundColor: 'transparent', pointRadius: 3, borderWidth: 2.5 },
        { label: 'KOSPI',      data: koVals, borderColor: '#e53e3e', backgroundColor: 'transparent', borderDash: [5, 3], pointRadius: 2, borderWidth: 1.5 },
        { label: 'S&P500',     data: spVals, borderColor: '#38a169', backgroundColor: 'transparent', borderDash: [5, 3], pointRadius: 2, borderWidth: 1.5 },
        { label: 'NASDAQ',     data: nqVals, borderColor: '#805ad5', backgroundColor: 'transparent', borderDash: [5, 3], pointRadius: 2, borderWidth: 1.5 },
      ],
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y: {
          ticks: {
            callback: "function(v){return (v>=0?'+':'')+v.toFixed(1)+'%'}",
            font: { size: 10 },
          },
          grid: { color: '#e2e8f0' },
        },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  };

  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(cfg))}&width=520&height=220&backgroundColor=white`;
}

/** 월별 수익금액 — 바 차트 */
function buildPnlBarChartUrl(monthly: any[]): string {
  if (!monthly || monthly.length < 2) return '';

  const labels = monthly.map((m: any) => String(m.month || '').slice(5));

  // 월간 P&L = 당월 평가액 - 전월 평가액 (월별 변동분)
  const vals = monthly.map((m: any, i: number) => {
    if (i === 0) return 0;
    const cur  = monthly[i].marketValueKRW   ?? 0;
    const prev = monthly[i - 1].marketValueKRW ?? 0;
    // 순투자액 변동을 제거하여 순수 수익금액 추정
    const netChg = (monthly[i].netInvestmentKRW ?? 0) - (monthly[i - 1].netInvestmentKRW ?? 0);
    return Math.round(cur - prev - netChg);
  });

  const colors = vals.map((v: number) => v >= 0 ? '#3182ce' : '#fc8181');

  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: vals,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: {
          ticks: {
            callback: "function(v){const a=Math.abs(v);const s=v>=0?'+':'-';if(a>=100000000)return s+(a/100000000).toFixed(1)+'억';if(a>=10000)return s+Math.round(a/10000)+'만';return (v>=0?'+':'')+v}",
            font: { size: 10 },
          },
          grid: { color: '#e2e8f0' },
        },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  };

  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(cfg))}&width=520&height=180&backgroundColor=white`;
}

/** 월별 배당금 — 연도별 그룹 바 차트 */
function buildDivChartUrl(dividends: any[]): string {
  if (!dividends || dividends.length === 0) return '';

  // 전체 월 레이블 01~12
  const monthLabels = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const colors = ['#3182ce','#38a169','#e53e3e','#805ad5','#dd6b20'];

  const datasets = dividends.map((yr: any, i: number) => ({
    label: String(yr.year),
    data: monthLabels.map(mo => yr.months?.[mo] ?? 0),
    backgroundColor: colors[i % colors.length],
    borderRadius: 2,
  }));

  // 데이터가 전부 0이면 차트 생략
  const hasData = datasets.some(ds => ds.data.some((v: number) => v > 0));
  if (!hasData) return '';

  const cfg = {
    type: 'bar',
    data: { labels: monthLabels, datasets },
    options: {
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y: {
          ticks: {
            callback: "function(v){const a=Math.abs(v);if(a>=100000000)return (v/100000000).toFixed(1)+'억';if(a>=10000)return Math.round(v/10000)+'만';return v}",
            font: { size: 10 },
          },
          grid: { color: '#e2e8f0' },
        },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  };

  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(cfg))}&width=520&height=200&backgroundColor=white`;
}

// ── HTML 이메일 생성 ────────────────────────────────────────────
function buildEmailHtml(owner: string, data: any, dateStr: string): string {
  const s         = data.summary  || {};
  const stocks    = (data.stocks  || []).filter((st: any) => st);
  const monthly   = data.monthly  || [];
  const indices   = data.indices  || {};
  const dividends = data.dividends || [];

  const netInv   = s.netInvestmentKRW  ?? 0;
  const mktVal   = s.marketValueKRW    ?? 0;
  const pnlKRW   = s.pnlKRW            ?? 0;
  const pnlPct   = s.pnlPct            ?? 0;
  const ytd      = s.ytd;
  const mtd      = s.mtd;
  const daily    = s.daily;

  // 차트 이미지 URL (QuickChart.io → PNG)
  const returnChartUrl = buildReturnChartUrl(monthly, indices);
  const pnlBarUrl      = buildPnlBarChartUrl(monthly);
  const divChartUrl    = buildDivChartUrl(dividends);

  const chartImg = (url: string) =>
    `<img src="${url}" width="520" style="display:block;max-width:100%;border-radius:6px;" alt="chart">`;

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
        ${returnChartUrl ? `
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:8px;">📈 월별 누적 수익률 비교</div>
        <div style="background:#f7fafc;border-radius:8px;padding:12px;margin-bottom:20px;text-align:center;">
          ${chartImg(returnChartUrl)}
        </div>` : ''}

        <!-- 월별 수익금액 바 차트 -->
        ${pnlBarUrl ? `
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:8px;">💰 월별 수익금액 (KRW)</div>
        <div style="background:#f7fafc;border-radius:8px;padding:12px;margin-bottom:20px;text-align:center;">
          ${chartImg(pnlBarUrl)}
        </div>` : ''}

        <!-- 월별 배당금 차트 -->
        ${divChartUrl ? `
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:8px;">🎁 월별 배당금 (KRW)</div>
        <div style="background:#f7fafc;border-radius:8px;padding:12px;margin-bottom:20px;text-align:center;">
          ${chartImg(divChartUrl)}
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
