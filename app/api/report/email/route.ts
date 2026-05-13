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

/** 현재가 포맷 — 정수부 3자리 콤마, 소수점 2자리 (예: 7,230.00 / 9,986.67) */
function fmtPrice(v: number): string {
  const parts = v.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
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
  const labels  = monthly.map((m: any) => toYYMM(m.month));
  // 포트폴리오: 첫 월 기준 누적수익률로 정규화 (지수와 동일 기준)
  const pfRaw   = monthly.map((m: any) => parseFloat((m.returnPct ?? 0).toFixed(2)));
  const pfBase  = pfRaw.length > 0 ? pfRaw[0] : 0;
  const pfVals  = pfBase > -100
    ? pfRaw.map((v: number) => parseFloat(((((1 + v / 100) / (1 + pfBase / 100)) - 1) * 100).toFixed(2)))
    : pfRaw.map(() => 0);

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

  return `https://quickchart.io/chart?c=${encodeURIComponent(cfg)}&width=580&height=240&backgroundColor=white&version=2`;
}

/** 월별 수익금액 — 바 차트 (만원 단위, 레이블 없음) */
function buildPnlBarChartUrl(monthly: any[], basePnl: number): string {
  if (!monthly || monthly.length === 0) return '';

  const labels = monthly.map((m: any) => toYYMM(m.month));

  // 월별 수익금액 = 이번달 누적손익 - 전달 누적손익
  // 첫 달은 basePnl(직전 월 누적손익)을 기준으로 사용 → 앱과 동일 값
  const valsKRW = monthly.map((m: any, i: number) => {
    const curPnl  = (m.marketValueKRW ?? 0) - (m.netInvestmentKRW ?? 0);
    const prevPnl = i > 0
      ? ((monthly[i - 1].marketValueKRW ?? 0) - (monthly[i - 1].netInvestmentKRW ?? 0))
      : (basePnl ?? 0);
    return Math.round(curPnl - prevPnl);
  });

  // 만원 단위로 변환 (÷10000)
  const vals   = valsKRW.map((v: number) => Math.round(v / 10000));
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
      plugins:{datalabels:{display:false}},
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

  return `https://quickchart.io/chart?c=${encodeURIComponent(cfg)}&width=580&height=200&backgroundColor=white&version=2`;
}

/** 월별 수익금액 테이블 HTML (만원 단위, 월별 컬럼) */
function buildPnlTable(monthly: any[], basePnl: number): string {
  if (!monthly || monthly.length === 0) return '';

  // 월별 수익금액 계산 (차트와 동일 로직)
  const rows = monthly.map((m: any, i: number) => {
    const curPnl  = (m.marketValueKRW ?? 0) - (m.netInvestmentKRW ?? 0);
    const prevPnl = i > 0
      ? ((monthly[i - 1].marketValueKRW ?? 0) - (monthly[i - 1].netInvestmentKRW ?? 0))
      : (basePnl ?? 0);
    return { month: toYYMM(m.month), pnl: Math.round(curPnl - prevPnl) };
  });

  const total = rows.reduce((s, r) => s + r.pnl, 0);

  const fmtMAN = (v: number) => {
    const man = Math.round(v / 10000);
    const abs = Math.abs(man).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (man >= 0 ? '+' : '-') + abs;
  };

  const posCol = '#2b6cb0';
  const negCol = '#c53030';
  const col    = (v: number) => v >= 0 ? posCol : negCol;

  const thBase = 'padding:5px 6px;font-size:10px;color:#718096;font-weight:600;background:#edf2f7;white-space:nowrap;';
  const thR    = thBase + 'text-align:right;';
  const thL    = thBase + 'text-align:left;';

  const headers = rows.map(r =>
    `<th style="${thR}">${r.month}</th>`
  ).join('');

  const cells = rows.map(r =>
    `<td style="padding:5px 6px;text-align:right;font-size:10px;color:${col(r.pnl)};font-weight:600;">${fmtMAN(r.pnl)}</td>`
  ).join('');

  const totStyle = `padding:5px 6px;text-align:right;font-size:10px;font-weight:700;color:${col(total)};background:#f7fafc;`;

  return `
    <div style="font-size:10px;color:#718096;margin:6px 0 3px;text-align:right;">(단위: 만원)</div>
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <thead>
        <tr>
          <th style="${thL}">월</th>
          ${headers}
          <th style="${thR}">합계</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:5px 6px;font-size:10px;color:#4a5568;font-weight:600;white-space:nowrap;">수익금액</td>
          ${cells}
          <td style="${totStyle}">${fmtMAN(total)}</td>
        </tr>
      </tbody>
    </table>`;
}

