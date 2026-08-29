# Pension Portfolio Reporter

이 디렉토리는 개인 연금(IRP/저축펀드 등) 포트폴리오 현황을 모니터링하고 일간/주간/월간 리포트를 자동 생성 및 발송하는 스크립트와 리소스들을 포함하고 있습니다.
최근 업데이트로 정적 설정 정보 의존성을 최소화하고 FIMA API와 직접 연동하여 실시간 포트폴리오 및 리밸런싱 정보를 가져오도록 고도화되었습니다.

## 📂 디렉토리 구조 및 파일 설명

```text
pension/
├── README.md                      # 본 문서 (pension 디렉토리 구성 및 설명)
├── portfolio_config.json          # 포트폴리오 기본 설정 (계좌 타겟 정보, 알림 이메일, 정적 종목 정보)
├── portfolio_daily_log.jsonl      # 매일 생성되는 포트폴리오 스냅샷(총자산, 현금, 종목별 가격 등) 누적 로그
├── resources/
│   └── report_template.html       # 이메일 발송 시 사용되는 공통 HTML 템플릿
└── scripts/
    ├── daily_reporter.ps1         # 일일 마감 리포트 생성 및 이메일 발송 스크립트
    ├── weekly_reporter.ps1        # 주간 마감 리포트 생성 및 이메일 발송 스크립트
    ├── monthly_reporter.ps1       # 월간 마감 리포트 생성 및 이메일 발송 스크립트
    ├── fetch_hist.py              # 과거 주가 데이터 등 이력 데이터 수집용 파이썬 스크립트
    └── fetch_month_end.py         # 월말 기준 데이터 수집용 파이썬 스크립트
```

## ⚙️ 주요 구성 요소 상세

### 1. `portfolio_config.json`
* **역할:** 리포터가 참조하는 기본 환경 설정 파일입니다.
* **주요 항목:**
  * `email`: 리포트 발송 송/수신자 이메일 주소 및 앱 비밀번호 설정.
  * `Target`: 데이터를 조회할 대상 계좌 정보(`Account Owner`, `Account`, `Region`).
  * `portfolio.holdings`: 포트폴리오 내 모니터링 대상 종목의 식별 정보(`ticker`, `name`, `category`). 
    * *(참고: 보유 수량, 평단가, 목표 비중 등 가변 데이터는 이 파일에서 관리하지 않고 FIMA API에서 실시간으로 불러옵니다.)*

### 2. 리포터 스크립트 (`scripts/*_reporter.ps1`)
* **역할:** 정해진 주기(일/주/월)마다 포트폴리오의 실시간 상태를 집계하고 메일로 발송합니다.
* **작동 방식:**
  1. `portfolio_config.json`에서 기본 설정 및 종목 리스트를 읽어옵니다.
  2. FIMA API (`/api/portfolio`)를 호출하여 실시간 현금 잔고, 종목별 보유 수량, 매입 단가, 총 투자 원금을 계산합니다.
  3. FIMA 리밸런싱 API (`/api/rebalancing`)를 호출하여 각 종목의 현재 목표 비중(`target_weight`)을 가져와 매핑합니다.
  4. 네이버 금융 및 야후 파이낸스 API 등을 통해 당일 종가 및 배당 정보를 수집합니다.
  5. 종합된 데이터를 `report_template.html`에 주입하여 이메일을 발송하고, `portfolio_daily_log.jsonl`에 로그를 기록합니다.
* **⚠️ 주의사항 (인코딩 규칙):**
  * 스크립트(`*.ps1`) 파일 수정 시 반드시 **UTF-8 (BOM 포함)** 형식으로 저장해야 합니다. 그렇지 않을 경우 GitHub Actions (windows-latest) 환경에서 한글 깨짐 및 구문 오류(`UnexpectedToken`)가 발생합니다.

### 3. HTML 템플릿 (`resources/report_template.html`)
* 이메일 내용에 적용될 HTML 프레임워크입니다.
* 스크립트 내에서 `{{TOTAL_INVESTMENT}}`, `{{ASSET_ROWS}}` 등의 치환자(Placeholder)를 실제 데이터로 치환하여 리포트를 구성합니다.

## 🚀 최신 업데이트 내용
* **FIMA API 완전 연동:** 기존에는 `portfolio_config.json`에 `total_investment`와 `target_weight` 등을 수동으로 하드코딩해야 했으나, 현재는 FIMA API에서 실시간으로 매입 원금 및 리밸런싱 목표 비중을 동적으로 가져와 계산하도록 아키텍처가 개선되었습니다. 
* **설정 파일 경량화:** 실시간으로 가져오는 동적 항목들이 `portfolio_config.json`에서 제거되어 설정 파일의 관리 유지보수성이 대폭 향상되었습니다.
