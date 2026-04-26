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

## 새 Google Spreadsheet로 교체하는 방법

> 다른 스프레드시트를 사용하거나 다른 사람과 공유할 때

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

### 3단계 — Vercel 환경변수 업데이트

[Vercel 대시보드](https://vercel.com) → 프로젝트 → **Settings → Environment Variables**

| 변수명 | 값 | 어디서 찾나 |
|---|---|---|
| `GOOGLE_SHEET_ID` | 스프레드시트 ID | URL의 `/d/` 다음 부분 |
| `GOOGLE_CLIENT_EMAIL` | 서비스 계정 이메일 | JSON 파일의 `client_email` |
| `GOOGLE_PRIVATE_KEY` | 비공개 키 | JSON 파일의 `private_key` |

**스프레드시트 ID 찾기:**
```
https://docs.google.com/spreadsheets/d/[여기가 ID]/edit
```

**`GOOGLE_PRIVATE_KEY` 입력 방법:**
- JSON 파일의 `"private_key"` 값 전체를 복사하여 붙여넣기
- `-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n` 형태
- Vercel에 입력 시 따옴표 없이 값만 입력

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
│       ├── portfolio/          # 현황 API (평가금액·손익 계산)
│       ├── query/              # 거래 조회 API
│       ├── transactions/       # 거래 입력 API
│       ├── update-transaction/ # 거래 수정 API
│       ├── delete-transaction/ # 거래 삭제 API
│       ├── master/             # Master 시트 조회
│       └── ticker-data/        # 종목 현재가 조회
├── lib/
│   ├── config.ts               # ★ 시트 설정 (시트명·컬럼 설명)
│   ├── sheets.ts               # Google Sheets API 연동
│   └── stock.ts                # 주식·환율 실시간/역사적 조회
└── public/
    └── fima.html               # 프론트엔드 (Single Page)
```

---

## 문제 해결

### 데이터가 로드되지 않을 때
1. Vercel 환경변수 3개가 모두 설정되어 있는지 확인
2. 스프레드시트에 서비스 계정 이메일이 **편집자**로 공유되어 있는지 확인
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
