# FiMa-Inv — 개인 투자 관리 웹앱

Google Spreadsheet를 DB로 사용하는 투자 포트폴리오 관리 앱입니다.  
Next.js + Vercel로 배포하며, 주식·ETF·펀드·현금 자산을 실시간으로 추적합니다.

---

## 주요 기능

| 탭 | 기능 |
|---|---|
| **현황** | 자산별 평가금액·손익·수익률, Region 그룹핑(접기/펼치기), 기준일 역사적 종가 조회 |
| **거래 조회** | 기간·계좌·티커 필터링, 행 클릭 시 **상세조회 모달**(전체 필드 + 외화 KRW 환산), 결과 화면에서 **➕ 거래입력 팝업** 호출 후 저장 시 자동 새로고침, 수정(거래 입력과 동일 UX — 콤마 포맷·KRW 환산 뱃지·저장 전 미리보기)/삭제, CSV 내보내기 |
| **리포트** | 포트폴리오 성과 분석 — YTD/MTD/Daily 손익, 월별 수익률 차트, 배당금 현황, 종목별 수익률(현지통화 + KRW 환산, 합계 행 포함) |
| **리밸런싱** | 목표 비중 설정 → 매수/매도 필요 수량 자동 계산, 52주 미니 차트, 종목 추가 시뮬레이션 |
| **관심종목** | WatchList 시트 기반 실시간 시세·등락률·배당률 모니터링 |
| **거래 입력** | Buy / Sell / Deposit / Dividend 등 신규 거래 기록, 해외 Buy 환전 자동 처리, Account Owner 필수 검증 (프론트·API 양쪽) |

### AccountOwner 드롭다운 (로그인 후 우측 상단)

로그인 후 우측 상단의 드롭다운에서 **투자 AccountOwner**를 선택하면 해당 계좌의 데이터만 필터링하여 조회합니다.

| 구분 | 설명 |
|---|---|
| **로그인ID** | Vercel 환경변수를 통해 Google Spreadsheet를 찾는 키. 로그인 후 변경되지 않음. |
| **투자 AccountOwner** | 드롭다운으로 선택. 같은 Spreadsheet 내 Ledger 데이터를 필터링. (예: Forest, TEST) |

드롭다운 변경 시 현황·거래 조회·리포트·리밸런싱 탭의 이전 결과가 자동으로 초기화됩니다.

---

## Account Owner 추가 방법

> 여러 명이 각자의 Google Spreadsheet를 사용할 때 (가족, 부부, 팀 등)

FiMa-Inv는 **하나의 앱에서 여러 사용자**가 각자의 스프레드시트를 독립적으로 사용할 수 있습니다.  
각 사용자는 로그인 시 자신의 데이터만 조회·입력합니다.

### Step 1 — `lib/config.ts` 수정

```typescript
export const OWNER_CONFIG: Record<string, OwnerConfig> = {
  'Lz': {
    sheetId: process.env.GOOGLE_SHEET_ID_LZ ?? '',
  },

  // ▼ 새 사용자 추가 (아래를 복사해서 추가)
  'Spouse': {
    sheetId: process.env.GOOGLE_SHEET_ID_SPOUSE ?? '',
  },
  'Child': {
    sheetId: process.env.GOOGLE_SHEET_ID_CHILD ?? '',
  },
};
```

> ⚠️ 키 이름(`'Spouse'`, `'Child'` 등)이 로그인 화면에 표시되는 이름입니다.
> PIN은 코드/환경변수가 아닌 각 스프레드시트의 **Master 시트 `Pin` 컬럼**에서 관리됩니다.

### Step 2 — Vercel 환경변수 추가

