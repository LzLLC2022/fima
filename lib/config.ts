/**
 * ============================================================
 * FiMa-Inv — 환경 설정 파일
 * ============================================================
 *
 * 새 사용자(Account Owner) 추가 방법:
 *   1. 아래 OWNER_CONFIG에 항목 추가
 *   2. Vercel 환경변수에 GOOGLE_SHEET_ID_이름 추가
 *      (PIN은 선택 — 빈 문자열이면 PIN 없음)
 *   3. 해당 Google Spreadsheet를 서비스 계정에 편집자로 공유
 *
 * Vercel 환경변수 (Settings → Environment Variables):
 *   GOOGLE_CLIENT_EMAIL  — 서비스 계정 이메일 (모든 사용자 공유)
 *   GOOGLE_PRIVATE_KEY   — 서비스 계정 키 (모든 사용자 공유)
 *   GOOGLE_SHEET_ID_LZ   — Lz의 스프레드시트 ID
 *   PIN_LZ               — Lz의 PIN (선택)
 *   GOOGLE_SHEET_ID_SPOUSE — Spouse의 스프레드시트 ID
 *   PIN_SPOUSE           — Spouse의 PIN (선택)
 *   ...
 * ============================================================
 */

// ── 시트 이름 ─────────────────────────────────────────────
export const LEDGER_SHEET_NAME = 'Ledger';
export const MASTER_SHEET_NAME = 'Master';

// ── Owner별 설정 ──────────────────────────────────────────
export interface OwnerConfig {
  sheetId: string;  // 해당 Owner의 Google Spreadsheet ID
  pin: string;      // PIN (빈 문자열이면 PIN 없이 접근 가능)
}

export const OWNER_CONFIG: Record<string, OwnerConfig> = {
  'Lz': {
    sheetId: process.env.GOOGLE_SHEET_ID_LZ ?? process.env.GOOGLE_SHEET_ID ?? '',
    pin:     process.env.PIN_LZ ?? '',
  },
  // ── 새 사용자 추가 예시 ──────────────────────────────────
  // 'Spouse': {
  //   sheetId: process.env.GOOGLE_SHEET_ID_SPOUSE ?? '',
  //   pin:     process.env.PIN_SPOUSE ?? '1234',
  // },
  // 'Child': {
  //   sheetId: process.env.GOOGLE_SHEET_ID_CHILD ?? '',
  //   pin:     '',   // PIN 없음
  // },
};

// ── Owner sheetId 조회 헬퍼 ──────────────────────────────
export function getOwnerSheetId(owner: string): string {
  const cfg = OWNER_CONFIG[String(owner || '').trim()];
  if (!cfg?.sheetId) throw new Error(`등록되지 않은 사용자입니다: ${owner}`);
  return cfg.sheetId;
}

// ── Ledger 시트 컬럼 설명 ────────────────────────────────
// 앱은 헤더명으로 자동 탐지 (순서 변경 가능, 헤더명 일치 필수)
//
//  Date               거래일 (YYYY-MM-DD)
//  Account Owner      계좌 소유자
//  Account            계좌명 (예: 일반, IRP)
//  Region             지역 — Master 시트와 일치
//  Asset Type         Stock / ETF / Fund / Cash
//  Ticker             종목코드
//  Name               종목명
//  Trade              Buy / Sell / Deposit / Withdraw / Dividend / ...
//  Price              거래가격 (현지 통화)
//  Currency           환율 (KRW 기준, KRW 지역은 1)
//  Quantity           수량
//  Dividend           배당금
//  Tax                세금
//  Charge             수수료
//  Purchase           매입원가 (Sell 시)
//  Purchase Currency  매입 환율 (Sell 시)
//  Comment            메모