/** 월별 배당금 — 연도별 그룹 바 차트 (만원 단위, 데이터 있는 월까지만 표시) */
function buildDivChartUrl(dividends: any[]): string {
  if (!dividends || dividends.length === 0) return '';

  const allMonths = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const palette   = ['#3b82f6','#10b981','#ef4444','#8b5cf6','#f97316','#06b6d4'];

  // 데이터가 있는 마지막 월 인덱스까지만 표시 (오른쪽 빈 공간 제거)
  let lastActiveIdx = -1;
  allMonths.forEach((mo, idx) => {
    if (dividends.some((yr: any) => (yr.months?.[mo] ?? 0) > 0)) lastActiveIdx = idx;
  });
  if (lastActiveIdx === -1) return '';

  const monthLabels = allMonths.slice(0, lastActiveIdx + 1);

  const datasets = dividends.map((yr: any, i: number) => {
    const data = monthLabels.map((mo: string) => Math.round((yr.months?.[mo] ?? 0) / 10000));
    return { label: String(yr.year), data, color: palette[i % palette.length] };
  });

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

  return `https://quickchart.io/chart?c=${encodeURIComponent(cfg)}&width=580&height=230&backgroundColor=white&version=2`;
}

/** 월별 배당금 테이블 HTML (행=연도, 열=월, 만원 단위) — 인앱 현황>리포트 레이아웃과 동일 */
function buildDivTable(
  dividends: any[],
  tickerMonthlyDivKRW?: Record<string, Record<string, number>>,
  stocks?: any[]
): string {
  if (!dividends || dividends.length === 0) return '';

  const monthCols  = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

  // ── 올해 예상배당 계산 (Yahoo Finance 주당월배당 × 현재수량) ──────
  const thisYear   = new Date().getFullYear().toString();
  const thisYrDiv  = dividends.find((d: any) => String(d.year) === thisYear);
  const curQtyMap: Record<string, number> = {};
  (stocks || []).forEach((s: any) => { if (s?.ticker && (s.qty ?? 0) > 0) curQtyMap[s.ticker] = s.qty; });

  const expMonths: Record<string, number> = {};  // mo → KRW
  let   expTotal   = 0;
  let   hasEst     = false;

  if (thisYrDiv && tickerMonthlyDivKRW && Object.keys(curQtyMap).length > 0) {
    monthCols.forEach((mo: string) => {
      if (thisYrDiv.months?.[mo]) {
        // 실적 달
        expMonths[mo] = thisYrDiv.months[mo];
        expTotal += thisYrDiv.months[mo];
      } else {
        // 예상 달
        let estVal = 0;
        Object.entries(curQtyMap).forEach(([tk, qty]) => {
          const psk = tickerMonthlyDivKRW[tk]?.[mo] ?? 0;
          if (psk > 0) estVal += psk * qty;
        });
        if (estVal > 0) {
          expMonths[mo] = Math.round(estVal);
          expTotal += Math.round(estVal);
          hasEst = true;
        }
      }
    });
  }

  // 실제 데이터 또는 예상 데이터가 있는 월만 열 표시
  const activeIdxs = monthCols.reduce((acc: number[], mo, idx) => {
    const hasReal = dividends.some((d: any) => (d.months?.[mo] ?? 0) > 0);
    const hasExp  = (expMonths[mo] ?? 0) > 0;
    if (hasReal || hasExp) acc.push(idx);
    return acc;
  }, []);
  if (activeIdxs.length === 0) return '';

  // 만원 단위 포맷 (0이면 '-')
  const fmtMAN_d = (v: number): string => {
    const man = Math.round(v / 10000);
    if (man === 0) return '-';
    return man.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  const rowBgs = ['#ffffff','#f0f7ff','#f0fff4','#fff5f5','#faf5ff','#fffaf0'];

  const thStyle = 'padding:4px 5px;text-align:right;font-size:10px;color:#718096;font-weight:600;background:#edf2f7;white-space:nowrap;';
  const thL     = 'padding:4px 5px;text-align:left;font-size:10px;color:#718096;font-weight:600;background:#edf2f7;white-space:nowrap;';
  const tdTotL  = 'padding:4px 5px;text-align:left;font-size:10px;font-weight:700;color:#2d3748;background:#f7fafc;white-space:nowrap;';
  const tdTotR  = 'padding:4px 5px;text-align:right;font-size:10px;font-weight:700;color:#2d3748;background:#f7fafc;white-space:nowrap;';

  const headerCells = activeIdxs.map(idx =>
    `<th style="${thStyle}">${monthNames[idx]}</th>`
  ).join('');

  // 연도별 행
  const dataRows = dividends.map((d: any, yi: number) => {
    const bg    = rowBgs[yi % rowBgs.length];
    const tdR   = `padding:4px 5px;text-align:right;font-size:10px;color:#4a5568;background:${bg};white-space:nowrap;`;
    const tdL   = `padding:4px 5px;text-align:left;font-size:10px;color:#2d3748;font-weight:600;background:${bg};white-space:nowrap;`;
    const tdSum = `padding:4px 5px;text-align:right;font-size:10px;font-weight:700;color:#2d3748;background:${bg};white-space:nowrap;`;
    const cells = activeIdxs.map(idx => {
      const v = d.months?.[monthCols[idx]] ?? 0;
      return `<td style="${tdR}">${fmtMAN_d(v)}</td>`;
    }).join('');
    const yearTotal = Object.values(d.months || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0) as number;
    return `<tr style="border-bottom:1px solid #edf2f7;">
      <td style="${tdL}">${d.year}</td>${cells}
      <td style="${tdSum}">${fmtMAN_d(yearTotal)}</td>
    </tr>`;
  }).join('');

  // 예상배당 행
  const expRow = (hasEst && expTotal > 0) ? (() => {
    const tdExpL = 'padding:4px 5px;text-align:left;font-size:10px;font-weight:700;color:#805ad5;background:#faf5ff;white-space:nowrap;';
    const cells  = activeIdxs.map(idx => {
      const mo  = monthCols[idx];
      const v   = expMonths[mo] ?? 0;
      const isAct = !!(thisYrDiv?.months?.[mo]);
      const style = isAct
        ? 'padding:4px 5px;text-align:right;font-size:10px;font-weight:600;color:#553c9a;background:#faf5ff;white-space:nowrap;'
        : 'padding:4px 5px;text-align:right;font-size:10px;color:#b794f4;font-style:italic;background:#faf5ff;white-space:nowrap;';
      return `<td style="${style}">${v > 0 ? fmtMAN_d(v) : '-'}</td>`;
    }).join('');
    return `<tr style="border-bottom:1px solid #e9d8fd;">
      <td style="${tdExpL}">예상 (${thisYear})<div style="font-size:9px;font-weight:400;color:#b794f4;">주당월배당×현재수량</div></td>
      ${cells}
      <td style="padding:4px 5px;text-align:right;font-size:10px;font-weight:700;color:#805ad5;background:#faf5ff;white-space:nowrap;">${fmtMAN_d(expTotal)}</td>
    </tr>`;
  })() : '';

  // 월별 합계 행
  const monthSums = monthCols.map(mo =>
    dividends.reduce((s: number, d: any) => s + (d.months?.[mo] ?? 0), 0)
  );
  const grandTotal = monthSums.reduce((s, v) => s + v, 0);
  const sumCells = activeIdxs.map(idx =>
    `<td style="${tdTotR}">${fmtMAN_d(monthSums[idx])}</td>`
  ).join('');

  return `
    <div style="font-size:10px;color:#718096;margin:6px 0 3px;text-align:right;">(단위: 만원)</div>
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <thead>
        <tr><th style="${thL}">연도</th>${headerCells}<th style="${thStyle}">합계</th></tr>
      </thead>
      <tbody>
        ${dataRows}
        ${expRow}
        <tr><td style="${tdTotL}">합계</td>${sumCells}<td style="${tdTotR}">${fmtMAN_d(grandTotal)}</td></tr>
      </tbody>
    </table>`;
}

// ── AccountOwner 단위 섹션 내용 HTML ──────────────────────────────
function buildSectionContent(accountOwner: string, data: any): string {
  // 거래 기록 없는 경우
  if (!data.summary) {
    return `
        <div style="padding:24px;text-align:center;color:#a0aec0;background:#f7fafc;border-radius:8px;border:1px dashed #e2e8f0;">
          <div style="font-size:28px;margin-bottom:8px;">📭</div>
          <div style="font-size:14px;font-weight:600;color:#718096;">거래 기록이 없습니다</div>
          <div style="font-size:12px;margin-top:4px;">아직 Ledger 시트에 거래 내역이 없습니다.</div>
        </div>`;
  }

  const s         = data.summary  || {};
  const stocks    = (data.stocks  || []).filter((st: any) => st);
  const monthly   = data.monthly  || [];
  const indices   = data.indices  || {};
  // 최근 4개년만 표시 (현재 연도 기준: 예) 2026 → 2023~2026)
  const allDividends = data.dividends || [];
  const _curYear  = new Date().getFullYear();
  const _startYear = _curYear - 3;
  const dividends = allDividends.filter((d: any) => parseInt(d.year) >= _startYear);

  const netInv = s.netInvestmentKRW ?? 0;
  const mktVal = s.marketValueKRW   ?? 0;
  const pnlKRW = s.pnlKRW           ?? 0;
  const pnlPct = s.pnlPct           ?? 0;
  const ytd    = s.ytd;
  const mtd    = s.mtd;
  const daily  = s.daily;

  const tickerMonthlyDivKRW = data.tickerMonthlyDivKRW || {};

  const basePnl        = data.basePnl ?? 0;
  const returnChartUrl = buildReturnChartUrl(monthly, indices);
  const pnlBarUrl      = buildPnlBarChartUrl(monthly, basePnl);
  const pnlTableHtml   = buildPnlTable(monthly, basePnl);
  const divChartUrl    = buildDivChartUrl(dividends);
  const divTableHtml   = buildDivTable(dividends, tickerMonthlyDivKRW, stocks);

  const chartImg = (url: string) =>
    `<img src="${url}" width="580" style="display:block;margin:0 auto;max-width:100%;border-radius:6px;" alt="chart">`;

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
    const cur      = st.currency ?? '';
    const isKRW    = cur === 'KRW';
    const fmtFX    = (v: number) => isKRW
      ? Math.round(v).toLocaleString('ko-KR')
      : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtPrc   = (v: number) => isKRW
      ? Math.round(v).toLocaleString('ko-KR')
      : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const fmtQty   = (q: number) =>
      q % 1 === 0 ? Math.round(q).toLocaleString('ko-KR')
                  : q.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
    const sub      = (txt: string) =>
      `<div style="font-size:10px;color:#a0aec0;margin-top:2px;">${txt}</div>`;
    const priceSub = (diff: number | null) => {
      if (diff == null) return '';
      const sign = diff >= 0 ? '+' : '';
      const col  = diff >= 0 ? '#38a169' : '#e53e3e';
      return `<div style="font-size:10px;color:${col};margin-top:2px;">${sign}${fmtPrc(diff)}&nbsp;${cur}</div>`;
    };

    const avgPrice   = st.buyCostFX > 0 && st.qty > 0 ? st.buyCostFX / st.qty : 0;
    const ytdDiff    = avgPrice > 0 && st.yearStartPrice  > 0 ? avgPrice - st.yearStartPrice  : null;
    const mtdDiff    = avgPrice > 0 && st.monthStartPrice > 0 ? avgPrice - st.monthStartPrice : null;

    const ytdCol = signColor(st.annualReturnPct);
    const mtdCol = signColor(st.monthlyReturnPct);
    const pnlCol = signColor(st.pnlPct);

    // 매입금액 셀: 총매입금액 + 매입단가×수량
    const acCell = st.buyCostFX > 0
      ? fmtFX(st.buyCostFX) + '&nbsp;' + cur
        + (avgPrice > 0 ? sub(fmtPrc(avgPrice) + '&nbsp;×&nbsp;' + fmtQty(st.qty)) : '')
      : '-';

    // 평가금액 셀: 총평가금액 + 현재가×수량
    const mvCell = st.marketValueFX > 0
      ? fmtFX(st.marketValueFX) + '&nbsp;' + cur
        + (st.currentPrice > 0 && st.qty > 0 ? sub(fmtPrc(st.currentPrice) + '&nbsp;×&nbsp;' + fmtQty(st.qty)) : '')
      : '-';

    // YTD/MTD 셀: % + 수식(매입단가−기준가)
    const ytdCell = st.annualReturnPct  != null
      ? `<span style="color:${ytdCol};font-weight:600;">${fmtPct(st.annualReturnPct)}</span>`
        + (ytdDiff != null ? priceSub(ytdDiff) : '')
      : '-';
    const mtdCell = st.monthlyReturnPct != null
      ? `<span style="color:${mtdCol};font-weight:600;">${fmtPct(st.monthlyReturnPct)}</span>`
        + (mtdDiff != null ? priceSub(mtdDiff) : '')
      : '-';

    // 손익 셀: 현지통화 손익 + KRW 환산 서브라인 (해외 종목)
    const pnlFXVal  = st.pnlFX  ?? null;
    const pnlKRWVal = st.pnlKRW ?? null;
    const pnlFXCol  = signColor(pnlFXVal);
    const pnlFXCell = pnlFXVal != null
      ? `<span style="color:${pnlFXCol};font-weight:600;">${pnlFXVal >= 0 ? '+' : ''}${fmtFX(Math.abs(pnlFXVal))}&nbsp;${cur}</span>`
        + (!isKRW && pnlKRWVal != null ? sub(`${pnlKRWVal >= 0 ? '+' : ''}${fmtKRW(Math.abs(pnlKRWVal))} KRW`) : '')
      : '-';

    // 누적배당금 셀: cumDividendKRW
    const cumDiv     = st.cumDividendKRW ?? 0;
    const cumDivCell = cumDiv > 0
      ? `<span style="color:#276749;font-weight:600;">${fmtKRW(cumDiv)} KRW</span>`
      : '-';

    return `
      <tr style="border-bottom:1px solid #edf2f7;">
        <td style="padding:7px 8px;font-weight:600;color:#2d3748;font-size:12px;">${st.ticker}</td>
        <td style="padding:7px 8px;color:#4a5568;font-size:11px;">${st.name || '-'}</td>
        <td style="padding:7px 8px;text-align:right;font-size:12px;">${acCell}</td>
        <td style="padding:7px 8px;text-align:right;font-size:12px;">${mvCell}</td>
        <td style="padding:7px 8px;text-align:right;font-size:12px;">${pnlFXCell}</td>
        <td style="padding:7px 8px;text-align:right;color:${pnlCol};font-weight:600;font-size:12px;">${st.pnlPct != null ? fmtPct(st.pnlPct) : '-'}</td>
        <td style="padding:7px 8px;text-align:right;font-size:12px;">${cumDivCell}</td>
        <td style="padding:7px 8px;text-align:right;font-size:12px;">${ytdCell}</td>
        <td style="padding:7px 8px;text-align:right;font-size:12px;">${mtdCell}</td>
      </tr>`;
  }).join('');

  return `
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
        <div style="font-size:11px;color:#718096;margin-bottom:8px;">포트폴리오·지수 모두 분석 시작 시점(첫 월) 대비 누적 등락률</div>
        <div style="background:#f7fafc;border-radius:8px;padding:12px;margin-bottom:20px;text-align:center;">
          ${chartImg(returnChartUrl)}
        </div>` : ''}

        <!-- 월별 수익금액 -->
        ${pnlBarUrl ? `
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:4px;">💰 월별 수익금액</div>
        <div style="font-size:11px;color:#718096;margin-bottom:8px;">각 월말 기준 (평가액 – 순투자액) 변동분 · 단위: 만원</div>
        <div style="background:#f7fafc;border-radius:8px;padding:12px;margin-bottom:10px;text-align:center;">
          ${chartImg(pnlBarUrl)}
        </div>
        ${pnlTableHtml}` : ''}

        <!-- 월별 배당금 -->
        ${divChartUrl ? `
        <div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:4px;">🎁 월별 배당금</div>
        <div style="font-size:11px;color:#718096;margin-bottom:8px;">세금·수수료 차감 후 KRW 환산 기준 · 단위: 만원</div>
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
              <th style="padding:8px;text-align:right;font-size:11px;color:#718096;font-weight:600;">매입금액</th>
              <th style="padding:8px;text-align:right;font-size:11px;color:#718096;font-weight:600;">평가금액</th>
              <th style="padding:8px;text-align:right;font-size:11px;color:#718096;font-weight:600;">손익</th>
              <th style="padding:8px;text-align:right;font-size:11px;color:#718096;font-weight:600;">투자수익률</th>
              <th style="padding:8px;text-align:right;font-size:11px;color:#718096;font-weight:600;">누적배당금</th>
              <th style="padding:8px;text-align:right;font-size:11px;color:#718096;font-weight:600;">YTD</th>
              <th style="padding:8px;text-align:right;font-size:11px;color:#718096;font-weight:600;">MTD</th>
            </tr>
          </thead>
          <tbody>${stockRows}</tbody>
        </table>`;
}

