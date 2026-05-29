# CodeGuide - fima (FiMa-Inv 투자 관리)

> 2026-05-26 변경: bookkeeping 백엔드가 [bookkeeping 저장소](https://github.com/LzLLC2022/bookkeeping)로 분리되었습니다.
> fima의 `app/api/bookkeeping/route.ts`와 `lib/bookkeeping.ts`는 더 이상 운영에 쓰이지 않으며, 안정화 후 삭제 예정입니다. 본 가이드의 bookkeeping 관련 섹션은 참고용으로 남겨두지만 신규 작업은 모두 bookkeeping 저장소에서 진행합니다.

> 초급 개발자(담당자) 기준 코드 리딩 & 수정 가이드.
> 모든 코드 참조는 `파일명:라인` 형태로 표기합니다.
> README([README.md:1-528](README.md#L1-L528))도 함께 참고하세요. 본 가이드는 코드 라인 단위 안내에 집중합니다.

---

## 1. 프로젝트 개요

**FiMa-Inv (`fima.lim.kr`)** — 개인 투자 포트폴리오 관리 웹앱.

- 프론트엔드는 **`public/fima.html`** 단일 페이지(SPA, 약 298KB).
- 백엔드는 **Next.js App Router의 API 라우트 26개** — Google Sheets를 DB처럼 사용.
- 가족/팀 등 **여러 사용자가 각자 Spreadsheet**를 가지고 하나의 앱을 공유 (`OWNER_CONFIG`).
- **이메일 일일 리포트** (GitHub Actions + Resend).
- ~~같은 백엔드가 `book.lim.kr` (bookkeeping 저장소)의 복식장부 API도 제공~~ → **2026-05-26부터 분리됨.** bookkeeping은 자체 저장소의 `/api/bookkeeping`을 사용. fima의 `app/api/bookkeeping` 코드는 deprecated, 안정화 후 삭제 예정.

### 6개 탭 (`public/fima.html`)
| 탭 | 기능 |
|---|---|
| 현황 | 자산별 평가금액·손익·수익률, Region 그룹핑 |
| 거래 조회 | 기간·계좌·티커 필터, 행 클릭 → 상세조회 모달(KRW 환산), 결과 화면에서 거래입력 팝업 호출(저장 후 자동 새로고침), 수정/삭제, CSV |
| 리포트 | YTD/MTD/Daily 손익, 월별 수익률 차트, 배당 |
| 리밸런싱 | 목표 비중 → 매수/매도 수량 자동 |
| 관심종목 | WatchList 시트 기반 실시간 시세 |
| 거래 입력 | Buy/Sell/Deposit/Dividend 등 |

---

## 2. 기술 스택

| 항목 | 버전 / 사용 |
|---|---|
| Next.js | **14.2.3** (App Router) — [package.json:11](package.json#L11) |
| React | **18.x** |
| TypeScript | **5.x**, `strict: true` — [tsconfig.json:6](tsconfig.json#L6) |
| Google Sheets API | `googleapis` v144 — [package.json:14](package.json#L14) |
| 외부 시세 API | Yahoo Finance + Naver 금융 (서버에서 fetch, 키 불필요) |
| 이메일 발송 | Resend API |
| 스케줄링 | GitHub Actions (cron) |
| 상태 관리 | 브라우저 sessionStorage |
| 모듈 alias | `@/*` → 프로젝트 루트 — [tsconfig.json:16](tsconfig.json#L16) |
| 빌드 | `next build` (Vercel 자동) |

---

## 3. 아키텍처 한눈에 보기

```
[브라우저] public/fima.html (SPA)
      │
      │  fetch('/api/...')
      ▼
[Next.js Server (Vercel)] app/api/*/route.ts (26개 라우트)
      │
      ├── lib/config.ts        (OWNER_CONFIG: 이름 → Spreadsheet ID)
      ├── lib/sheets.ts        (Sheets API CRUD 헬퍼)
      ├── lib/stock.ts         (Yahoo / Naver 시세·환율)
      └── lib/bookkeeping.ts   (복식장부 도메인 — deprecated, 분리됨)
      │
      ▼
[Google Sheets] (오너별 개별 스프레드시트)
      ├── Ledger  (거래 원장)
      ├── Master  (계좌·지역·통화·PIN·Email 메타)
      ├── WatchList
      ├── 거래 / 분개 / 계정과목 / 고정자산   ← 복식장부용 (2026-05-26부터 bookkeeping 저장소가 직접 접근)
      └── ...
```

데이터 흐름의 특징:
- **모든 라우트는 stateless** — sessionStorage의 owner명을 매 요청마다 보내고, 서버는 `getOwnerSheetId(owner)`로 Sheet ID를 조회.
- 인증은 PIN 검증만. JWT/세션 쿠키 없음.
- 외부 시세는 Vercel 함수에서 직접 호출 (CORS 우회 + 캐싱 잠재 가능).

배포: Vercel. `main` 브랜치 push → 자동 빌드/배포 → `fima.lim.kr`.

---

## 4. 폴더 구조와 역할

```
fima/
├── app/
│   ├── layout.tsx              ( 9줄) HTML 루트 (한국어 lang)
│   ├── page.tsx                ( 6줄) "/" → "/fima.html" 리다이렉트
│   └── api/                    26개 라우트 (모두 route.ts)
│       ├── auth/route.ts                (76줄) ★ 로그인 (GET owner 목록 / POST PIN 검증)
│       ├── auth/change-email/route.ts   (124줄) 이메일 조회/변경
│       ├── auth/change-pin/route.ts     ( 91줄) PIN 변경
│       ├── auth/change-telegram/route.ts (~190줄) ★ 텔레그램 설정 GET/POST — chat_id/recv/upPct/downPct, 헤더 자동 생성
│       ├── account-owners/route.ts      ( 38줄) Ledger 기반 투자 AccountOwner 목록
│       ├── master/route.ts              ( 49줄) Master 시트 조회 (계좌·지역·통화)
│       ├── owner-sheet/route.ts         ( 16줄) Owner → SheetId 조회 (디버그용)
│       ├── ticker-data/route.ts         ( 33줄) 종목 정보
│       ├── ticker-name/route.ts         ( 12줄) 종목명만 빠르게
│       ├── ledger-tickers/route.ts      ( 59줄) Ledger의 실거래 종목 (필터)
│       ├── query/route.ts               ( 87줄) 거래 조회 (필터 + 정렬)
│       ├── transactions/route.ts        ( 53줄) ★ 거래 입력 (Account Owner 빈값 400 차단)
│       ├── update-transaction/route.ts  ( 51줄) 거래 수정 (Account Owner 빈값 400 차단)
│       ├── delete-transaction/route.ts  ( 19줄) 거래 삭제
│       ├── foreign-buy/route.ts         ( 81줄) 해외 매수 + 환전 자동 (Account Owner 빈값 400 차단)
│       ├── purchase/route.ts            ( 83줄) Sell 시 매입원가 자동 계산
│       ├── portfolio/route.ts           (459줄) ★ 현황 계산 (평가금액·손익·Region 그룹)
│       ├── portfolio-analysis/route.ts  (797줄) ★★ 리포트 계산 (YTD/MTD/Daily, 차트)
│       ├── rebalancing/route.ts         ( 97줄) 리밸런싱 시뮬레이션
│       ├── rebalancing/save/route.ts    (132줄) 목표 비중 저장
│       ├── watchlist/route.ts           ( 79줄) WatchList 조회
│       ├── watchlist/save/route.ts      (120줄) WatchList 수정
│       ├── watchlist/alert/route.ts     ( ~110줄) ★ 관심종목 변동 알림 (텔레그램) — 매시 정각 cron
│       ├── telegram/webhook/route.ts    ( ~75줄) 텔레그램 봇 webhook — /start /myid 시 본인 chat_id 자동 안내
│       ├── stock-info/route.ts          (310줄) ★ 시세/환율/52주/배당 통합
│       ├── bond-info/route.ts           (174줄) 채권 정보 (Naver)
│       ├── cash-debug/route.ts          (102줄) 현금 잔액 디버깅
│       ├── bookkeeping/route.ts         (276줄) ⚠️ deprecated — bookkeeping 저장소로 이전됨 (2026-05-26)
│       └── report/email/route.ts        (819줄) ★★ 일일 이메일 리포트
├── lib/
│   ├── config.ts               ( 92줄) ★ OWNER_CONFIG, 시트명
│   ├── sheets.ts               (302줄) Google Sheets API 래퍼
│   ├── stock.ts                (~1100줄) ★ Yahoo/Naver 시세·환율 (42KB)
│   ├── telegram.ts             (  ~90줄) Telegram Bot API 발송 헬퍼 (Master 시트 Telegram 컬럼에서 chat_id 조회)
│   ├── positions.ts            (  ~80줄) Ledger 누적으로 보유 종목 추출 (alert route 에서 사용)
│   └── bookkeeping.ts          (~1100줄) ⚠️ deprecated — bookkeeping 저장소로 이전됨 (2026-05-26)
├── public/
│   ├── fima.html               (298KB) ★★ 프론트엔드 SPA 단일 파일
│   ├── help.html               ( 32KB)  도움말
│   └── favicon.ico
├── data/
│   └── Eric_FiMa_Ledger.csv    (20KB)  샘플 데이터
├── .github/workflows/
│   └── daily-report.yml        ( 41줄) 매일 08:00 KST 이메일 발송 (화~토)
├── .env.example                ( 20줄) 환경변수 템플릿
├── next.config.mjs             (  5줄) Next 설정 (빈 객체 — 기본값 사용)
├── tsconfig.json               ( 20줄)
└── package.json                ( 23줄)
```

---

## 5. 파일별 상세 가이드

### 5-1. `lib/config.ts` (92줄) — ★ 모든 작업의 출발점

| 위치 | 내용 |
|---|---|
| [lib/config.ts:28-29](lib/config.ts#L28-L29) | `LEDGER_SHEET_NAME`, `MASTER_SHEET_NAME` 상수 |
| [lib/config.ts:32-34](lib/config.ts#L32-L34) | `OwnerConfig` interface — `{ sheetId: string }` |
| [lib/config.ts:36-55](lib/config.ts#L36-L55) | **`OWNER_CONFIG`** — 사용자 → 환경변수 매핑 (Sample/Lz/Forest/Jenny/Jack/Eric) |
| [lib/config.ts:58-62](lib/config.ts#L58-L62) | **`getOwnerSheetId(owner)`** — 등록 안 된 owner면 throw |
| [lib/config.ts:65-93](lib/config.ts#L65-L93) | 주석으로 Ledger / Master 시트 컬럼 문서화 |

> **수정 시 주의:** PIN은 이제 env 아닌 **각 스프레드시트 Master 시트의 `Pin` 컬럼**에서 관리됨 ([config.ts:22-23](lib/config.ts#L22-L23) 주석). README의 일부 옛 설명과 차이 — config.ts가 진실의 원천.

### 5-2. `lib/sheets.ts` (302줄) — Google Sheets API 헬퍼

| 함수 | 라인 | 역할 |
|---|---|---|
| `getSheets()` | [lib/sheets.ts:63-98](lib/sheets.ts#L63-L98) | google.auth.JWT 인증 + sheets v4 클라이언트 반환 (서비스 계정 키 사용) |
| `getSheetValues(spreadsheetId, sheetName)` | [lib/sheets.ts:100-121](lib/sheets.ts#L100-L121) | 시트 전체 셀 값을 `any[][]`로 |
| `appendRow(spreadsheetId, sheetName, values)` | [lib/sheets.ts:122-159](lib/sheets.ts#L122-L159) | 한 행 추가 |
| `updateRow(spreadsheetId, sheetName, sheetRowNumber, values)` | [lib/sheets.ts:160-182](lib/sheets.ts#L160-L182) | 특정 행 덮어쓰기 |
| `batchUpdateCells(...)` | [lib/sheets.ts:183-208](lib/sheets.ts#L183-L208) | 여러 셀 일괄 갱신 |
| `deleteRow(spreadsheetId, sheetName, sheetRowNumber)` | [lib/sheets.ts:209-226](lib/sheets.ts#L209-L226) | 행 삭제 |
| `bulkDeleteRows(...)` | [lib/sheets.ts:227-302](lib/sheets.ts#L227-L302) | 여러 행 한 번에 삭제 |

> **`sheetRowNumber`** 는 1-based + 헤더 포함이라는 점 주의. 데이터 첫 행이 시트 2행에 해당.

### 5-3. `lib/stock.ts` (~1100줄) — 시세·환율

핵심 함수 (모두 async, fetch + HTML 파싱):

| 함수 | 라인 | 역할 |
|---|---|---|
| `isKoreanCode(code)` | [lib/stock.ts:70](lib/stock.ts#L70) | 한국 종목 판정 (6자리 숫자) |
| `BOND_META` 상수 | [lib/stock.ts:103](lib/stock.ts#L103) | 채권 메타 (쿠폰·만기) 하드코딩 |
| `getNaverBondInfo(isin)` | [lib/stock.ts:377](lib/stock.ts#L377) | Naver 금융에서 채권 시세 |
| `getStockInfo(code, item?)` | [lib/stock.ts:538](lib/stock.ts#L538) | 종목 일반 정보 |
| **`get52WeekHighLow(ticker)`** | [lib/stock.ts:563](lib/stock.ts#L563) | 52주 최고/최저 |
| `getAnnualDividendPerShare(ticker)` | [lib/stock.ts:607](lib/stock.ts#L607) | 연배당 |
| `getMostRecentDividend(ticker)` | [lib/stock.ts:663](lib/stock.ts#L663) | 최근 배당 |
| `getMonthlyDivPerShare(ticker)` | [lib/stock.ts:715](lib/stock.ts#L715) | 월별 배당 (YYYY-MM 키) |
| **`getStockPrice(ticker, date?)`** | [lib/stock.ts:796](lib/stock.ts#L796) | **현재가 또는 기준일 종가 (한국→Naver, 그 외→Yahoo)** |
| **`getExchangeRate(currency, date?)`** | [lib/stock.ts:941](lib/stock.ts#L941) | **환율 (KRW 기준)** |

> 외부 의존성이 강한 영역. Yahoo Finance가 API 응답 형식을 바꾸면 파싱 함수도 같이 바꿔야 함. **회귀 테스트가 가장 까다로운 부분.**

### 5-4. `lib/bookkeeping.ts` (~1100줄) — 복식장부 도메인 ⚠️ Deprecated

> **2026-05-26 분리됨.** 이 파일은 bookkeeping 저장소의 [`lib/bookkeeping.ts`](../bookkeeping/lib/bookkeeping.ts)로 이전되었고, fima 측 파일은 더 이상 운영에 쓰이지 않습니다. 안정화 후 삭제 예정.
> 아래 함수 표는 두 저장소가 동일한 시그니처를 공유하므로 참고용으로 보존합니다.

`book.lim.kr` 프론트엔드가 호출했던 백엔드 로직. **bookkeeping 저장소의 `Code.gs`와 1:1 매핑**되는 함수들:

| 함수 | 라인 | 역할 |
|---|---|---|
| `BOOK_SHEETS` 상수 | [lib/bookkeeping.ts:56](lib/bookkeeping.ts#L56) | 시트명: TRANSACTION/ENTRY/ACCOUNT/LEDGER/ASSET |
| `cleanFsName(v)` | [lib/bookkeeping.ts:82](lib/bookkeeping.ts#L82) | "(1)당좌자산" → "당좌자산" |
| `cleanCategory(v)` | [lib/bookkeeping.ts:96](lib/bookkeeping.ts#L96) | 분류(상) → 유동자산/자본/수익 등 정규화 |
| `safeFormatDate(rawVal)` | [lib/bookkeeping.ts:126](lib/bookkeeping.ts#L126) | Invalid Date 방어 |
| **`loginUser(spreadsheetId, owner, pin)`** | [lib/bookkeeping.ts:207](lib/bookkeeping.ts#L207) | 복식장부 별도 로그인 |
| `getAccounts(spreadsheetId)` | [lib/bookkeeping.ts:282](lib/bookkeeping.ts#L282) | 계정과목 목록 |
| `addAccount(spreadsheetId, body)` | [lib/bookkeeping.ts:306](lib/bookkeeping.ts#L306) | |
| **`saveTransaction(...)`** | [lib/bookkeeping.ts:374](lib/bookkeeping.ts#L374) | 거래 + 분개 신규 |
| `getTransaction / getTransactions / updateTransaction / deleteTransaction` | [lib/bookkeeping.ts:417-611](lib/bookkeeping.ts#L417-L611) | 거래 CRUD |
| `getLedgerData(spreadsheetId, p)` | [lib/bookkeeping.ts:612](lib/bookkeeping.ts#L612) | 총계정원장 JSON |
| **`getTrialBalance(spreadsheetId, p)`** | [lib/bookkeeping.ts:677](lib/bookkeeping.ts#L677) | 합계잔액시산표 — 계정과목(상) 기준 집계 |
| **`carryForward(spreadsheetId, p)`** | [lib/bookkeeping.ts:784](lib/bookkeeping.ts#L784) | 전기이월 (AVS 종목별 분리 포함) |
| 고정자산 CRUD | [lib/bookkeeping.ts:985-1100+](lib/bookkeeping.ts#L985) | getAssets/saveAsset/updateAsset/deleteAsset |

> **bookkeeping 저장소의 [`CodeGuide.md`](../bookkeeping/CodeGuide.md)** 가 이 로직의 의미 단위 설명에 더 자세함.

### 5-5. API 라우트별 상세

#### A. 인증 / 메타 (4개)

| 파일 | 라인 | 메서드 | 역할 |
|---|---|---|---|
| `app/api/auth/route.ts` | 76 | GET: owner 목록 / POST: PIN 검증 | 로그인 진입점. PIN은 각 owner의 Master 시트 `Pin` 컬럼에서 조회 ([auth/route.ts:41-58](app/api/auth/route.ts#L41-L58)) |
| `app/api/auth/change-pin/route.ts` | 91 | POST | PIN 변경 (Master 시트 업데이트) |
| `app/api/auth/change-email/route.ts` | 124 | POST | 이메일 변경 |
| `app/api/account-owners/route.ts` | 38 | GET | Ledger의 `Account Owner` 컬럼 unique 값 |
| `app/api/master/route.ts` | 49 | GET | Master 시트 row 전체 |
| `app/api/owner-sheet/route.ts` | 16 | GET | Owner → SheetId (디버그) |

#### B. 종목 / 시세 (4개)

| 파일 | 라인 | 역할 |
|---|---|---|
| `app/api/ticker-data/route.ts` | 33 | 종목 메타 |
| `app/api/ticker-name/route.ts` | 12 | 종목명만 (빠른 lookup) |
| `app/api/ledger-tickers/route.ts` | 59 | Ledger 실거래 종목 (AccountOwner 필터) |
| **`app/api/stock-info/route.ts`** | 310 | 현재가/환율/52주/배당 통합 — lib/stock.ts 함수 묶음 |
| `app/api/bond-info/route.ts` | 174 | 채권 (Naver) |

#### C. 거래 CRUD (5개)

| 파일 | 라인 | 역할 |
|---|---|---|
| `app/api/transactions/route.ts` | 53 | POST: 거래 입력. `f.accountOwner` 공백 → 400 |
| `app/api/update-transaction/route.ts` | 51 | POST: 수정. `f.accountOwner` 공백 → 400 |
| `app/api/delete-transaction/route.ts` | 19 | POST/DELETE: 삭제 |
| **`app/api/foreign-buy/route.ts`** | 81 | 해외 Buy + KRW 환전 자동 (Ledger에 2건 기록). `f.accountOwner` 공백 → 400 |
| `app/api/purchase/route.ts` | 83 | Sell 시 매입원가 자동 계산 (FIFO 추정) |
| `app/api/query/route.ts` | 87 | 거래 조회 (필터 + 정렬) |

#### D. 분석 (3개, 가장 큼)

| 파일 | 라인 | 역할 |
|---|---|---|
| **`app/api/portfolio/route.ts`** | **459** | **현황 — 평가금액·손익·Region 그룹** |
| **`app/api/portfolio-analysis/route.ts`** | **797** | **리포트 — YTD/MTD/Daily 손익, 월별 차트, 종목별 수익률** |
| `app/api/cash-debug/route.ts` | 102 | 현금 잔액 디버그 |

#### E. 리밸런싱 / 관심종목 (4개)

| 파일 | 라인 | 역할 |
|---|---|---|
| `app/api/rebalancing/route.ts` | 97 | 시뮬레이션 |
| `app/api/rebalancing/save/route.ts` | 132 | 목표 비중 저장 |
| `app/api/watchlist/route.ts` | 79 | WatchList 시트 조회 |
| `app/api/watchlist/save/route.ts` | 120 | WatchList 추가/수정/삭제 |

#### F. 외부 시스템용 (2개)

| 파일 | 라인 | 역할 |
|---|---|---|
| `app/api/bookkeeping/route.ts` | 276 | ⚠️ deprecated — bookkeeping 저장소로 이전됨 (2026-05-26). 안정화 후 삭제 예정 |
| **`app/api/report/email/route.ts`** | **819** | **일일 이메일 리포트** — Resend API + Bearer 인증 |

### 5-6. `app/page.tsx` & `app/layout.tsx`

| 파일 | 라인 | 역할 |
|---|---|---|
| `app/layout.tsx` | 9 | 최소 루트 레이아웃 (`lang="ko"`). metadata `title: 'FIMA'` |
| `app/page.tsx` | 6 | "/" 접속 시 `redirect('/fima.html')`. 즉 Next의 React 페이지는 사실상 없음 — **모든 UI는 `public/fima.html` SPA** |

### 5-7. `public/fima.html` (~298KB)

본 가이드의 라인 단위 분석은 생략 (단일 파일이지만 매우 큼). 패턴:
- 순수 HTML + 내장 JS, **빌드 없이 정적 서빙**.
- 모든 데이터 요청은 `fetch('/api/...')`로 백엔드 호출.
- sessionStorage에 `owner`, `pin`, `accountOwner` 등 저장.
- 탭 6개의 컨테이너 + 각 탭별 로직.

> SPA 수정 시 핵심 — **API 호출 경로(`/api/portfolio` 등)와 응답 스키마가 백엔드와 정확히 일치**해야 함. 백엔드를 바꾸면 SPA의 `renderXxx` 함수도 같이 갱신.

---

## 6. 데이터 모델

### 6-1. Ledger 시트 (투자 거래 원장) — [config.ts:67-83](lib/config.ts#L67-L83)
Date / Account Owner / Account / Region / Asset Type / Ticker / Name / Trade / Price / Currency / Quantity / Dividend / Tax / Charge / Purchase / Purchase Currency / Comment

**Trade 값** (README L271-283):
- `Buy` / `Sell` / `Deposit` / `Withdraw` / `Dividend` / `Dividend-Stock` / `Split` / `Merge` / `Reverse-Split`

**Asset Type** (README L287-294):
- `Stock` / `ETF` / `Fund` / `Cash`

### 6-2. Master 시트 (계좌/지역/통화/PIN/Email) — [config.ts:85-93](lib/config.ts#L85-L93)
Account Owner / Account / Region / Currency / Asset Type / Trade / **Pin** / **Email**

> PIN과 Email 모두 Master 시트에서 관리. config.ts에서는 sheetId만 보관.

### 6-3. 복식장부 시트들 (분리됨)
2026-05-26부터 bookkeeping 저장소가 같은 시트를 직접 접근합니다. fima에서는 더 이상 사용 안 함.
스키마 상세는 [bookkeeping 저장소 CodeGuide.md](../bookkeeping/CodeGuide.md)와 [README.md](../bookkeeping/README.md) 참고.

### 6-4. KRW 환산 계산 규칙 — **거래일별 floor 누적**

해외 종목의 KRW 환산은 증권사 명세서 방식과 동일하게 **거래별 소수점 버림 후 정수 누적**합니다. float 누적 후 마지막 round 방식이 아닙니다.

```ts
// portfolio/route.ts:276, portfolio-analysis/route.ts:390
p.buyCostKRW += Math.floor(price * qty * effRate);
p.divKRW     += Math.floor(divAmt * effRate);
runningState.netDepositKRW += Math.floor((price - tax - charge) * effRate);
```

| 값 | 산식 |
|---|---|
| 매입금액 `buyCostKRW` | `Σ floor(price × qty × rate)` (Buy + Dividend-Stock) |
| 누적배당금 `cumDividendKRW` | `Σ floor(dividend × rate)` (현금배당 + 주식배당) |
| 순투자액 `netDepositKRW` | `Σ floor((price − tax − charge) × rate)` — Name이 "투자금" |
| 평가금액 `marketValueKRW` | `floor(현재가 × 보유수량 × 현재환율)` (단일 시점 환산) |
| 손익 `pnlKRW` | `marketValueKRW − buyCostKRW` (정수 차) |

`effRate`는 행의 Currency 컬럼 값 → 비어 있으면 같은 region의 `latestRate` fallback → 그것도 없으면 1.

**현황·리포트 두 탭이 동일한 산식**을 쓰므로 KRW 값이 일치합니다. 새 Trade 타입을 추가하거나 누적 계산을 만질 때 반드시 같은 패턴을 유지하세요.

### 6-5. Account Owner 필수 검증 (2026-05-27)

거래 입력·수정·해외 Buy 세 API 라우트는 모두 `f.accountOwner` 공백을 거부합니다 — 검증 누락 시 시트에 빈 Account Owner 행이 생성되어 조회 필터에서 모든 사용자에게 노출되는 부작용이 있었음.

| 위치 | 처리 |
|---|---|
| 프론트 입력 폼 [public/fima.html:2659-2668](public/fima.html#L2659-L2668) | `handleSubmit`이 `navOwnerSelect.value || currentAccountOwner` 공백이면 `showAlert` 후 return |
| 프론트 수정 모달 [public/fima.html:3793-3795](public/fima.html#L3793-L3795) | 모달 열 때 원본 행의 Account Owner를 `editingAccountOwner` 전역 변수에 보관하고 저장 페이로드에 주입. 사용자 화면 필드는 없음 (Account Owner는 nav 드롭다운에서만 변경) |
| API `transactions` [app/api/transactions/route.ts:10-15](app/api/transactions/route.ts#L10-L15) | `String(f.accountOwner ?? '').trim()`이 빈 문자열이면 `{ success: false, error: 'Account Owner는 필수 항목입니다.' }` 400 |
| API `update-transaction` [app/api/update-transaction/route.ts:14-19](app/api/update-transaction/route.ts#L14-L19) | 동일 |
| API `foreign-buy` [app/api/foreign-buy/route.ts:9-14](app/api/foreign-buy/route.ts#L9-L14) | 동일 (이전엔 `f.accountOwner \|\| own` fallback이 있었으나 제거) |

> 조회(`/api/query`)는 빈 Account Owner를 **구 데이터 호환**으로 통과시킵니다 ([query/route.ts:42-45](app/api/query/route.ts#L42-L45)). 신규 입력만 차단되며, 과거에 입력된 빈 행은 별도 보정 필요.

### 6-6. 거래 수정 모달 — 입력 화면 UX 패리티 (2026-05-27)

수정 모달이 입력 화면과 동일한 3가지 UX를 갖춥니다. 관련 함수·상태:

| 항목 | 위치 |
|---|---|
| 콤마 포맷 (입력 즉시) | `fmtNum(el)` [public/fima.html:2399](public/fima.html#L2399) — 입력 화면과 공유. 모달 열 때 기존 값에도 적용 |
| KRW 환산 뱃지 (Price·Dividend·Tax·Charge 옆) | `updateEditKrwConversion()` [public/fima.html:3626-3667](public/fima.html#L3626-L3667) — `updateKrwConversion()` 미러링 |
| 콤마 포함 숫자 파서 | `parseEditNum(id)` [public/fima.html:3621-3624](public/fima.html#L3621-L3624) |
| 저장 전 확인 미리보기 | `submitEditForm` [public/fima.html:3768](public/fima.html#L3768)이 `previewModal`을 띄우고 `confirmSave` → `confirmEditSave()` [public/fima.html:3843](public/fima.html#L3843)에서 실제 PATCH |
| 분기 상태 | `pendingEditMode` / `pendingEditFields` / `editingAccountOwner` [public/fima.html:1764-1766](public/fima.html#L1764-L1766) |

> 새 필드를 추가할 때는 입력 화면 + 수정 모달 + `HEADER_TO_FIELD` 매핑 [public/fima.html:3585](public/fima.html#L3585) 세 곳을 모두 갱신해야 합니다.

### 6-7. 거래조회 — 거래입력 팝업 & 상세조회 모달 (2026-05-29)

거래조회 결과 화면에서 두 가지 모달을 추가로 호출할 수 있습니다.

**(A) 거래입력 팝업 (조회 결과에서 바로 신규 입력)**

| 항목 | 구현 |
|---|---|
| 트리거 버튼 | 거래조회 조건 영역 우측의 `#qAddTxBtn` — `runQuery()` 성공 시 노출 / `resetQuery()` 시 숨김 |
| 모달 컨테이너 | `#inputPopupModal` (`.input-popup-backdrop` / `.input-popup-box`) — 빈 슬롯 `#inputPopupSlot` 보유 |
| 핵심 트릭 | `openInputPopupFromQuery()`가 **`#tab-input` DOM 자체를 슬롯으로 `appendChild`** — 입력 폼의 모든 핸들러·상태가 그대로 재사용됨. `closeInputPopupFromQuery()`는 원래 부모/형제 위치로 복원 (`_inputOrigParent` / `_inputOrigNext`) |
| 가시성 | `.tab-content { display: none }` 기본값을 덮어쓰는 `.input-popup-slot > #tab-input { display: block !important; }` 규칙 |
| 저장 분기 | `confirmSave()`의 `onSaveSuccess`에서 `inputPopupMode`가 true이면 `closeInputPopupFromQuery() + runQuery()`로 종료하고 `queryAlertBox`에 임시 성공 알림 — 일반 입력 탭과는 `resetFormKeepBasic()` 호출이 갈림 [public/fima.html:2963-2982](public/fima.html#L2963-L2982) |

**(B) 거래 상세조회 모달 (행 클릭)**

| 항목 | 구현 |
|---|---|
| 트리거 | `renderTable()`의 각 `<tr>`에 `class="query-row-clickable"` + `onclick="openDetailModal(rowIdx)"`. 수정/삭제 버튼은 `event.stopPropagation()`으로 분리 |
| 데이터 소스 | `lastQueryResult.sorted` — `renderTable()`에서 정렬된 `[{row, sheetRow}]` 배열을 저장해 두고 `rowIdx`로 접근 |
| 렌더링 | `openDetailModal()` [public/fima.html:3458+](public/fima.html#L3458) — 헤더 기반 동적 렌더링으로 시트의 모든 컬럼을 5개 섹션(기본/종목/금액/매입/메모/기타)으로 그룹핑 |
| KRW 환산 | `Region`이 KRW가 아니면 Price · 합계(Price×Qty) · Dividend · Tax · Charge에 현지통화 + `≈ X KRW` 보조 라인을 같이 표시 (`amtCell()` 헬퍼) |
| 수정 연계 | `_detailCurrentSheetRow` / `_detailCurrentRowIdx`를 저장해 두고 푸터 ✏️ 수정 버튼 → `openEditFromDetail()`이 상세를 닫고 기존 `openEditModal(sheetRow, rowIdx)` 호출 |

> 표에 잘려 보이는 컬럼이나 외화 거래의 KRW 환산을 한 번에 확인하기 위한 화면. 표 자체에 열을 추가하지 않고 모달로 상세를 분리한 게 핵심.

### 6-8. 보유/관심종목 변동 알림 (텔레그램, 2026-05-29)

매시간 GitHub Actions cron이 `/api/watchlist/alert`를 호출해, 각 Owner의 **보유종목(Ledger 누적)** 과 **관심종목(Favorate)** 중 사용자별 임계값을 넘은 종목을 텔레그램으로 발송합니다. 사용자 설정 UI는 앱의 **⚙️ 정보 변경** 모달에 통합되어 있습니다.

#### 데이터 흐름

```
사용자 입력 (UI 모달)
   └─ submitTelegramChange() — public/fima.html
        └─ POST /api/auth/change-telegram   { owner, chatId, recv, upPct, downPct }
              └─ Master 시트 4개 컬럼 update (헤더 누락 시 자동 생성)
                   Telegram / TelegramRecv / TelegramUpPct / TelegramDownPct

cron 매시 정각
   └─ POST /api/watchlist/alert
        └─ getOwnerTelegramSettings(sheetId)  → { chatId, recv, upPct, downPct }
        ├─ getOwnedPositions(sheetId)         → Ledger 누적 보유 ticker
        ├─ Favorate 시트                       → 관심 ticker (보유 중복은 제외)
        ├─ 각 ticker 별 getStockInfo()          (병렬)
        └─ pct >= upPct/100 || pct <= -downPct/100 인 종목만 추출
              ├─ [보유종목 변동 알림 …] 섹션 빌드
              └─ [관심종목 변동 알림 …] 섹션 빌드
                 → sendTelegram(chatId, html, {parseMode:'HTML'})
```

#### 주요 구성

| 항목 | 위치 / 구현 |
|---|---|
| 알림 API | [app/api/watchlist/alert/route.ts](app/api/watchlist/alert/route.ts) — `OWNER_CONFIG` 순회. 보유종목(`getOwnedPositions`) + 관심종목(`Favorate` 시트) 두 그룹 처리. 같은 ticker 가 두 그룹에 있으면 **보유종목 섹션에만 표시**(중복 제거). `body.threshold` override 시 모든 Owner 동일 임계값, 없으면 시트값. `Sample` 제외. |
| 보유 종목 추출 | [lib/positions.ts](lib/positions.ts) — `getOwnedPositions(sheetId)` 가 Ledger 시트에서 ticker별 `buyQty + splitAdj - sellQty > 0` 계산. portfolio API 의 누적 로직 ([app/api/portfolio/route.ts](app/api/portfolio/route.ts#L260-L294)) 을 가볍게 재현. Cash 행은 제외. |
| 인증 | `Authorization: Bearer <REPORT_SECRET>` — 이메일 리포트와 동일 토큰 공유 |
| 사용자 설정 API | [app/api/auth/change-telegram/route.ts](app/api/auth/change-telegram/route.ts) — GET(현재값) / POST(저장). `planColumns()` 가 4개 컬럼 인덱스 탐색 후 누락된 헤더는 헤더 행 우측에 차례로 자동 생성. |
| 시트 컬럼 | Master 시트의 `Telegram` (chat_id, 숫자 문자열) / `TelegramRecv` (Y/N) / `TelegramUpPct` (숫자 %) / `TelegramDownPct` (숫자 %). 헤더 매칭은 소문자/언더스코어 무시. |
| 임계값 정책 | 사용자 시트에 값이 있으면 그 값, 없거나 0 이하면 fallback `DEFAULT_THRESHOLD = 0.05` (5%). |
| 발송 헬퍼 | [lib/telegram.ts](lib/telegram.ts) — `getOwnerTelegramSettings(sheetId)` 가 4개 값 일괄 반환. `TelegramRecv` 명시 N/0/false → `chatId: ''` 로 반환되어 자연스럽게 skip. `sendTelegram(chatId, text, {parseMode})` — 토큰/chatId 미설정 시 `skipped: true` fail-soft. |
| Cron | [.github/workflows/watchlist-alert.yml](.github/workflows/watchlist-alert.yml) — `cron: '0 * * * *'` (UTC). `workflow_dispatch` 입력으로 owner/threshold 수동 override 가능. |
| 메시지 포맷 | 보유/관심 그룹을 **각각 독립된 sendTelegram 호출**로 발송 (둘 다 변동이면 메시지 2건). 제목: `[보유종목 변동 알림 (<Owner>) — +X% 이상, -Y% 이하]` / `[관심종목 변동 알림 (...) — ...]`. 종목별 `🔴/🔵 티커 종목명` 헤더 + `<blockquote>` 박스 안에 `<b>±N% ±diff CUR</b>` / `어제 ⇒ 오늘 CUR`. parse_mode `HTML`. 변동률 큰 순 정렬. 변동 없는 그룹은 발송 생략. |
| UI | [public/fima.html](public/fima.html) — 정보 변경 모달 내 `📨 관심종목 알람(텔레그램)` 섹션. 모달 열 때 `GET /api/auth/change-telegram` 으로 현재값 로딩. `submitTelegramChange()` 가 POST. |

**텔레그램 표시 한계 (사용자 안내 시 주의)**:
- 봇 메시지 HTML 화이트리스트: `<b><i><u><s><code><pre><a><tg-spoiler><tg-emoji><blockquote>` 만 허용.
- **임의 색상/배경색/CSS 불가**. 상승/하락 색 분리는 박스로는 불가능하므로 종목 헤더의 🔴/🔵 이모지로 표현.
- `<blockquote>` 박스 색은 사용자 클라이언트의 액센트 컬러(Settings → Appearance → Color) 따라 단일 색.

**중복 정책**: 변동률이 임계값 이상 유지되는 동안 매시간 반복 발송. dedup 상태 없음 — 필요해지면 시트에 `TelegramLastAlertedAt` 컬럼 추가하여 1일 1회 제한 등 정책 변경 가능.

**운영 설정**:
- Vercel 환경변수: `TELEGRAM_BOT_TOKEN` (전 Owner 공유) + `REPORT_SECRET` (이메일 리포트와 동일 값) + (선택) `TELEGRAM_WEBHOOK_SECRET`.
- 사용자별 chat_id / 수신여부 / 임계값은 **앱의 정보 변경 화면**에서 입력 → 자동으로 Master 시트에 저장됨. 사용자가 직접 시트 편집해도 동일하게 동작.
- 토큰 미설정 또는 사용자 chat_id 없는 Owner는 단순 skip — 시스템 자체는 정상 동작.

#### 사용자 chat_id 확인 흐름 (webhook)

| 단계 | 상세 |
|---|---|
| 사용자 진입 | 텔레그램에서 봇 username 검색 → 1:1 대화에서 `/start` 또는 `/myid` 입력 |
| 텔레그램 → fima | `POST /api/telegram/webhook` 호출 ([app/api/telegram/webhook/route.ts](app/api/telegram/webhook/route.ts)) — message.chat.id 추출 |
| fima → 사용자 | `sendMessage` 로 chat_id 를 본인 채팅에 응답 (HTML, `<code>` 박스로 복사 편의) |
| 사용자 입력 | 정보 변경 모달의 `텔레그램 ID` 칸에 붙여넣기 → `텔레그램 설정 저장` |

**setWebhook 등록 (관리자 1회)**:
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://fima.lim.kr/api/telegram/webhook" \
  -d "secret_token=<RANDOM>"
```
`secret_token` 사용 시 Vercel `TELEGRAM_WEBHOOK_SECRET` 환경변수에 동일 값 등록. 미사용 시 webhook URL 공개 노출에 따른 abuse 가능 (sendMessage 호출만 가능하지만 rate limit 없음).

`/start` 외 다른 메시지는 webhook 라우트에서 무시 — 봇은 chat_id 안내 외 다른 기능 없음.

---

## 7. 환경 설정

### 7-1. `.env.local` 기본 변수 ([.env.example](.env.example))

| 변수 | 용도 |
|---|---|
| `GOOGLE_SHEET_ID` | Sample/게스트용 기본 시트 ID |
| `GOOGLE_CLIENT_EMAIL` | 서비스 계정 이메일 |
| `GOOGLE_PRIVATE_KEY` | 서비스 계정 비공개 키 (PEM, `\n` 포함 문자열) |

### 7-2. 추가 변수 (config.ts 사용자별)

| 변수 | 용도 |
|---|---|
| `GOOGLE_SHEET_ID_LZ` | Lz의 스프레드시트 ID |
| `GOOGLE_SHEET_ID_FOREST` | Forest |
| `GOOGLE_SHEET_ID_JENNY` | Jenny |
| `GOOGLE_SHEET_ID_JACK` | Jack |
| `GOOGLE_SHEET_ID_ERIC` | Eric |

### 7-3. 이메일 리포트 변수 (README L399-406)

| 변수 | 용도 |
|---|---|
| `RESEND_API_KEY` | Resend API 키 |
| `REPORT_SECRET` | Bearer 토큰 (GitHub Actions와 동일 값) |
| `REPORT_BASE_URL` | `https://fima.lim.kr` (내부 API 호출용) |

### 7-4. `.env.local` vs `.env.production.local`
- **로컬 개발:** `.env.local` 사용 (.gitignore되어 있음).
- **production 시뮬레이션:** `.env.production.local` — 로컬에서 `next build && next start` 할 때 적용.
- **운영:** Vercel 환경변수 (위 셋과 무관).

> **보안:** `.env.local`의 실제 값(특히 `GOOGLE_PRIVATE_KEY`, `REPORT_SECRET`)은 절대 커밋하지 말 것. 저장소에 추가하려면 마스킹 또는 .env.example만.

---

## 8. 실행 및 배포

### 로컬 개발 (README L260-263)
```bash
npm install
npm run dev
# → http://localhost:3000
# "/" → "/fima.html" 리다이렉트
```

### 빌드
```bash
npm run build   # 정적 분석 + Next 빌드
npm run start   # 빌드 결과 서빙 (포트 3000)
```

### 배포
- **Vercel**: `main` 브랜치 push → 자동 빌드/배포 → `fima.lim.kr`.
- **우분투 개발서버**: `fima-dev.lim.kr` (PM2 port 3000, [ubuntu_server_manual.md](../ubuntu_server_manual.md) 참고).

### GitHub Actions (일일 리포트)
- `.github/workflows/daily-report.yml` — cron `0 23 * * 1-5` (KST 08:00 화~토)
- Repository Secrets: `REPORT_SECRET`만 등록 ([README L412-423](README.md#L412-L423))

---

## 9. 자주 하는 작업 가이드

### A. 새 Account Owner 추가
README L33-99에 자세히 있음. 요약:
1. [lib/config.ts:36-55](lib/config.ts#L36-L55) `OWNER_CONFIG`에 항목 추가.
2. Vercel에 `GOOGLE_SHEET_ID_<NAME>` 환경변수 추가.
3. 해당 Spreadsheet를 서비스 계정에 편집자로 공유.
4. Master 시트에 Pin 컬럼 채움 (선택).
5. Vercel 재배포.

### B. 새 API 라우트 추가
1. `app/api/새이름/route.ts` 파일 생성.
2. `export async function GET(req)` 또는 `POST(req)` 정의.
3. `getOwnerSheetId(owner)` ([lib/config.ts:58](lib/config.ts#L58))로 sheetId 획득.
4. `lib/sheets.ts` 헬퍼로 Sheets 작업.
5. 프론트(`public/fima.html`)에 `fetch('/api/새이름?...')` 추가.

### C. 새 Trade 타입 추가 (예: `Bond-Buy`)
1. README L272 표에 문서화.
2. `app/api/transactions/route.ts`의 입력 검증에 추가.
3. **`portfolio/route.ts`** (현황 계산)에 새 분기 추가 — Trade별 손익 계산 로직.
4. **`portfolio-analysis/route.ts`** (리포트)에도 동일 분기 추가.
5. `public/fima.html` 거래 입력 폼에 옵션 추가.

> ⚠️ KRW 누적 시 반드시 `Math.floor(price × qty × rate)`로 환산해서 더하기 — [6-4. KRW 환산 계산 규칙](#6-4-krw-환산-계산-규칙--거래일별-floor-누적) 참고. 두 API의 산식이 어긋나면 현황/리포트 탭 값이 불일치합니다.

### D. 새 차트/통계 항목 추가
1. **백엔드:** `portfolio-analysis/route.ts`의 응답 객체에 새 필드.
2. **프론트:** `fima.html`에서 응답 파싱하여 차트 렌더.

### E. 이메일 리포트 디자인 변경
- [app/api/report/email/route.ts](app/api/report/email/route.ts) (819줄)의 HTML 템플릿 문자열 수정.
- Resend는 HTML 이메일을 그대로 보내므로 인라인 스타일 권장 (Gmail 등 호환성).

### F. 시세 로직 변경 (Yahoo 응답 형식 바뀜 등)
1. **[lib/stock.ts](lib/stock.ts)** 의 fetch + 파싱 함수 수정.
2. 영향 받는 API 라우트는 자동으로 새 결과 반환 (lib 함수 호출 그대로).
3. 회귀: 한국/미국 양쪽 종목 1~2개로 수동 테스트.

### G. 복식장부 기능 추가 (분리됨 — 더 이상 fima에서 작업 안 함)
2026-05-26부터 복식장부는 [bookkeeping 저장소](https://github.com/LzLLC2022/bookkeeping)에서 독립 운영됩니다.
- 프론트엔드 + 백엔드 모두 bookkeeping 저장소에서 함께 수정.
- 진입점: `bookkeeping/app/api/bookkeeping/route.ts` + `bookkeeping/lib/bookkeeping.ts`.
- fima의 동일 파일들은 deprecated. 안정화 후 삭제 예정.

---

## 10. 흔한 버그와 해결 패턴

| 증상 | 원인 / 대처 |
|---|---|
| **API 401: 등록되지 않은 사용자** | `OWNER_CONFIG`에 추가 안 됐거나 환경변수 누락. Vercel 재배포 필요 |
| **`GOOGLE_PRIVATE_KEY` 형식 오류** | Vercel에 입력 시 `\n`이 실제 줄바꿈으로 들어가야 함. JSON 키 파일의 `private_key` 값 그대로 복사 ([README L216-219](README.md#L216-L219)) |
| **시트 권한 오류 (403)** | 해당 스프레드시트를 서비스 계정 이메일에 **편집자**로 공유 안 함 |
| **시세/환율이 N/A** | Yahoo/Naver 일시 오류 → 잠시 후 재시도. 또는 [lib/stock.ts](lib/stock.ts)의 파싱 로직이 응답 형식 변경에 못 따라감 |
| **기준일 종가가 현재가로 표시** | 주말/공휴일 → 직전 거래일 자동 사용. 14일 초과 과거는 지원 안 됨 ([README L352-354](README.md#L352-L354)) |
| **이메일이 안 옴** | 1) Master 시트에 Email 컬럼 없음 또는 비어 있음, 2) `RESEND_API_KEY` 미설정, 3) 도메인 인증 미완료, 4) Sample 사용자는 항상 skip ([README L506-512](README.md#L506-L512)) |
| **GitHub Actions cron이 안 돔** | Vercel 환경변수 `REPORT_SECRET`과 GitHub Secret 값 일치 필수. 또한 GitHub은 cron 정시에 정확히 안 돌고 5~15분 지연 가능 |
| **`NEXT_PUBLIC_` 변수가 client에서 안 보임** | Next는 `NEXT_PUBLIC_` 접두사만 client 번들에 포함. 현재 코드는 `NEXT_PUBLIC_` 변수 없음 — 모두 서버 전용 |
| **TypeScript strict 빌드 에러** | `strict: true` ([tsconfig.json:6](tsconfig.json#L6)). `any` 사용 시 `: any` 명시 또는 union/제네릭 정확히. Sheets 응답은 모두 `any[][]`로 받는 패턴이 일반적 |
| **서버/클라이언트 컴포넌트 혼동** | 본 프로젝트는 사실상 server-only (page.tsx는 리다이렉트, 실제 UI는 정적 HTML). React 컴포넌트가 거의 없으므로 보통은 무관 |
| **CORS** | fima API 라우트는 모두 same-origin (fima.html이 같은 도메인에서 호출). cross-origin 허용 필요한 라우트 없음. (구 bookkeeping/route.ts의 CORS 화이트리스트는 분리 이후 무관) |
| **Vercel function timeout** | Vercel Hobby 플랜은 10초, Pro는 60초. `portfolio-analysis`나 `report/email`처럼 외부 fetch 많은 라우트는 timeout 위험 |
| **변경 후 즉시 반영 안 됨** | Vercel은 캐시 사용. 강제 새로고침(Ctrl+F5) 또는 fima.html 끝에 `?v=날짜` 쿼리 붙이는 패턴 권장 |

---

## 11. 부록 — 데이터 흐름 예시 (현황 탭 클릭 → 화면 표시)

```
1. 사용자가 "현황" 탭 클릭
   public/fima.html → renderPortfolio()
2. fetch('/api/portfolio', { method: 'POST', body: { owner, accountOwner } })
3. app/api/portfolio/route.ts POST 핸들러
   ├─ getOwnerSheetId(owner)          ← lib/config.ts
   ├─ getSheetValues(sheetId, 'Ledger') ← lib/sheets.ts
   ├─ getSheetValues(sheetId, 'Master')
   ├─ 거래 누적 → 보유 수량/평단가 계산
   ├─ 각 티커별 getStockPrice() / getExchangeRate() ← lib/stock.ts
   │    (여러 종목 병렬 처리)
   └─ Region별 그룹화 + 합계 → JSON 응답
4. fima.html이 응답 받아 테이블 + 카드 렌더
```

이 흐름을 이해하면 새 기능 추가/디버깅이 훨씬 수월합니다.