[Vercel 대시보드](https://vercel.com) → 프로젝트 → **Settings → Environment Variables**

새 사용자마다 아래 항목을 추가합니다 (`이름` 부분을 대문자로 통일):

| 변수명 | 값 | 설명 |
|---|---|---|
| `GOOGLE_SHEET_ID_이름` | `1BxiMV...` | 해당 사용자의 스프레드시트 ID |

**예시 (Spouse 추가):**
```
GOOGLE_SHEET_ID_SPOUSE  =  1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
```

**스프레드시트 ID 찾기:**
```
https://docs.google.com/spreadsheets/d/[여기가 ID]/edit
```

### Step 3 — 스프레드시트 공유

새 사용자의 스프레드시트를 기존 서비스 계정에 공유합니다.
(`GOOGLE_CLIENT_EMAIL` 값, 즉 서비스 계정 이메일을 **편집자**로 추가)

> 서비스 계정(`GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`)은 모든 사용자가 공유합니다.
> **새 사용자마다 서비스 계정을 새로 만들 필요 없습니다.**

### Step 4 — PIN 설정 (선택)

해당 사용자의 스프레드시트 **Master 시트**에 `Pin` 컬럼을 추가하고 PIN 값을 입력합니다.

- `Pin` 컬럼이 없거나 비어 있으면: PIN 없이 로그인 가능 (선택만으로 입장)
- `Pin` 컬럼에 값이 있으면: 입력한 PIN과 일치해야 로그인 성공

### Step 5 — 배포

```
GitHub에 push → Vercel 자동 재배포
```

또는 Vercel 대시보드 → **Deployments → 최신 배포 → Redeploy**

---

### 로그인 동작 방식

```
앱 접속
  ↓
로그인 화면 (Account Owner 선택 + PIN 입력)
  ↓
/api/auth 에서 OWNER_CONFIG로 스프레드시트 찾고
            Master 시트의 Pin 컬럼으로 PIN 검증
  ↓
성공 → sessionStorage에 저장 → 해당 사용자 스프레드시트만 접근
  ↓
로그아웃 → sessionStorage 초기화 → 로그인 화면으로
```

### PIN 정책

| 상황 | 동작 |
|---|---|
| Master 시트 `Pin` 컬럼이 없거나 빈 값 | PIN 입력 불필요, 선택만으로 입장 |
| Master 시트 `Pin` 컬럼에 값 있음 | 입력한 PIN과 정확히 일치해야 입장 |
| PIN 틀렸을 때 | 오류 메시지 표시, 재시도 가능 |

> PIN은 스프레드시트 안에서 관리되므로 사용자가 직접 변경할 수 있습니다.
> 보안이 더 필요한 경우 추가 인증 레이어를 구성하세요.

---

## 새 Google Spreadsheet로 교체하는 방법

> 처음 설정하거나 스프레드시트 파일을 새로 만들 때

### 1단계 — 스프레드시트 준비

아래 구조로 시트를 만듭니다.

#### `Ledger` 시트 (거래 원장)

| 헤더명 | 설명 | 예시 |
|---|---|---|
| Date | 거래일 | 2025-01-15 |
| Account Owner | 계좌 소유자 | Lz |
| Account | 계좌명 | 일반 |
| Region | 지역 (Master와 일치) | USA |
| Asset Type | 자산유형 | Stock / ETF / Fund / Cash |
| Ticker | 종목코드 | QYLD |
| Name | 종목명 | Global X NASDAQ 100 |
| Trade | 거래유형 | Buy |
| Price | 거래가격 (현지 통화) | 17.50 |
| Currency | 환율 (KRW 기준) | 1350 |
| Quantity | 수량 | 10 |
| Dividend | 배당금 | 0.18 |
| Tax | 세금 | 0.02 |
| Charge | 수수료 | 0.5 |
| Purchase | 매입원가 (Sell 시) | 15.00 |
| Purchase Currency | 매입시 환율 (Sell 시) | 1320 |
| Comment | 메모 | 자동환전 |

> ⚠️ **1행은 반드시 헤더명** 그대로 입력 (대소문자·공백 포함 정확히 일치)

#### `Master` 시트 (지역-통화 매핑)

| Region | Currency |
|---|---|
| USA | USD |
| KOREA | KRW |
| JAPAN | JPY |
| EUROPE | EUR |
| HK | HKD |

---

### 2단계 — Google Cloud 서비스 계정 설정

#### 서비스 계정 만들기 (처음 한 번만)

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 프로젝트 선택 (또는 새 프로젝트 생성)
3. **API 및 서비스 → 라이브러리** → `Google Sheets API` 검색 → 사용 설정
4. **IAM 및 관리자 → 서비스 계정** → **서비스 계정 만들기**
   - 이름: `fima-sheets` (자유롭게)
   - 역할: 없어도 됨 (스프레드시트 공유로 권한 부여)
5. 생성된 서비스 계정 클릭 → **키 탭 → 키 추가 → JSON** 다운로드
6. 다운로드된 JSON 파일 보관 (환경변수 설정에 사용)

#### 스프레드시트에 서비스 계정 공유

1. Google Spreadsheet 열기
2. 우상단 **공유** 버튼 클릭
3. 서비스 계정 이메일 추가 (`xxx@project.iam.gserviceaccount.com`)
4. 권한: **편집자** 선택 → 완료

---

### 3단계 — Vercel 환경변수 설정

[Vercel 대시보드](https://vercel.com) → 프로젝트 → **Settings → Environment Variables**

#### 공통 (모든 사용자가 공유)

| 변수명 | 값 | 어디서 찾나 |
|---|---|---|
| `GOOGLE_CLIENT_EMAIL` | 서비스 계정 이메일 | JSON 파일의 `client_email` |
| `GOOGLE_PRIVATE_KEY` | 비공개 키 | JSON 파일의 `private_key` |

#### 사용자별 (각 Account Owner마다 추가)

| 변수명 | 예시 값 | 설명 |
|---|---|---|
| `GOOGLE_SHEET_ID_LZ` | `1BxiMV...abc` | Lz의 스프레드시트 ID |
| `GOOGLE_SHEET_ID_SPOUSE` | `1CyiNW...xyz` | Spouse의 스프레드시트 ID |

> 변수명의 `_LZ`, `_SPOUSE` 부분은 `lib/config.ts`의 키 이름과 대응합니다.
> PIN은 환경변수가 아닌 각 스프레드시트의 **Master 시트 `Pin` 컬럼**에서 관리합니다.

**`GOOGLE_PRIVATE_KEY` 입력 방법:**
- JSON 파일의 `"private_key"` 값 전체를 복사하여 붙여넣기
- `-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n` 형태
- Vercel 입력 시 따옴표 없이 값만 입력

환경변수 저장 후 → **Deployments → 최신 배포 우클릭 → Redeploy**

---

### 4단계 — 시트명 변경 시 (선택)

기본 시트명(`Ledger`, `Master`)을 바꾸고 싶다면 `lib/config.ts` 수정:

```typescript
export const LEDGER_SHEET_NAME = 'Ledger';  // ← 변경
export const MASTER_SHEET_NAME = 'Master';  // ← 변경
```

변경 후 GitHub에 push → Vercel 자동 재배포

---

## 처음부터 직접 배포하는 방법

### 사전 준비물
- GitHub 계정
- Vercel 계정 (GitHub 연동)
- Google Cloud 계정

### 배포 절차

```bash
# 1. 저장소 Fork (GitHub에서 Fork 버튼)
# 2. 로컬 클론
git clone https://github.com/YOUR_USERNAME/fima.git
cd fima

# 3. 의존성 설치
npm install

# 4. 환경변수 설정
cp .env.example .env.local
# .env.local 편집 후 실제 값 입력

# 5. 로컬 실행 확인
npm run dev
# → http://localhost:3000/fima.html

# 6. Vercel 배포
# Vercel 대시보드 → Add New Project → GitHub 저장소 선택
# → Environment Variables 입력 → Deploy
```

---

## ⚠️ Git Commit 및 Vercel 배포 지침

현재 프로젝트가 Vercel에 연동되어 자동 배포될 때, **특정 이메일(`company@lim.kr`)로 커밋된 내역**만 Vercel 배포 트리거로 인식되도록 설정되어 있을 수 있습니다.

향후 수정 사항을 푸시할 때 Vercel에서 인지하고 정상적으로 빌드 및 배포를 진행할 수 있도록, 로컬 환경의 Git 계정 이메일을 반드시 해당 주소로 설정한 후 커밋을 진행해야 합니다.

### 설정 방법

현재 저장소 디렉토리에서 아래 명령어를 실행하여 이메일을 강제 설정합니다.
```bash
git config user.email "company@lim.kr"
```

설정이 잘 되었는지 확인하려면 다음 명령어를 실행합니다.
```bash
git config user.email
```
(`company@lim.kr`이 출력되어야 정상입니다.)

---

## 거래 유형(Trade) 설명

| Trade 값 | 설명 | 필수 컬럼 |
|---|---|---|
| `Buy` | 매수 | Price, Quantity |
| `Sell` | 매도 | Price, Quantity, Purchase, Purchase Currency |
| `Deposit` | 현금 입금 | Price (입금액) |
| `Withdraw` | 현금 출금 | Price (출금액) |
| `Dividend` | 현금 배당 | Dividend |
| `Dividend-Stock` | 주식 배당 (재투자) | Dividend, Price, Quantity |
| `Split` | 액면분할 | Quantity (추가된 주식수) |
| `Merge` | 액면병합 | Quantity (감소한 주식수) |
| `Reverse-Split` | 역분할 | Quantity (감소한 주식수) |

---

## Asset Type 설명

| 값 | 분류 | 현황 탭 표시 |
|---|---|---|
| `Stock` | 주식 | Stock(ETF) 섹션 |
| `ETF` | ETF | Stock(ETF) 섹션 |
| `Fund` | 펀드 | Fund 섹션 |
| `Cash` | 현금성 자산 | 현금 섹션 |

---

## KRW 환산 계산 방식

해외 종목(USD 등)의 한화 환산값은 **거래일별로 환산 후 소수점 버림(Math.floor) → 정수 누적** 방식을 사용합니다. 증권사 명세서·시트 수기합산과 동일한 방식입니다.

### 거래 누적 (매입금액·누적배당금)

각 매수/주식배당/현금배당 거래마다:

```
KRW = floor(price × quantity × currency_rate)
```

이 정수값을 누적합니다. 모든 거래의 KRW 합산은 다음과 같이 결정됩니다.

| 항목 | 공식 |
|---|---|
| 매입금액 KRW (`buyCostKRW`) | Σ floor(price × qty × rate) — Buy + Dividend-Stock |
| 누적배당금 KRW (`cumDividendKRW`) | Σ floor(dividend × rate) — 현금배당 + 주식배당 |
| 순투자액 KRW (`netDepositKRW`) | Σ floor((price − tax − charge) × rate) — Name이 "투자금"인 입출금만 |

### 단일 시점 환산 (평가금액·손익)

평가금액·손익은 현재(또는 기준일) 환율로 한 번에 환산:

```
평가금액 KRW = floor(현재가 × 보유수량 × 현재환율)
손익 KRW    = 평가금액 KRW − 매입금액 KRW
투자수익률  = 손익 KRW / 매입금액 KRW × 100
```

### 환율 fallback

거래 행의 `Currency` 컬럼이 비어 있으면 같은 Region의 가장 최근에 본 환율(`latestRate[region]`)로 fallback 합니다. 비어 있는 행이 첫 거래라면 KRW=1 (사실상 환산되지 않음).

### 적용 범위

- 현황 탭(`/api/portfolio`) — 매입금액·평가금액·손익·배당
- 리포트 탭(`/api/portfolio-analysis`) — 보유 종목별 수익률·월별 차트·요약 카드 모두

두 탭은 동일한 산식을 사용하므로 KRW 값이 일치합니다.

---

## 프로젝트 구조

```
fima/
├── app/
│   └── api/
│       ├── auth/               # ★ 로그인 검증 (GET: owner목록, POST: PIN확인)
│       │   └── change-email/   #   이메일 주소 조회·변경
│       ├── account-owners/     # 투자 AccountOwner 목록 조회 (Ledger 기반)
│       ├── portfolio/          # 현황 API (평가금액·손익·Region 그룹 계산)
│       ├── portfolio-analysis/ # 리포트 API (YTD/MTD/Daily·종목별 수익률·누적배당)
│       ├── query/              # 거래 조회 API (AccountOwner 필터 포함)
│       ├── transactions/       # 거래 입력 API (AccountOwner 컬럼 기록)
│       ├── update-transaction/ # 거래 수정 API
│       ├── delete-transaction/ # 거래 삭제 API
│       ├── master/             # Master 시트 조회 (계좌·지역·통화 목록)
│       ├── ticker-data/        # 종목코드 목록 조회
│       ├── ledger-tickers/     # Ledger 실거래 종목 목록 (AccountOwner 필터)
│       ├── rebalancing/        # 리밸런싱 계산 API
│       ├── watchlist/          # 관심종목 조회 API
│       ├── purchase/           # 매입원가 자동 계산 (Sell 시)
│       ├── foreign-buy/        # 해외 Buy + 환전 처리 (AccountOwner 기록)
│       └── report/
│           └── email/          # 포트폴리오 이메일 리포트 발송 API
├── lib/
│   ├── config.ts               # ★★ Owner 설정 (OWNER_CONFIG, 시트명)
│   ├── sheets.ts               # Google Sheets API 연동 (appendRow·updateRow)
│   └── stock.ts                # 주식·환율 실시간/역사적 조회 (Yahoo·Naver)
└── public/
    ├── fima.html               # 프론트엔드 (Single Page App)
    └── help.html               # 도움말 페이지
```

> **새 사용자 추가 시 수정 파일: `lib/config.ts` 하나 + Vercel 환경변수**

---

## 문제 해결

### 로그인이 안 될 때
1. `lib/config.ts`의 `OWNER_CONFIG`에 해당 이름이 있는지 확인 (대소문자 정확히 일치)
2. Vercel 환경변수 `GOOGLE_SHEET_ID_이름`이 설정되어 있는지 확인
3. PIN을 설정했다면 정확한 PIN인지 확인 (빈 문자열이면 PIN 불필요)
4. 코드 수정 후 Vercel 재배포가 완료됐는지 확인

### 데이터가 로드되지 않을 때
1. 해당 스프레드시트에 서비스 계정 이메일(`GOOGLE_CLIENT_EMAIL`)이 **편집자**로 공유되어 있는지 확인
2. Vercel 환경변수 `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`가 설정되어 있는지 확인
3. Vercel → Deployments → 최신 배포 → Functions 탭에서 오류 로그 확인

### 환율/시세가 N/A로 표시될 때
- 야후 파이낸스 API 일시 오류일 수 있음 (잠시 후 재시도)
- 한국 종목은 네이버 금융 API 사용 (6자리 숫자 코드)

### 기준일 종가가 현재가로 표시될 때
- 기준일이 토·일·공휴일이면 직전 거래일 종가로 자동 표시됨
- 14일 이내 범위에서 조회 (그 이전 날짜는 지원 안 됨)

---

## 포트폴리오 리포트 이메일 자동발송 설정

> 매일 아침(화~토 08:00 KST) 각 사용자에게 포트폴리오 현황을 이메일로 자동 발송합니다.  
> GitHub Actions + Resend API 조합으로 구현되어 있습니다.

---

### 이메일 내용 구성

| 섹션 | 내용 |
|---|---|
| 포트폴리오 요약 | 순투자액 · 평가액 · 평가손익 · 수익률 카드 |
| 기간별 손익 | YTD / MTD / Daily 손익 및 수익률 |
| 월별 누적 수익률 비교 | 포트폴리오 vs KOSPI / S&P500 / NASDAQ 라인 차트 |
| 월별 수익금액 | 월간 수익/손실 바 차트 (KRW) |
| 월별 배당금 | 연도별 그룹 바 차트 (KRW) |
| 보유 종목별 수익률 | 티커 · 매입금액 · 평가금액 · 손익 · 투자수익률 · 누적배당금 · YTD · MTD 테이블 (해외주식은 KRW 환산 라인 동시 표시, 맨 아래 합계 행 포함) |

- 제목 형식: `[AccountOwner] YYYY.MM.DD 포트폴리오`  (예: `[Lz] 2026.05.03 포트폴리오`)
- 발신 주소: `company@lim.kr` (Resend 인증 도메인)
- 수신 주소: 각 사용자 Google Sheets **Master 시트**의 `Email` 컬럼에서 조회

---

### Step 1 — Resend 가입 및 도메인 인증

1. [https://resend.com](https://resend.com) 에서 무료 계정 가입
2. **Domains → Add Domain** 에서 발신에 사용할 도메인 등록  
   예) `lim.kr`
3. 안내에 따라 DNS에 **SPF / DKIM 레코드** 추가 후 인증 완료 대기  
   (보통 수 분 ~ 수 시간 소요)
4. **API Keys → Create API Key** 에서 키 발급 후 복사해 둡니다.

> 도메인 인증 없이도 `onboarding@resend.dev` 주소로 발송 테스트는 가능합니다.

---

### Step 2 — Vercel 환경변수 추가

[Vercel 대시보드](https://vercel.com) → `fima` 프로젝트 → **Settings → Environment Variables**

| 변수명 | 값 | 설명 |
|---|---|---|
| `RESEND_API_KEY` | `re_xxxxxxxx...` | Resend 대시보드에서 발급한 API 키 |
| `REPORT_SECRET` | 임의의 비밀 문자열 | 이메일 발송 API 보호용 Bearer 토큰 |
| `REPORT_BASE_URL` | `https://fima.lim.kr` | 내부 API 호출 시 사용할 도메인 (커스텀 도메인) |

> `REPORT_SECRET` 예시: `fima-report-2026abc123` (길고 유추하기 어렵게 설정)  
> `REPORT_BASE_URL` 은 `VERCEL_URL` 대신 커스텀 도메인을 직접 지정해야 합니다.

환경변수 저장 후 → **Deployments → 최신 배포 → Redeploy**

---

### Step 3 — GitHub Actions Secret 등록

이메일 발송 API는 Bearer 토큰으로 보호되므로, GitHub Actions에서 호출할 때 사용할 토큰을 등록합니다.

1. GitHub 저장소 → **Settings → Secrets and variables → Actions**
2. **New repository secret** 클릭
3. 아래 값 입력:

| Name | Secret |
|---|---|
| `REPORT_SECRET` | Step 2에서 설정한 `REPORT_SECRET` 값과 **동일한 값** |

---

### Step 4 — 각 사용자 Master 시트에 Email 컬럼 추가

각 사용자의 Google Spreadsheet **`Master` 시트**에 수신 이메일 주소를 입력합니다.

1. `Master` 시트 헤더 행에 `Email` 컬럼 추가 (위치 자유)
2. 첫 번째 데이터 행에 수신할 이메일 주소 입력

```
| Account Owner | Account | Region | Currency | ... | Email           |
|---------------|---------|--------|----------|-----|-----------------|
| Lz            | 일반    | USA    | USD      | ... | user@gmail.com  |
```

> ⚠️ 헤더명은 반드시 `Email` (대소문자 무관, 공백 없이)  
> `Email` 컬럼이 없거나 비어있으면 해당 사용자는 발송 건너뜀(skip)

**앱 내에서 이메일 주소 변경:**  
로그인 후 우측 상단 🔒 아이콘 → **E-Mail 변경** 탭에서도 설정 가능합니다.

---

### Step 5 — GitHub Actions 스케줄 확인

저장소에 `.github/workflows/daily-report.yml` 이 이미 포함되어 있습니다.

```yaml
on:
  schedule:
    - cron: '0 23 * * 1-5'   # 월~금 23:00 UTC = 화~토 08:00 KST
  workflow_dispatch:          # 수동 실행 가능
```

별도 설정 없이 **main 브랜치에 push 되면 자동으로 스케줄이 활성화**됩니다.

---

### 테스트 방법

**수동 실행 (GitHub Actions UI):**

1. GitHub → **Actions → Portfolio Report Email** 탭
2. 우측 **Run workflow → Run workflow** 클릭
3. 실행 완료 후 이메일 수신 확인

**curl로 단건 테스트:**

```bash
# Lz만 발송
curl -X POST https://fima.lim.kr/api/report/email \
  -H "Authorization: Bearer {REPORT_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"owner":"Lz"}'

# 전체 발송 (Sample 제외)
curl -X POST https://fima.lim.kr/api/report/email \
  -H "Authorization: Bearer {REPORT_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**정상 응답 예시:**

```json
{
  "success": true,
  "sent": 5,
  "failed": 0,
  "results": [
    { "owner": "Lz",     "status": "sent",  "email": "lz@example.com" },
    { "owner": "Forest", "status": "sent",  "email": "forest@example.com" },
    { "owner": "Jenny",  "status": "skip",  "error": "EMail 없음" }
  ]
}
```

---

### 발송 제외 조건

| 상황 | 처리 |
|---|---|
| `Sample` 사용자 | 항상 skip (테스트 계정) |
| Master 시트에 `Email` 컬럼 없음 | skip |
| `Email` 셀이 비어 있음 | skip |
| 포트폴리오 데이터 조회 실패 | fail (오류 기록) |
| Resend API 오류 | error (오류 메시지 기록) |

---

### 관련 파일

| 파일 | 역할 |
|---|---|
| `app/api/report/email/route.ts` | 이메일 발송 API (POST) |
| `app/api/auth/change-email/route.ts` | 이메일 주소 조회/변경 API |
| `.github/workflows/daily-report.yml` | GitHub Actions 스케줄 워크플로우 |

---

## 보유/관심종목 변동 알림 (텔레그램)

> **보유종목**(Ledger 누적)과 **관심종목**(Favorate 시트)의 현재가가 **전일 종가 대비 사용자별 임계값(상승/하락 각각)** 이상 변동되면 1시간마다 텔레그램으로 알림.

### 작동 방식

- GitHub Actions cron (`0 * * * *`)이 매시 정각에 `/api/watchlist/alert` 호출
- 각 Owner의 **Ledger** 누적으로 보유 종목 추출 (`getOwnedPositions()`) + **Favorate** 시트로 관심종목 추출
- 두 그룹에 겹치는 ticker는 **보유종목 섹션에만** 표시 (중복 제거)
- 각 종목별로 `getStockInfo()`로 현재가·전일종가·changepct 조회
- `changepct >= upPct` (상승) 또는 `changepct <= -downPct` (하락) 종목을 모아 **보유 / 관심을 별도의 텔레그램 메시지**로 각각 발송:
  ```
  메시지 1:
  [보유종목 변동 알림 (Owner) — +X% 이상, -Y% 이하]
  ...

  메시지 2:
  [관심종목 변동 알림 (Owner) — +X% 이상, -Y% 이하]
  ...
  ```
- 봇 토큰은 Vercel 환경변수, 사용자별 설정(chat_id / 수신여부 / 상승·하락 임계값)은 **각 Owner의 Master 시트에서 관리** — 앱의 `정보 변경` 화면에서 입력하면 자동으로 시트에 저장됨
- 봇 토큰이 없거나 사용자가 chat_id를 등록하지 않은 Owner는 자동 skip
- **직전 실행과 동일한 변동률인 종목은 제외** — 장 마감 후 가격 변화가 없어 매시간 같은 변동률(예: `+5.12%`)로 반복 알림되는 것을 방지. 직전 실행에서 임계값을 통과한 종목의 변동률을 각 Owner 스프레드시트의 `_AlertState` 탭(`lib/alertState.ts`)에 저장해 두고, 다음 실행에서 비교한다:
  - 직전과 변동률이 **동일하면 제외**, **다르거나** 직전에 알림 대상이 아니었으면 **정상 알림**
  - 임계값 밖으로 빠졌다가 다시 들어온 종목은 직전 상태에 없으므로 다시 알림됨
  - 비교는 표시 정밀도(소수 2자리 %) 기준 정확히 동일할 때만 제외

---

### Step 1 — 텔레그램 봇 생성 (관리자)

> 봇은 모든 Owner가 공유합니다. 한 번만 생성하면 됩니다.

1. 텔레그램 앱에서 `@BotFather` 검색 → **파란 체크마크** 있는 공식 봇 선택
2. 채팅창에서 `/start` → `/newbot` 입력
3. 봇 이름(한글 가능) 입력 → 예: `FiMa 알림`
4. 봇 username(영문, **반드시 `bot`으로 끝남**) 입력 → 예: `your_fima_alert_bot`
5. 발급된 **토큰** 복사 (형태: `7891234567:AAH...46자_랜덤_문자열`)

> ⚠️ 토큰은 봇 제어 권한이므로 절대 외부에 노출 금지.

### Step 2 — Vercel 환경변수 등록 (관리자, 1회)

Vercel → 프로젝트 → Settings → Environment Variables:

| 변수 | 값 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Step 1의 토큰 |
| `REPORT_SECRET` | 이메일 리포트와 동일 (이미 등록되어 있으면 그대로) |
| `TELEGRAM_WEBHOOK_SECRET` | (선택) Step 3에서 `setWebhook` 호출 시 사용한 `secret_token` 과 동일 값. 미설정 시 webhook 인증 검증 스킵 (보안상 권장 X). |

등록 후 다음 main push 시 자동 반영됩니다.

---

### Step 3 — 봇 Webhook 활성화 (관리자, 1회)

> 사용자가 봇에 `/start` 만 입력하면 본인 chat_id를 봇이 자동 응답합니다. 이를 위해 webhook을 한 번 등록.

```bash
# url 은 운영 도메인. secret_token 은 임의 랜덤 문자열 (Vercel TELEGRAM_WEBHOOK_SECRET 에 동일 값 등록 권장)
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://fima.lim.kr/api/telegram/webhook" \
  -d "secret_token=$(openssl rand -hex 16)"
```

응답이 `{"ok":true,"result":true,...}` 면 등록 성공. 등록된 webhook 상태는 `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` 로 확인.

> ⚠️ `secret_token` 사용을 권장합니다. 미사용 시 webhook URL을 아는 사람이 임의로 POST 호출 가능. 사용 시 `TELEGRAM_WEBHOOK_SECRET` 환경변수에 동일 값 등록 필요 (Step 2 표에 추가).

### Step 4 — 각 사용자가 본인 chat_id 확인

> 사용자별로 1회. 봇이 자동으로 알려줍니다.

1. 텔레그램에서 봇(Step 1의 username, 예: `FiMa 알림`) 검색 → 1:1 대화창 열기
2. 하단 **Start** 버튼 클릭 (또는 `/start` 입력)
3. 봇이 자동으로 다음 메시지 응답:
   ```
   ○○○님, 안녕하세요!

   당신의 텔레그램 ID 입니다:
   123456789

   fima 앱에서 ⚙️ 정보 변경 → 📨 관심종목 알람(텔레그램) 의
   텔레그램 ID 칸에 위 숫자를 입력하시면 ...
   ```
4. 숫자를 길게 눌러 복사. ID를 다시 보고 싶으면 `/myid` 입력.

> 💡 **사용자에게 봇 토큰을 절대 공유하지 마세요.** 토큰은 봇 제어 권한 자체이므로, 사용자는 위 흐름으로만 chat_id를 알아낼 수 있어야 합니다.

### Step 5 — fima 앱에서 텔레그램 설정 저장

1. fima.lim.kr 로그인
2. 우측 상단 **⚙️ 정보 변경** 버튼 클릭
3. 모달 하단 **📨 보유/관심종목 알람(텔레그램)** 섹션에서:

   | 항목 | 입력값 |
   |---|---|
   | 텔레그램 ID | Step 4에서 봇이 알려준 chat_id (숫자) |
   | 알림 수신 | 체크 |
   | 상승 % | 알림 받을 상승 임계값 (예: `5`) |
   | 하락 % | 알림 받을 하락 임계값 (예: `5`) |

4. **텔레그램 설정 저장** 버튼 클릭 → 자동으로 Master 시트에 4개 컬럼(`Telegram`, `TelegramRecv`, `TelegramUpPct`, `TelegramDownPct`)이 만들어지거나 갱신됨

> 임계값을 상승/하락 다르게 설정 가능 (예: 상승 `3%` / 하락 `7%`). 알림이 너무 잦으면 임계값을 올리고, 조용히 두고 싶으면 **알림 수신**을 해제하세요.

---

### 메시지 예시

**메시지 1 (보유종목)**
```
[보유종목 변동 알림 (Forest) — +5% 이상, -5% 이하]

🔵 347850 디앤디파마텍
┃ -12.19%  -13,100.00 KRW
┃ 107,500.00 ⇒ 94,400.00 KRW

🔴 PLTR Palantir Technologies Inc.
┃ +8.17%  +10.83 USD
┃ 132.51 ⇒ 143.34 USD
```

**메시지 2 (관심종목)**
```
[관심종목 변동 알림 (Forest) — +5% 이상, -5% 이하]

🔴 TSLA Tesla, Inc.
┃ +8.20%  +18.04 USD
┃ 220.00 ⇒ 238.04 USD
```

- 보유/관심 두 그룹을 **각각 독립된 텔레그램 메시지**로 발송. 변동된 종목이 있는 그룹만 발송 (둘 다면 메시지 2건, 한쪽만이면 1건).
- 박스는 텔레그램 `<blockquote>` 효과 (좌측 세로선 + 우상단 따옴표).
- 박스 색은 **사용자의 텔레그램 클라이언트 액센트 컬러** 따라 단일 색으로 표시됨 (분홍/파랑/녹색 등). Settings → Appearance → Color에서 변경 가능. **봇이 상승/하락별로 박스 색을 다르게 지정하는 것은 텔레그램 API 제약상 불가능.**
- 종목 헤더의 🔴(상승) / 🔵(하락)으로 시각 구분.

> ⚠️ 변동률이 임계값 이상 유지되는 한 **매시간 동일 알림이 반복 발송**됩니다.

---

### 워크플로 / 수동 호출

GitHub Actions cron(`watchlist-alert.yml`)이 매시 정각 자동 실행. 수동 실행은 Actions 탭 → **Watchlist Alert (Telegram)** → Run workflow.

curl로 강제 발송 (테스트용 — 임계값을 일시적으로 낮춰서 강제 발송):

```bash
# 특정 Owner + 임계값 0.01% (사실상 모든 변동 알림)
curl -X POST https://fima.lim.kr/api/watchlist/alert \
  -H "Authorization: Bearer {REPORT_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"owner":"Lz","threshold":0.0001}'

# 전체 Owner — 시트에 저장된 사용자별 임계값 사용
curl -X POST https://fima.lim.kr/api/watchlist/alert \
  -H "Authorization: Bearer {REPORT_SECRET}" \
  -H "Content-Type: application/json" -d '{}'
```

`body.threshold` 가 오면 모든 Owner에 동일 임계값 override. 없으면 각 Owner의 Master 시트에 저장된 `TelegramUpPct` / `TelegramDownPct` 사용.

---

### 관련 파일

| 파일 | 역할 |
|---|---|
| `app/api/watchlist/alert/route.ts` | 알림 API (POST) — 보유/관심 두 그룹, 사용자별 임계값 적용 |
| `app/api/auth/change-telegram/route.ts` | 텔레그램 설정 GET/POST — 헤더 자동 생성 |
| `app/api/telegram/webhook/route.ts` | 봇 `/start` /myid 응답 + PUT 으로 setWebhook 등록 |
| `lib/telegram.ts` | Bot API 발송 + `getOwnerTelegramSettings()` 헬퍼 |
| `lib/positions.ts` | Ledger 누적으로 보유종목 추출 |
| `.github/workflows/watchlist-alert.yml` | 매시간 cron |
| `public/fima.html` (정보 변경 모달) | 텔레그램 설정 UI |

---

## 보유종목 일일 현황 (텔레그램, 화-토 아침 7시)

> 매주 **화-토 07:00 KST**에 보유종목 전체의 평가·손익·누적배당금을 텔레그램으로 발송.

### 작동 방식

- GitHub Actions cron (`0 22 * * 1-5` UTC = **화-토 07:00 KST**)이 `/api/holdings-report` 호출
- 라우트가 각 Owner마다 `/api/portfolio` 를 self-fetch 해 보유종목 정보 조회
- Owner의 Master 시트 `Telegram` 컬럼 chat_id 로 발송 (`TelegramRecv=N` 이면 skip)
- 메시지 본문이 텔레그램 4096자 제한을 넘으면 종목 단위로 자동 분할 (`— 1/2 —`, `— 2/2 —` 푸터)

### 메시지 형식

```
[보유종목 현황 (Forest) — 2026-05-29(금)]
📊 평가 324,361,612 KRW · 손익 +77,472,931 KRW (+31.39%)

┃ 005930 삼성전자
┃ 보유 100.0000주 · 매입단가 70,000.00 KRW · 매입금액 7,000,000 KRW
┃ 손익 +500,000 KRW (+7.14%) · 평가 7,500,000 KRW
┃ 누적배당금 30,000 KRW

┃ TSLA Tesla, Inc.
┃ 보유 6.0000주 · 매입단가 450.79 USD · 매입금액 3,828,694 KRW
┃ 손익 +172,036 KRW (+4.49%) · 평가 4,000,730 KRW
```

- **3-4줄 구성**:
  - 1줄: `TICKER 종목명`
  - 2줄: `보유 X주 · 매입단가 Y CUR · 매입금액 Z KRW`
  - 3줄: `손익 ±A KRW (±B%) · 평가 C KRW` (KRW 기준 통일)
  - 4줄(선택): `누적배당금 D KRW` — 배당이 0인 종목은 줄 생략
- 헤더에 **총 평가 / 총 손익 / 수익률** 요약
- 박스는 텔레그램 `<blockquote>`. 색은 사용자 테마 액센트 컬러.

### 수동 호출 (curl)

```bash
# 전체 Owner
curl -X POST https://fima.lim.kr/api/holdings-report \
  -H "Authorization: Bearer {REPORT_SECRET}" \
  -H "Content-Type: application/json" -d '{}'

# 특정 Owner
curl -X POST https://fima.lim.kr/api/holdings-report \
  -H "Authorization: Bearer {REPORT_SECRET}" \
  -H "Content-Type: application/json" -d '{"owner":"Forest"}'
```

### 관련 파일

| 파일 | 역할 |
|---|---|
| `app/api/holdings-report/route.ts` | 보유종목 현황 발송 API |
| `.github/workflows/holdings-report.yml` | 화-토 07:00 KST cron |

---

## 라이선스

개인 사용 목적으로 제작된 프로젝트입니다.