// ── HTML 이메일 생성 (복수 AccountOwner 통합) ──────────────────────
function buildEmailHtml(
  owner: string,
  sections: Array<{ accountOwner: string; data: any }>,
  dateStr: string
): string {
  const showHeaders = sections.length > 1;

  const sectionsHtml = sections.map((sec, idx) => {
    const aoHeader = showHeaders
      ? `<div style="font-size:15px;font-weight:700;color:#1a365d;margin:${idx > 0 ? '28px' : '0'} 0 16px;padding:10px 12px;background:#ebf4ff;border-left:4px solid #3b82f6;border-radius:4px;">📂 ${sec.accountOwner}</div>`
      : '';
    return aoHeader + buildSectionContent(sec.accountOwner, sec.data);
  }).join('<div style="border-top:2px dashed #e2e8f0;margin:28px 0;"></div>');

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:24px 0;">
  <tr><td align="center">
    <table width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;">

      <!-- 헤더 -->
      <tr><td style="background:linear-gradient(135deg,#1a365d 0%,#2b6cb0 100%);border-radius:12px 12px 0 0;padding:24px 28px;">
        <div style="color:#fff;font-size:20px;font-weight:700;">📈 FiMa-Inv 포트폴리오</div>
        <div style="color:#90cdf4;font-size:13px;margin-top:4px;">${owner} · ${dateStr} 기준</div>
      </td></tr>

      <!-- 본문 -->
      <tr><td style="background:#fff;border-radius:0 0 12px 12px;padding:24px 28px;">
        ${sectionsHtml}
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

// ── Master 시트에서 이메일 조회 (EmailRecv = N 이면 빈 문자열 반환) ──
async function getOwnerEmail(sheetId: string): Promise<string> {
  try {
    const masterData = await getSheetValues(sheetId, MASTER_SHEET_NAME);
    if (!masterData || masterData.length < 2) return '';
    const headers     = masterData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const emailColIdx = headers.findIndex((h: string) => h === 'email');
    if (emailColIdx === -1) return '';
    const recvColIdx  = headers.findIndex((h: string) => h === 'emailrecv');

    for (let i = 1; i < masterData.length; i++) {
      const email = String(masterData[i]?.[emailColIdx] ?? '').trim();
      if (!email) continue;

      // EmailRecv 컬럼이 있고 명시적으로 N인 경우만 수신 거부 (기본값: 수신함)
      if (recvColIdx !== -1) {
        const recv = String(masterData[i]?.[recvColIdx] ?? '').trim().toLowerCase();
        const isOptOut = recv === 'n' || recv === '0' || recv === 'false';
        if (isOptOut) return ''; // 명시적 수신 거부
      }
      // EmailRecv 컬럼 없거나 값이 Y/N 미설정이면 수신함으로 처리

      return email;
    }
  } catch { /* 조회 실패 시 빈 문자열 */ }
  return '';
}

// ── Resend HTTP API로 이메일 발송 ─────────────────────────────────
async function sendEmail(to: string, subject: string, html: string, owner: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY 환경변수가 없습니다.');

  // Gmail이 여러 Owner의 메일을 하나의 대화(thread)로 묶지 않도록
  // Owner별 고유 Message-ID를 설정
  const uniqueId = `fima-${owner.toLowerCase()}-${Date.now()}@lim.kr`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify({
      from   : 'Finance Manager <company@lim.kr>',
      to     : [to],
      subject: subject,
      html   : html,
      headers: {
        'Message-ID'     : `<${uniqueId}>`,
        'X-Entity-Ref-ID': uniqueId,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend 오류 ${res.status}: ${err}`);
  }
  return true;
}

// ── Master 시트에서 AccountOwner 목록 조회 ───────────────────────
async function getAccountOwners(sheetId: string): Promise<string[]> {
  try {
    const rows = await getSheetValues(sheetId, MASTER_SHEET_NAME);
    if (!rows || rows.length < 2) return [];
    const headers = rows[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const aoIdx   = headers.indexOf('account owner');
    if (aoIdx < 0) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    rows.slice(1).forEach((row: any[]) => {
      const v = String(row[aoIdx] ?? '').trim();
      if (v && !seen.has(v)) { seen.add(v); result.push(v); }
    });
    return result;
  } catch { return []; }
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

      // 1. 스프레드시트의 AccountOwner 목록 조회
      const accountOwners = await getAccountOwners(cfg.sheetId);
      const targets = accountOwners.length > 0 ? accountOwners : [owner];

      // 2. AccountOwner별 포트폴리오 분석 데이터 수집
      const sections: { accountOwner: string; data: any }[] = [];
      for (const accountOwner of targets) {
        const pfRes = await fetch(`${baseUrl}/api/portfolio-analysis`, {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ owner, accountOwner }),
        });
        const pfData = await pfRes.json();
        if (pfData.success) {
          sections.push({ accountOwner, data: pfData });
        }
      }

      if (sections.length === 0) {
        results.push({ owner, status: 'fail', email, error: '포트폴리오 조회 실패' });
        continue;
      }

      // 3. AccountOwner별 섹션을 통합한 이메일 생성 및 발송
      const subject = `[${owner}] ${dateStr} 포트폴리오`;
      const html    = buildEmailHtml(owner, sections, dateStr);
      await sendEmail(email, subject, html, owner);

      results.push({ owner, status: 'sent', email });
    } catch (e: any) {
      results.push({ owner, status: 'error', email, error: e.message });
    }
  }

  const sent   = results.filter(r => r.status === 'sent').length;
  const failed = results.filter(r => r.status === 'error' || r.status === 'fail').length;

  return NextResponse.json({ success: true, sent, failed, results });
}
