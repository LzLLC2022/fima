/**
 * ============================================================
 * FiMa-Inv — 환경 설정 파일
 * ============================================================
 *
 * 새 Google Spreadsheet로 교체할 때 수정할 파일:
 *   1. 이 파일 (시트명, 컬럼 순서)
 *   2. Vercel 환경변수 (GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY)
 *      → Vercel 대시보드: 프로젝트 → Settings → Environment Variables
 *
 * ============================================================
 */

// ── 시트 이름 ────────────────────────────────────────────────
// Google Spreadsheet 내 시트탭 이름과 정확히 일치해야 합니다.

export const LEDGER_SHEET_NAME = 'Ledger';   // 거래 원장 시트
export const MASTER_SHEET_NAME = 'Master';   // 지역-통화 매핑 시트

// ── Ledger 시트 — 헤더(1행) 컬럼명 ──────────────────────────
// 앱은 헤더명으로 컬럼 위치를 자동 탐지합니다.
// 컬럼 순서는 변경 가능하지만, 헤더명은 아래와 정확히 일치해야 합니다.
// (대소문자 구분, 공백 포함)
//
//  컬럼명              설명
//  ─────────────────────────────────────────────────────────────
//  Date               거래일 (YYYY-MM-DD 또는 Google Sheets 날짜 형식)
//  Account Owner      계좌 소유자 이름 (다중 사용자 구분용)
//  Account            계좌명 (예: 일반, IRP, ISA)
//  Region             지역 코드 — Master 시트의 Region과 동일해야 함
//  Asset Type         자산유형: Stock / ETF / Fund / Cash
//  Ticker             종목코드 (한국: 6자리 숫자, 해외: 영문 티커)
//  Name               종목명
//  Trade              거래유형 (아래 Trade 유형 참조)
//  Price              거래가격 (해당 지역 통화 기준)
//  Currency           환율 (KRW 기준, KRW 지역은 1 입력)
//  Quantity           수량
//  Dividend           배당금 (현지 통화)
//  Tax                세금
//  Charge             수수료/거래비용
//  Purchase           매입원가 (Sell 거래 시 기재, 현지 통화)
//  Purchase Currency  매입시 환율 (Sell 거래 시)
//  Comment            메모

// ── Trade 유형 ───────────────────────────────────────────────
//  Buy              매수
//  Sell             매도
//  Deposit          현금 입금
//  Withdraw         현금 출금
//  Dividend         현금 배당
//  Dividend-Stock   주식 배당 (재투자)
//  Split            액면분할 (수량 증가)
//  Merge            액면병합 (수량 감소)
//  Reverse-Split    역분할

// ── Master 시트 — 지역-통화 매핑 ────────────────────────────
// 헤더: Region | Currency
// 예시:
//   USA    | USD
//   KOREA  | KRW
//   JAPAN  | JPY
//   EUROPE | EUR
//   HK     | HKD
