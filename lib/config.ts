/**
 * ============================================================
 * FiMa-Inv — 환경 설정 파일
 * ============================================================
 *
 * 새 사용자(Account Owner) 추가 방법:
 *   1. 아래 OWNER_CONFIG에 항목 추가
 *   2. Vercel 환경변수에 GOOGLE_SHEET_ID_이름 추가
 *   3. 해당 Google Spreadsheet를 서비스 계정에 편집자로 공유
 *   4. 해당 스프레드시트의 Master 시트에 "Pin" 컬럼 추가 후 PIN 값 입력
 *      (Pin 컬럼이 없거나 비어있으면 PIN 없이 접근 가능)
 *
 * Vercel 환경변수 (Settings → Environment Variables):
 *   GOOGLE_CLIENT_EMAIL    — 서비스 계정 이메일 (모든 사용자 공유)
 *   GOOGLE_PRIVATE_KEY     — 서비스 계정 키 (모든 사용자 공유)
 *   GOOGLE_SHEET_ID_LZ     — Lz의 스프레드시트 ID
 *   GOOGLE_SHEET_ID_FOREST — Forest의 스프레드시트 ID
 *   GOOGLE_SHEET_ID_JENNY  — Jenny의 스프레드시트 ID
 *   GOOGLE_SHEET_ID_JACK   — Jack의 스프레드시트 ID
 *   GOOGLE_SHEET_ID_ERIC   — Eric의 스프레드시트 ID
 *   ...
 *   ※ PIN_xxx 환경변수는 더 이상 사용하지 않습니다.
 *     PIN은 각 스프레드시트 Master 시트의 "Pin" 컬럼에서 관리합니다.
 * ============================================================
 */

// ── 시트 이름 ─────────────────────────────────────────────
export const LEDGER_SHEET_NAME = 'Ledger';
export const MASTER_SHEET_NAME = 'Master';

// ── Owner별 설정 ──────────────────────────────────────────
export interface OwnerConfig {
  sheetId: string;  // 해당 Owner의 Google Spreadsheet ID
}

export const OWNER_CONFIG: Record<string, OwnerConfig> = {
  'Sample': {
    sheetId: process.env.GOOGLE_SHEET_ID ?? '',  // 샘플/게스트용 — GOOGLE_SHEET_ID 환경변수
  },
  'Lz': {
    sheetId: process.env.GOOGLE_SHEET_ID_LZ ?? '',
  },
  'Forest': {
    sheetId: process.env.GOOGLE_SHEET_ID_FOREST ?? '',
  },
  'Jenny': {
    sheetId: process.env.GOOGLE_SHEET_ID_JENNY ?? '',
  },
  'Jack': {
    sheetId: process.env.GOOGLE_SHEET_ID_JACK ?? '',
  },
  'Eric': {
    sheetId: process.env.GOOGLE_SHEET_ID_ERIC ?? '',
  },
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
//
// ── Master 시트 컬럼 설명 ────────────────────────────────
//  Account Owner      계좌 소유자
//  Account            계좌명
//  Region             지역
//  Currency           통화
//  Asset Type         자산 유형
//  Trade              거래 유형
//  Pin                로그인 PIN (4자리 이상, 앱에서 변경 가능)
