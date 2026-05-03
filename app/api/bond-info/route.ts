import { NextRequest, NextResponse } from 'next/server';

// ── 공통 헤더 ──────────────────────────────────────────────────────────
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ── 필드 우선순위 읽기 ──────────────────────────────────────────────────
function pick(obj: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// ── KOFIA 채권 기본정보 (getBndMstListByISIN) ───────────────────────────
async function fetchKofiamaster(isin: string) {
  const url = `https://www.kofiabond.or.kr/bnd/svc/bndMst/getBndMstListByISIN.do?isin=${isin}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.kofiabond.or.kr' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`KOFIA master HTTP ${res.status}`);
  return await res.json();
}

// ── KOFIA 채권 종가/수익률 (getClosePriceListByISIN) ────────────────────
async function fetchKofiaPrice(isin: string) {
  const url = `https://www.kofiabond.or.kr/bnd/svc/bondprice/getClosePriceListByISIN.do?isin=${isin}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.kofiabond.or.kr' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`KOFIA price HTTP ${res.status}`);
  return await res.json();
}

// ── KRX 장외채권시세 ────────────────────────────────────────────────────
async function fetchKrxPrice(isin: string) {
  const today    = yyyymmdd(new Date());
  const weekAgo  = yyyymmdd(new Date(Date.now() - 14 * 86400 * 1000));
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT09001',
    isuCd: isin,
    strtDd: weekAgo,
    endDd:  today,
  });
  const res = await fetch('https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': UA,
      'Referer': 'https://data.krx.co.kr/',
      'Origin': 'https://data.krx.co.kr',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`KRX price HTTP ${res.status}`);
  return await res.json();
}

// ── KRX 채권 기본정보 (MDCSTAT09003 / 09004) ────────────────────────────
async function fetchKrxMaster(isin: string, bld: string) {
  const body = new URLSearchParams({ bld, isuCd: isin });
  const res = await fetch('https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': UA,
      'Referer': 'https://data.krx.co.kr/',
      'Origin': 'https://data.krx.co.kr',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`KRX master HTTP ${res.status}`);
  return await res.json();
}

// ── 첫 유효 행 추출 ─────────────────────────────────────────────────────
function firstRow(json: any): any {
  if (!json) return null;
  // 다양한 응답 키 형식 대응
  for (const k of ['output', 'OutBlock_1', 'result', 'data', 'list', 'items', 'bonds']) {
    const v = json[k];
    if (Array.isArray(v) && v.length > 0) return v[v.length - 1]; // 가장 최근(마지막) 행
  }
  // 루트가 배열
  if (Array.isArray(json) && json.length > 0) return json[json.length - 1];
  // 루트가 단일 오브젝트
  if (typeof json === 'object' && Object.keys(json).length > 0) return json;
  return null;
}

