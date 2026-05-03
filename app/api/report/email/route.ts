import { NextRequest, NextResponse } from 'next/server';
import { OWNER_CONFIG } from '@/lib/config';
import { getSheetValues, MASTER_SHEET_NAME } from '@/lib/sheets';

// ── 숫자 포맷 헬퍼 ────────────────────────────────────────────────

/** 3자리 콤마 구분 정수 (예: 42,840,000) */
function fmtKRW(v: number): string {
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 천원 단위 3자리 콤마 (예: 42,840) */
function fmtKTH(v: number): string {
  return Math.round(v / 1000).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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

// ── 차트 x축 레이블: "2025-05" → "25-05" ───────────────────────────
function toYYMM(month: string): string {
  const s = String(month || '');
  if (s.length >= 7) return s.slice(2, 7);
  if (s.length >= 6) return s.slice(2, 4) + '-' + s.slice(5).padStart(2, '0');
  return s;
}

// ── QuickChart.io PNG 생성 (version=2 → yAxes 형식 콜백 안정 동작) ─

/** 월별 누적 수익률 비교 — 라인 차트 */
function buildReturnChartUrl(monthly: any[], indices: any): string {
  if (!monthly || monthly.length < 2) return '';

  const n      = monthly.length;
  const labels = monthly.map((m: any) => toYYMM(m.month));
  const pfVals = monthly.map((m: any) => parseFloat((m.returnPct ?? 0).toFixed(2)));

  const toArr = (key: string) =>
    ((indices?.[key] || []) as any[]).slice(0, n).map((d: any) =>
      parseFloat((d.returnPct ?? d.pct ?? 0).toFixed(2)));

  const koVals = toArr('KOSPI');
  const spVals = toArr('SP500');
  const nqVals = toArr('NASDAQ');

  // Chart.js v2 형식 — yAxes 배열 + ticks.callback 함수 리터럴
  const cfg = `{
    type:'line',
    data:{
      labels:${JSON.stringify(labels)},
      datasets:[
        {label:'포트폴리오',data:${JSON.stringify(pfVals)},borderColor:'#3b82f6',backgroundColor:'transparent',pointRadius:3,borderWidth:2.5},
        {label:'KOSPI',data:${JSON.stringify(koVals)},borderColor:'#ef4444',backgroundColor:'transparent',borderDash:[5,3],pointRadius:2,borderWidth:1.5},
        {label:'S&P500',data:${JSON.stringify(spVals)},borderColor:'#10b981',backgroundColor:'transparent',borderDash:[5,3],pointRadius:2,borderWidth:1.5},
        {label:'NASDAQ',data:${JSON.stringify(nqVals)},borderColor:'#8b5cf6',backgroundColor:'transparent',borderDash:[5,3],pointRadius:2,borderWidth:1.5}
      ]
    },
    options:{
      legend:{
        position:'bottom',
        labels:{usePointStyle:true,fontSize:9}
      },
      scales:{
        yAxes:[{
          ticks:{
            callback:function(v){return (v>=0?'+':'')+v+'%';},
            fontSize:7
          },
          gridLines:{color:'#e2e8f0'}
        }],
        xAxes:[{
          ticks:{fontSize:7},
          gridLines:{display:false}
        }]
      }
    }
  }`;

  return `https://quickchart.io/chart?c=${encodeURIComponent(cfg)}&width=520&height=230&backgroundColor=white&version=2`;
}

/** 월별 수익금액 — 바 차트 (천원 단위, 3자리 콤마) */
function buildPnlBarChartUrl(monthly: any[]): string {
  if (!monthly || monthly.length < 2) return '';

  const labels = monthly.map((m: any) => toYYMM(m.month));

  const valsKRW = monthly.map((m: any, i: number) => {
    if (i === 0) return 0;
    const cur    = monthly[i].marketValueKRW     ?? 0;
    const prev   = monthly[i - 1].marketValueKRW ?? 0;
    const netChg = (monthly[i].netInvestmentKRW  ?? 0) - (monthly[i - 1].netInvestmentKRW ?? 0);
    return Math.round(cur - prev - netChg);
  });

  const vals   = valsKRW.map((v: number) => Math.round(v / 1000));
  const colors = valsKRW.map((v: number) => v >= 0 ? '#3b82f6' : '#f87171');

  const cfg = `{
    type:'bar',
    data:{
      labels:${JSON.stringify(labels)},
      datasets:[{
        label:'',
        data:${JSON.stringify(vals)},
        backgroundColor:${JSON.stringify(colors)},
        borderColor:${JSON.stringify(colors)},
        borderWidth:1
      }]
    },
    options:{
      legend:{display:false},
      plugins:{
        datalabels:{
          anchor:'end',
          align:'top',
          fontSize:7,
          fontStyle:'bold',
          fontColor:'#374151',
          formatter:function(v){
            if(Math.abs(v)<50)return '';
            var s=v>=0?'+':'-';
            var a=Math.abs(Math.round(v));
            return s+a.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')+'천';
          }
        }
      },
      layout:{padding:{top:18}},
      scales:{
        yAxes:[{
          ticks:{
            callback:function(v){return v.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');},
            fontSize:7
          },
          gridLines:{color:'#e2e8f0'}
        }],
        xAxes:[{
          ticks:{fontSize:7},
          gridLines:{display:false}
        }]
      }
    }
  }`;

  return `https://quickchart.io/chart?c=${encodeURIComponent(cfg)}&width=520&height=200&backgroundColor=white&version=2`;
}

/** 월별 배당금 — 연도별 그룹 바 차트 (천원 단위) */
function buildDivChartUrl(dividends: any[]): string {
  if (!dividends || dividends.length === 0) return '';

  const monthLabels = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const palette = ['#3b82f6','#10b981','#ef4444','#8b5cf6','#f97316','#06b6d4'];

  const datasets = dividends.map((yr: any, i: number) => {
    const data = monthLabels.map((mo: string) => Math.round((yr.months?.[mo] ?? 0) / 1000));
    return { label: String(yr.year), data, color: palette[i % palette.length] };
  });

  const hasData = datasets.some((ds: any) => ds.data.some((v: number) => v > 0));
  if (!hasData) return '';

  const dsJson = datasets.map((ds: any) =>
    `{label:'${ds.label}',data:${JSON.stringify(ds.data)},backgroundColor:'${ds.color}'}`
  ).join(',');

  const cfg = `{
    type:'bar',
    data:{
      labels:${JSON.stringify(monthLabels.map((m: string) => m + '월'))},
      datasets:[${dsJson}]
    },
    options:{
      legend:{position:'bottom',labels:{boxWidth:12,fontSize:9}},
      scales:{
        yAxes:[{
          ticks:{
            callback:function(v){return v.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');},
            fontSize:7
          },
          gridLines:{color:'#e2e8f0'}
        }],
        xAxes:[{
          ticks:{fontSize:7},
          gridLines:{display:false}
        }]
      }
    }
  }`;

  return `https://quickchart.io/chart?c=${encodeURIComponent(cfg)}&width=520&height=220&backgroundColor=white&version=2`;
}

/** 월별 배당금 테이블 HTML (연도별 컬럼, 천원 단위) */
function buildDivTable(dividends: any[]): string {
  if (!dividends || dividends.length === 0) return '';

  const monthLabels = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const monthNames  = ['01월','02월','03월','04월','05월','06월','07월','08월','09월','10월','11월','12월'];
  const years = dividends.map((d: any) => d.year);

  const activeMonths = monthLabels.filter((mo: string) =>
    dividends.some((d: any) => (d.months?.[mo] ?? 0) > 0)
  );
  if (activeMonths.length === 0) return '';

  const totals = dividends.map((d: any) =>
    Object.values(d.months || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0) as number
  );

  const thStyle = 'padding:5px 8px;text-align:right;font-size:11px;color:#718096;font-weight:600;background:#edf2f7;';
  const thL     = 'padding:5px 8px;text-align:left;font-size:11px;color:#718096;font-weight:600;background:#edf2f7;';
  const tdStyle = 'padding:5px 8px;text-align:right;font-size:11px;color:#4a5568;';
  const tdL     = 'padding:5px 8px;text-align:left;font-size:11px;color:#4a5568;font-weight:600;';
  const tdTot   = 'padding:5px 8px;text-align:right;font-size:11px;font-weight:700;color:#2d3748;background:#f7fafc;';
  const tdTotL  = 'padding:5px 8px;text-align:left;font-size:11px;font-weight:700;color:#2d3748;background:#f7fafc;';

  const headerCells = years.map((y: number) => `<th style="${thStyle}">${y}</th>`).join('');
  const rows = activeMonths.map((mo: string) => {
    const cells = dividends.map((d: any) => {
      const v = d.months?.[mo] ?? 0;
      return `<td style="${tdStyle}">${v > 0 ? fmtKTH(v) : '-'}</td>`;
    }).join('');
    return `<tr style="border-bottom:1px solid #edf2f7;">
      <td style="${tdL}">${monthNames[monthLabels.indexOf(mo)]}</td>${cells}
    </tr>`;
  }).join('');

  const totalCells = totals.map((t: number) =>
    `<td style="${tdTot}">${t > 0 ? fmtKTH(t) : '-'}</td>`
  ).join('');

  return `
    <div style="font-size:11px;color:#718096;margin:8px 0 4px;text-align:right;">(단위: 천원)</div>
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <thead>
        <tr><th style="${thL}">월</th>${headerCells}</tr>
      </thead>
      <tbody>
        ${rows}
        <tr><td style="${tdTotL}">합계</td>${totalCells}</tr>
      </tbody>
    </table>`;
}

// ── HTML 이메일 생성 ────────────────────────────────────────────
function buildEmailHtml(owner: string, data: any, dateStr: string): string {
  const s         = data.summary  || {};
  const stocks    = (data.stocks  || []).filter((st: any) => st);
  const monthly   = data.monthly  || [];
  const indices   = data.indices  || {};
  const dividends = data.dividends || [];

  const netInv = s.netInvestmentKRW ?? 0;
  const mktVal = s.marketValueKRW   ?? 0;
  const pnlKRW = s.pnlKRW           ?? 0;
  const pnlPct = s.pnlPct           ?? 0;
  const ytd    = s.ytd;
  const mtd    = s.mtd;
  const daily  = s.daily;

  const returnChartUrl = buildReturnChartUrl(monthly, indices);
  const pnlBarUrl      = buildPnlBarChartUrl(monthly);
  const divChartUrl    = buildDivChartUrl(dividends);
  const divTableHtml   = buildDivTable(dividends);

  const chartImg = (url: string) =>
    `<img src="${url}" width="520" style="display:block;max-width:100%;border-radius:6px;" alt="chart">`;

  const cardHtml = (label: string, val: string, sub: string, col: string) => `
    <td style="width:25%;padding:0 5px;">
      <div style="background:#f7fafc;border-radius:8px;padding:12px 8px;text-align:center;">
        <div style="font-size:11px;color:#718096;margin-bottom:4px;">${label}</div>
        <div style="font-size:13px;font-weight:700;color:#2d3748;">${val}</div>
        ${sub ? `<div style="font-size:11px;color:${col};margin-top:2px;">${sub}</div>` : ''}
      </div>
    </td>`;

  const periodCardHtml = (label: string, d: any) => {
    if (!d) return `
    <td style="width:33%;padding:0 5px;">
      <div style="background:#f7fafc;border-radius:8px;padding:12px 8px;text-align:center;">
        <div style="font-size:11px;color:#718096;margin-bottom:4px;">${label}</div>
        <div style="font-size:13px;font-weight:700;color:#a0aec0;">-</div>
      </div>
    </td>`;
    const col = signColor(d.pnlKRW);
    return `
    <td style="width:33%;padding:0 5px;">
      <div style="background:#f7fafc;border-radius:8px;padding:12px 8px;text-align:center;">
        <div style="font-size:11px;color:#718096;margin-bottom:4px;">${label}</div>
        <div style="font-size:13px;font-weight:700;color:${col};">${signPrefix(d.pnlKRW)}${fmtKRW(d.pnlKRW)} KRW</div>
        <div style="font-size:11px;color:${col};margin-top:2px;">${fmtPct(d.pnlPct)}</div>
      </div>
    </td>`;
  };

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

        <!-- 포트폴리오 요약 카드 4개 -->
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:10px;">📊 포트폴리오 요약</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
          <tr>
            ${cardHtml('순 투자액', fmtKRW(netInv) + ' KRW', '', '#4a5568')}
            ${cardHtml('평가액', fmtKRW(mktVal) + ' KRW', '', '#4a5568')}
            ${cardHtml('평가 손익', signPrefix(pnlKRW) + fmtKRW(pnlKRW) + ' KRW', '', '#4a5568')}
            ${cardHtml('수익률', fmtPct(pnlPct), '', signColor(pnlPct))}
          </tr>
        </table>

        <!-- 기간별 손익 (YTD / MTD / Daily) -->
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:10px;">📅 기간별 손익</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr>
            ${periodCardHtml('YTD (연초 이후)', ytd)}
            ${periodCardHtml('MTD (월초 이후)', mtd)}
            ${periodCardHtml('Daily (전일 대비)', daily)}
          </tr>
        </table>

        <!-- 월별 누적 수익률 비교 -->
        ${returnChartUrl ? `
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:4px;">📈 월별 누적 수익률 비교</div>
        <div style="font-size:11px;color:#718096;margin-bottom:8px;">포트폴리오: 순투자액 대비 평가손익률 / 지수: 동기간 누적 등락률</div>
        <div style="background:#f7fafc;border-radius:8px;padding:12px;margin-bottom:20px;text-align:center;">
          ${chartImg(returnChartUrl)}
        </div>` : ''}

        <!-- 월별 수익금액 -->
        ${pnlBarUrl ? `
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:4px;">💰 월별 수익금액</div>
        <div style="font-size:11px;color:#718096;margin-bottom:8px;">각 월말 기준 (평가액 – 순투자액) 변동분 · 단위: 천원</div>
        <div style="background:#f7fafc;border-radius:8px;padding:12px;margin-bottom:20px;text-align:center;">
          ${chartImg(pnlBarUrl)}
        </div>` : ''}

        <!-- 월별 배당금 -->
        ${divChartUrl ? `
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:4px;">🎁 월별 배당금</div>
        <div style="font-size:11px;color:#718096;margin-bottom:8px;">세금·수수료 차감 후 KRW 환산 기준 · 단위: 천원</div>
        <div style="background:#f7fafc;border-radius:8px;padding:12px;margin-bottom:12px;text-align:center;">
          ${chartImg(divChartUrl)}
        </div>
        ${divTableHtml}` : ''}

        <!-- 보유 종목별 수익률 테이블 -->
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
  const auth   = req.headers.get('authorization') || '';
  const secret = process.env.REPORT_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body        = await req.json().catch(() => ({}));
  const targetOwner: string | undefined = body.owner;
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

    const email = await getOwnerEmail(cfg.sheetId);
    if (!email) {
      results.push({ owner, status: 'skip', error: 'EMail 없음' });
      continue;
    }

    try {
      const baseUrl = process.env.REPORT_BASE_URL || 'https://fima.lim.kr';
      const pfRes   = await fetch(`${baseUrl}/api/portfolio-analysis`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ owner }),
      });
      const pfData = await pfRes.json();

      if (!pfData.success || !pfData.summary) {
        results.push({ owner, status: 'fail', email, error: '포트폴리오 조회 실패' });
        continue;
      }

      const subject = `[${owner}] ${dateStr} 포트폴리오`;
      const html    = buildEmailHtml(owner, pfData, dateStr);
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
