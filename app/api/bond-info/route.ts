import { NextRequest, NextResponse } from 'next/server';
import { BOND_META, getStockPrice } from '@/lib/stock';

/** ISIN 접두사 → 채권분류 */
function bondClassFromISIN(isin: string): string {
  const prefix = isin.toUpperCase().slice(2, 6);
  if (prefix.startsWith('10')) return '국채';
  if (prefix.startsWith('20')) return '국민주택채권';
  if (prefix.startsWith('30')) return '지방채';
  if (prefix.startsWith('40')) return '특수채';
  if (prefix.startsWith('50')) return '금융채';
  if (prefix.startsWith('60')) return '회사채';
  return '기타채권';
}

/**
 * 차기이자지급일: 만기일에서 6개월씩 역산하여 오늘 이후 가장 이른 쿠폰 날짜
 * (lib/stock.ts의 calcBondPrice와 동일한 쿠폰일 로직)
 */
function getNextCouponDate(maturityStr: string): string {
  const maturity = new Date(maturityStr + 'T00:00:00Z');
  const now = Date.now();

  const d = new Date(maturity);
  let nextDate = new Date(maturity);

  // 만기일에서 6개월씩 역산하여 오늘 이전이 되는 직전 날짜를 찾음
  while (d.getTime() > now) {
    nextDate = new Date(d);
    d.setUTCMonth(d.getUTCMonth() - 6);
  }
  // nextDate = 오늘 이후 최초 쿠폰일

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${nextDate.getUTCFullYear()}-${pad(nextDate.getUTCMonth() + 1)}-${pad(nextDate.getUTCDate())}`;
}

/** 직전 쿠폰일: 만기일에서 6개월씩 역산하여 오늘 이전 가장 최근 날짜 */
function getLastCouponDate(maturityStr: string): Date {
  const maturity = new Date(maturityStr + 'T00:00:00Z');
  const now = Date.now();

  const d = new Date(maturity);
  while (d.getTime() > now) {
    d.setUTCMonth(d.getUTCMonth() - 6);
  }
  return new Date(d);
}

/**
 * 채권 가격 계산 (반기 이표, 연속복리 할인)
 * lib/stock.ts의 calcBondPrice와 동일 로직 (import 불가 — 내부 함수이므로 복제)
 */
function calcBondPrice(
  couponRate: number,
  maturityDate: Date,
  faceValue: number,
  annualYield: number,
): number {
  const now = Date.now();
  const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
  const semiCoupon = faceValue * couponRate / 2;

  const couponDates: number[] = [];
  const d = new Date(maturityDate);
  while (d.getTime() > now) {
    couponDates.unshift(d.getTime());
    d.setUTCMonth(d.getUTCMonth() - 6);
  }
  if (couponDates.length === 0) return faceValue;

  let price = 0;
  for (let i = 0; i < couponDates.length; i++) {
    const t = (couponDates[i] - now) / MS_PER_YEAR;
    const cf = (i === couponDates.length - 1)
      ? semiCoupon + faceValue
      : semiCoupon;
    price += cf / Math.pow(1 + annualYield, t);
  }
  return Math.round(price * 100) / 100;
}

/** YTM 역산 (바이너리 서치, 100회 반복) */
function calcYTM(
  price: number,
  couponRate: number,
  maturityDate: Date,
  faceValue: number,
): number {
  let lo = 0.0001, hi = 0.5;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const p = calcBondPrice(couponRate, maturityDate, faceValue, mid);
    if (p > price) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── 메인 라우트 ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { ticker } = await req.json().catch(() => ({}));
    const isin = String(ticker || '').trim().toUpperCase();

    if (!/^KR[A-Z0-9]{10}$/i.test(isin)) {
      return NextResponse.json({ error: '한국 채권 ISIN 형식이 아닙니다' }, { status: 400 });
    }

    const meta = BOND_META[isin];

    // BOND_META에 없는 ISIN → 분류 정보만 반환
    if (!meta) {
      return NextResponse.json({
        isin,
        name: isin,
        bondClass: bondClassFromISIN(isin),
        interestType: '',
        couponRate: '',
        maturityDate: '',
        nextCouponDate: '',
        price: '',
        ytm: '',
        depositEquivRate: '',
        accruedInterest: '',
        _note: 'BOND_META에 등록되지 않은 채권입니다. lib/stock.ts의 BOND_META에 추가해주세요.',
      });
    }

    const { coupon, maturity, face = 10000 } = meta;
    const maturityDate = new Date(maturity + 'T00:00:00Z');

    // 현재가 조회 (KRX OpenAPI 또는 수익률 커브 계산가)
    const price = await getStockPrice(isin).catch(() => 0);

    // 차기이자지급일
    const nextCpn = getNextCouponDate(maturity);

    // 직전 쿠폰일 → 경과이자 계산
    const lastCpnDate = getLastCouponDate(maturity);
    const daysSinceCoupon = Math.floor(
      (Date.now() - lastCpnDate.getTime()) / (24 * 3600 * 1000),
    );
    const accruedInterest = Math.round(face * coupon * daysSinceCoupon / 365 * 100) / 100;

    // YTM 역산 (가격이 있을 때만)
    let ytm = 0;
    if (price > 0) {
      ytm = calcYTM(price, coupon, maturityDate, face);
    }

    // 예금환산이율(세후) ≈ YTM × (1 − 세금율 15.4%)
    const depositEquivRate = ytm > 0 ? ytm * (1 - 0.154) : 0;

    return NextResponse.json({
      isin,
      name: isin,
      couponRate:       String(Math.round(coupon * 10000) / 100),          // % (예: 1.5)
      maturityDate:     maturity,                                           // YYYY-MM-DD
      bondClass:        bondClassFromISIN(isin),
      interestType:     '이표채',
      nextCouponDate:   nextCpn,                                            // YYYY-MM-DD
      price:            price > 0 ? String(Math.round(price * 100) / 100) : '',
      ytm:              ytm > 0   ? String(Math.round(ytm * 10000) / 100)  : '', // % (예: 2.87)
      depositEquivRate: depositEquivRate > 0
                          ? String(Math.round(depositEquivRate * 10000) / 100)
                          : '',
      accruedInterest:  String(accruedInterest),
    });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