// ── 메인 라우트 ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { ticker } = await req.json().catch(() => ({}));
    const isin = String(ticker || '').trim().toUpperCase();

    if (!/^KR[A-Z0-9]{10}$/i.test(isin)) {
      return NextResponse.json({ error: '한국 채권 ISIN 형식이 아닙니다' }, { status: 400 });
    }

    // ── 병렬 조회 (실패해도 진행) ────────────────────────────────────────
    const [kofMaster, kofPrice, krxPrice, krxM3, krxM4] = await Promise.allSettled([
      fetchKofiamaster(isin),
      fetchKofiaPrice(isin),
      fetchKrxPrice(isin),
      fetchKrxMaster(isin, 'dbms/MDC/STAT/standard/MDCSTAT09003'),
      fetchKrxMaster(isin, 'dbms/MDC/STAT/standard/MDCSTAT09004'),
    ]);

    const km  = kofMaster.status === 'fulfilled' ? firstRow(kofMaster.value)  : null;
    const kp  = kofPrice.status  === 'fulfilled' ? firstRow(kofPrice.value)   : null;
    const kxp = krxPrice.status  === 'fulfilled' ? firstRow(krxPrice.value)   : null;
    const kx3 = krxM3.status     === 'fulfilled' ? firstRow(krxM3.value)      : null;
    const kx4 = krxM4.status     === 'fulfilled' ? firstRow(krxM4.value)      : null;

    // ── 소스별 원시 데이터 (디버그용) ─────────────────────────────────────
    const _raw: Record<string, any> = {};
    if (km)  _raw.kofia_master = km;
    if (kp)  _raw.kofia_price  = kp;
    if (kxp) _raw.krx_price    = kxp;
    if (kx3) _raw.krx_m3       = kx3;
    if (kx4) _raw.krx_m4       = kx4;

    if (!km && !kp && !kxp && !kx3 && !kx4) {
      return NextResponse.json({
        error: '채권 정보를 가져올 수 없습니다',
        _errors: {
          kofia_master: kofMaster.status === 'rejected' ? kofMaster.reason?.message : null,
          kofia_price:  kofPrice.status  === 'rejected' ? kofPrice.reason?.message  : null,
          krx_price:    krxPrice.status  === 'rejected' ? krxPrice.reason?.message  : null,
        },
      }, { status: 404 });
    }

    // ── 필드 매핑 (우선순위: KOFIA > KRX, 여러 필드명 fallback) ───────────
    const name = pick(km, 'bnmKorNm', 'bondNm', 'BOND_NM', 'ISU_NM')
              || pick(kxp, 'ISU_NM') || pick(kx3, 'ISU_NM') || isin;

    // 표면이율 (%)
    const couponRate = pick(km,  'faceRt', 'couponRt', 'FACE_RT', 'INT_RT', 'CPRT')
                    || pick(kx3, 'INT_RT', 'COUPON_RT', 'FACE_RT')
                    || pick(kx4, 'INT_RT', 'COUPON_RT');

    // 만기일자
    const maturityDate = pick(km,  'expDt', 'mtrtyDt', 'MTRTY_DT', 'EXPR_DT', 'EXP_DT')
                      || pick(kx3, 'EXPR_DT', 'MTRTY_DT')
                      || pick(kx4, 'EXPR_DT', 'MTRTY_DT');

    // 채권분류
    const bondClass = pick(km,  'bndTpNm', 'bondType', 'BND_TP_NM', 'CLSS_NM', 'BOND_CLSS_NM')
                   || pick(kx3, 'CLSS_NM', 'BND_TP_NM', 'BOND_TP_NM')
                   || pick(kx4, 'CLSS_NM', 'BND_TP_NM');

    // 이자유형
    const interestType = pick(km,  'intTpNm', 'intType', 'INT_TP_NM', 'INT_TYPE_NM')
                      || pick(kx3, 'INT_TP_NM', 'INT_TYPE_NM')
                      || pick(kx4, 'INT_TP_NM');

    // 차기이자지급일
    const nextCouponDate = pick(km,  'nxtIntPayDt', 'nxtCpnDt', 'NXT_INT_PAY_DT', 'NXTPAY_DT')
                        || pick(kp,  'nxtIntPayDt', 'NXTPAY_DT')
                        || pick(kxp, 'NXTPAY_DT', 'NXT_INT_DT')
                        || pick(kx3, 'NXTPAY_DT');

    // 현재가
    const price = pick(kp,  'closePrc', 'closePrice', 'CLOSE_PRC', 'BND_PRC')
               || pick(kxp, 'CLOSE_PRC', 'BND_PRC', 'LAST_PRC');

    // YTM (현재 수익률)
    const ytm = pick(kp,  'yldRt', 'yieldRt', 'YLD_RT', 'YTM')
             || pick(kxp, 'YLD_RT', 'YTM_RT');

    // 예금환산이율(세후)
    const depositEquivRate = pick(kp,  'dpstCvrtRt', 'dpsitCvrtRt', 'DPST_CVRT_RT', 'DPSIT_CVRT_RT')
                          || pick(kxp, 'DPSIT_CVRT_RT', 'DPST_CVRT_RT');

    // 경과이자
    const accruedInterest = pick(kp,  'acmlInt', 'accrInt', 'ACML_INT', 'ACCR_INT')
                         || pick(kxp, 'ACML_INT', 'ACCR_INT');

    // 최근 거래일
    const tradeDate = pick(kp,  'trdDt', 'tradeDt', 'TRD_DT', 'TRD_DD')
                   || pick(kxp, 'TRD_DD', 'TRD_DT');

    return NextResponse.json({
      isin,
      name,
      couponRate,
      maturityDate,
      bondClass,
      interestType,
      nextCouponDate,
      price,
      ytm,
      depositEquivRate,
      accruedInterest,
      tradeDate,
      _raw,  // 디버그용 원시 데이터
    });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
