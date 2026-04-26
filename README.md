# FiMa-Inv — 개인 투자 관리 웹앱

Google Spreadsheet를 DB로 사용하는 투자 포트폴리오 관리 앱입니다.  
Next.js + Vercel로 배포하며, 주식·ETF·펀드·현금 자산을 실시간으로 추적합니다.

---

## 주요 기능

| 탭 | 기능 |
|---|---|
| **현황** | 자산별 평가금액·손익·수익률 게이지, 도넛 차트, 기준일 역사적 종가 조회 |
| **거래 조회** | 필터링·정렬, 수정/삭제, CSV 내보내기 |
| **거래 입력** | Buy / Sell / Deposit / Dividend 등 신규 거래 기록 |

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
    pin:     process.env.PIN_LZ ?? '',        // 빈 문자열이면 PIN 없음
  },

  // ▼ 새 사용자 추가 (아래를 복사해서 추가)
  'Spouse': {
    sheetId: process.env.GOOGLE_SHEET_ID_SPOUSE ?? '',
    pin:     process.env.PIN_SPOUSE ?? '1234', // PIN 설정 시 4자리 권장
  },
  'Child': {
    sheetId: process.env.GOOGLE_SHEET_ID_CHILD ?? '',
    pin:     '',   // PIN 없음 (빈 문자열)
  },
};
```

> ⚠️ 키 이름(`'Spouse'`, `'Child'` 등)이 로그인 화면에 표시되는 이름입니다.

### Step 2 — Vercel 환경변수 추가

[Vercel 대시보드](https://vercel.com) → 프로젝트 → **Settings → Environment Variables**

새 사용자마다 아래 두 항목을 추가합니다 (`이름` 부분을 대문자로 통일):

| 변수명 | 값 | 설명 |
|---|---|---|
| `GOOGLE_SHEET_ID_이름` | `1BxiMV...` | 해당 사용자의 스프레드시트 ID |
| `PIN_이름` | `1234` | PIN (빈 값이면 생략 가능) |

**예시 (Spouse 추가):**
```
GOOGLE_SHEET_ID_SPOUSE  =  1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
PIN_SPOUSE              =  1234
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

### Step 4 — 배포

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
/api/auth 에서 config.ts 기준으로 검증
  ↓
성공 → sessionStorage에 저장 → 해당 사용자 스프레드시트만 접근
  ↓
로그아웃 → sessionStorage 초기화 → 로그인 화면으로
```

### PIN 정책

| 상황 | 동작 |
|---|---|
| `pin: ''` (빈 문자열) | PIN 입력 불필요, 선택만으로 입장 |
| `pin: '1234'` | PIN 일치해야만 입장 |
| PIN 틀렸을 때 | 오류 메시지 표시, 재시도 가능 |

> ⚠️ PIN은 앱 내부 접근 제어용입니다. 중요한 보안 인증이 필요하다면 추가 인증 레이어를 구성하세요.

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
| `PIN_LZ` | `1234` | Lz의 PIN (빈 값이면 생략) |
| `GOOGLE_SHEET_ID_SPOUSE` | `1CyiNW...xyz` | Spouse의 스프레드시트 ID |
| `PIN_SPOUSE` | `5678` | Spouse의 PIN |

> 변수명의 `_LZ`, `_SPOUSE` 부분은 `lib/config.ts`의 키 이름과 대응합니다.

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

## 프로젝트 구조

```
fima-next/
├── app/
│   └── api/
│       ├── auth/               # ★ 로그인 검증 (GET: owner목록, POST: PIN확인)
│       ├── portfolio/          # 현황 API (평가금액·손익 계산)
│       ├── query/              # 거래 조회 API
│       ├── transactions/       # 거래 입력 API
│       ├── update-transaction/ # 거래 수정 API
│       ├── delete-transaction/ # 거래 삭제 API
│       ├── master/             # Master 시트 조회
│       ├── ticker-data/        # 종목코드 목록 조회
│       ├── purchase/           # 매입원가 자동 계산 (Sell 시)
│       └── foreign-buy/        # 해외 Buy + 환전 처리
├── lib/
│   ├── config.ts               # ★★ Owner 설정 (OWNER_CONFIG, 시트명)
│   ├── sheets.ts               # Google Sheets API 연동
│   └── stock.ts                # 주식·환율 실시간/역사적 조회
└── public/
    └── fima.html               # 프론트엔드 (Single Page App)
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

## 라이선스

개인 사용 목적으로 제작된 프로젝트입니다.
