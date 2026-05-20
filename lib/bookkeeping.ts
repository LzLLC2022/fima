/**
 * ============================================================
 * bookkeeping.ts — 복식장부 비즈니스 로직
 * Code.gs (Google Apps Script) 를 TypeScript로 포팅
 *
 * 각 owner의 기존 FiMa Google Spreadsheet에
 * 아래 시트 탭이 추가되어 복식장부 데이터를 저장합니다:
 *   거래     (10컬럼) — 거래 헤더
 *   분개     (8컬럼)  — 분개 항목
 *   계정과목 (9컬럼)  — 계정과목 마스터
 * ============================================================
 */
/**
 * ============================================================
 * [파일 전체 구조 안내]
 *
 * 이 파일은 FiMa 복식부기 시스템의 핵심 비즈니스 로직입니다.
 * Google Spreadsheet를 데이터베이스로 사용하며, 아래 섹션으로 구성됩니다.
 *
 * ① 공통 유틸
 *    - safeFormatDate  : 날짜 형식 통일 변환 (Google Sheets 시리얼 숫자 포함)
 *    - cleanFsName     : 재무제표 계정명에서 번호 접두사 제거
 *    - cleanCategory   : 계정 분류(상)를 표준 카테고리(유동자산 등)로 변환
 *    - ensureSheet     : 시트 탭이 없으면 자동 생성 및 헤더 추가
 *
 * ② 로그인 (loginUser)
 *    - FiMa Master 시트에서 PIN 검증 및 사업자 정보 조회
 *
 * ③ 계정과목 (getAccounts / addAccount / buildAccountMap)
 *    - 계정과목 마스터 CRUD 및 내부 조회용 맵 생성
 *
 * ④ 거래 CRUD (saveTransaction / getTransaction / getTransactions / updateTransaction / deleteTransaction)
 *    - 복식부기 원칙: 하나의 거래(거래 시트) + 복수의 분개(분개 시트)
 *    - 분개는 반드시 차변(Dr) 합계 = 대변(Cr) 합계 (대차평균 원리)
 *
 * ⑤ 총계정원장 (getLedgerData)
 *    - 계정과목별로 차변/대변 거래 내역을 집계하여 원장 형식으로 반환
 *
 * ⑥ 합계잔액시산표 (getTrialBalance)
 *    - D열(계정과목상) 기준 집계와 G열(국세청계정과목) 기준 집계를 동시에 반환
 *    - D열: 시산표 화면 표시용 / G열: 재무상태표·손익계산서 렌더링용
 *
 * ⑦ 전기이월 (carryForward)
 *    - 전년도 재무상태표 계정(자산/부채/자본)의 잔액을 당해 연도 1월 1일자로 이월
 *    - 유동성매도가능증권(AVS)은 종목별로 별도 거래 생성
 *
 * ⑧ 고정자산 CRUD (getAssets / saveAsset / updateAsset / deleteAsset)
 *    - 고정자산 관리대장 시트에 대한 등록·수정·삭제·조회
 * ============================================================
 */

import { getSheets, getSheetValues, appendRow, updateRow, deleteRow, bulkDeleteRows } from '@/lib/sheets';
import { getOwnerSheetId, MASTER_SHEET_NAME } from '@/lib/config';

// ── 시트명 ────────────────────────────────────────────────────
export const BOOK_SHEETS = {
  TRANSACTION : '거래',
  ENTRY       : '분개',
  ACCOUNT     : '계정과목',
  ASSET       : '고정자산',
} as const;

// ── 헤더 정의 ─────────────────────────────────────────────────
const TX_HEADERS      = ['거래ID','날짜','적요','거래처','부가세여부','공급대가','공급가액','부가세','등록일시','수정일시'];
const ENTRY_HEADERS   = ['분개ID','거래ID','순번','구분','계정과목','재무제표계정과목','금액','거래요소'];
const ACCOUNT_HEADERS = ['용도','분류(상)','분류(하)','계정과목(상)','계정과목(하)','계정과목(장부)','국세청계정과목','거래의요소','내용'];
// A:자산번호 B:자산명 C:자산분류 D:규격모델명 E:수량 F:취득방법 G:보관장소
// H:담당부서 I:담당자 J:비고 K:취득일자 L:취득가액 M:상각법 N:내용연수 O:잔존가치율 P:등록일시 Q:수정일시
const ASSET_HEADERS   = ['자산번호','자산명','자산분류','규격/모델명','수량','취득방법','보관장소','담당부서','담당자','비고','취득일자','취득가액','상각법','내용연수','잔존가치율(%)','등록일시','수정일시'];

// ============================================================
//  공통 유틸
// ============================================================

/**
 * 재무제표 계정명에서 번호 접두사를 제거한다.
 * 예) "(1)당좌자산" → "당좌자산", "1. 현금" → "현금"
 * @param v - 원본 계정명 문자열 (any 타입이지만 문자열로 변환됨)
 * @returns 접두사가 제거된 순수 계정명 문자열
 */
/** 분류(하) 접두사 제거: "(1)당좌자산" → "당좌자산" */
export function cleanFsName(v: any): string {
  return String(v || '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/^\d+[.\s]+/, '')
    .trim();
}

/**
 * 계정과목 분류(상) 문자열을 표준 카테고리명으로 정규화한다.
 * 재무상태표(BS)·손익계산서(IS) 분류 기준으로 단순화한다.
 * @param v - 원본 분류(상) 문자열 (예: "I.유동자산", "나.비용")
 * @returns 표준 카테고리명: 유동자산|비유동자산|유동부채|비유동부채|자본|수익|비용|기타
 */
/** 분류(상) → category 정규화 */
export function cleanCategory(v: any): string {
  const s = String(v || '').trim();
  if (!s) return '기타';
  const c = s.replace(/^[^가-힣]*/, '').trim() || s;

  if (c.includes('비유동자산') || c.includes('고정자산') || c.includes('투자자산') ||
      c.includes('유형자산')   || c.includes('무형자산') || c.includes('기타비유동') ||
      c.includes('장기투자'))   return '비유동자산';
  if (c.includes('유동자산')   || c.includes('당좌자산') || c.includes('재고자산')) return '유동자산';
  if (c.includes('비유동부채') || c.includes('장기부채') || c.includes('고정부채')) return '비유동부채';
  if (c.includes('유동부채'))   return '유동부채';
  if (c.includes('이익잉여금') || c.includes('결손금') || c.includes('잉여금') ||
      c.includes('자본'))        return '자본';
  if (c.includes('수익')       || c.includes('매출액') || c.includes('영업수입')) return '수익';
  if (c.includes('원가')       || c.includes('비용')   || c.includes('판매비') ||
      c.includes('관리비'))      return '비용';
  return '기타';
}

/**
 * 다양한 형식의 날짜 값을 "yyyy-MM-dd" 문자열로 변환한다.
 *
 * Google Sheets API는 날짜를 두 가지 방식으로 반환할 수 있다.
 *   1) 숫자형 시리얼: 1899-12-30 기준 경과 일수 (예: 45000 → 2023-03-22)
 *   2) 문자열 또는 Date 객체: 일반 JS 날짜 파싱으로 처리
 *
 * @param rawVal - Google Sheets에서 읽어온 날짜 원시값 (숫자, 문자열, Date 모두 허용)
 * @returns "yyyy-MM-dd" 형식의 날짜 문자열. 변환 불가 시 원본 문자열 반환, 빈 값이면 ''
 */
/** 날짜 안전 파싱 → yyyy-MM-dd */
export function safeFormatDate(rawVal: any): string {
  if (!rawVal && rawVal !== 0) return '';
  try {
    // Google Sheets 날짜 시리얼 숫자 처리 (USER_ENTERED로 저장된 날짜)
    // Sheets 기준점: 1899-12-30 (Excel 호환 방식)
    if (typeof rawVal === 'number' && rawVal > 1000) {
      const sheetsEpoch = Date.UTC(1899, 11, 30); // 1899-12-30 UTC
      // 시리얼 숫자에 86400000ms(하루)를 곱해 기준점으로부터의 밀리초를 더함
      const d = new Date(sheetsEpoch + rawVal * 86400000);
      const y   = d.getUTCFullYear();
      const m   = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    // 숫자가 아니거나 1000 이하인 경우: 문자열 또는 Date 객체로 처리
    const d = rawVal instanceof Date ? rawVal : new Date(rawVal);
    if (isNaN(d.getTime())) return String(rawVal); // 파싱 실패 시 원본 반환
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return String(rawVal);
  }
}

// ── 시트 탭 생성 ──────────────────────────────────────────────
async function createSheetTab(spreadsheetId: string, sheetName: string): Promise<void> {
  const sheets = await getSheets();
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
  } catch {
    // 이미 존재하면 무시
  }
}

/** 시트가 없으면 생성하고 헤더 추가 */
async function ensureSheet(spreadsheetId: string, sheetName: string, headers: string[]): Promise<void> {
  let data: any[][];
  try {
    data = await getSheetValues(spreadsheetId, sheetName);
  } catch {
    await createSheetTab(spreadsheetId, sheetName);
    data = [];
  }
  if (!data || data.length === 0) {
    await appendRow(spreadsheetId, sheetName, headers);
  }
}

/** 시트 데이터 안전 조회 (없으면 빈 배열) */
async function safeGetSheetValues(spreadsheetId: string, sheetName: string): Promise<any[][]> {
  try {
    return await getSheetValues(spreadsheetId, sheetName);
  } catch {
    return [];
  }
}

// ============================================================
//  로그인 — FiMa Master 시트에서 PIN + BizInfo 조회
// ============================================================

/**
 * FiMa Master 시트에서 PIN을 검증하고 사업자 정보를 반환한다.
 *
 * 검증 순서:
 *   1) owner명이 config에 등록된 사용자인지 확인
 *   2) Master 시트에서 PIN 컬럼을 찾아 저장된 PIN과 비교
 *   3) owner 컬럼이 있으면 owner와 일치하는 행에서 사업자 정보 추출,
 *      없으면 두 번째 행(첫 데이터 행)에서 추출
 *
 * @param owner - 로그인할 사용자명 (config에 등록된 owner key)
 * @param pin   - 사용자가 입력한 PIN 번호 문자열
 * @returns 로그인 성공 여부와 사업자명·사업자등록번호, 실패 시 error 메시지
 */
export async function loginUser(
  owner: string,
  pin: string,
): Promise<{ success: boolean; owner?: string; bizName?: string; bizRegNo?: string; error?: string }> {
  if (!owner) return { success: false, error: '사용자명을 입력하세요.' };

  let sheetId: string;
  try {
    sheetId = getOwnerSheetId(owner);
  } catch {
    return { success: false, error: '등록되지 않은 사용자입니다.' };
  }

  try {
    const masterData = await getSheetValues(sheetId, MASTER_SHEET_NAME);
    let sheetPin = '';
    let bizName  = '';
    let bizRegNo = '';

    if (masterData && masterData.length >= 1) {
      // 헤더 행을 소문자·공백 제거 후 배열로 저장하여 컬럼 인덱스를 동적으로 탐색
      const headers    = masterData[0].map((h: any) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ''));
      const pinIdx     = headers.findIndex((h: string) => h === 'pin');
      const bizNameIdx = headers.findIndex((h: string) => h === 'bizname'  || h === '상호');
      const bizRgIdx   = headers.findIndex((h: string) => h === 'bizregno' || h === '사업자등록번호');
      const ownerIdx   = headers.findIndex((h: string) => h === 'accountowner' || h === 'owner');

      // PIN: 첫 번째 비어 있지 않은 값
      if (pinIdx !== -1) {
        for (let i = 1; i < masterData.length; i++) {
          const val = String(masterData[i][pinIdx] ?? '').trim();
          if (val) { sheetPin = val; break; }
        }
      }

      // BizName / BizRegNo: owner와 일치하는 행에서 읽기
      if (ownerIdx !== -1) {
        // owner 컬럼이 있으면 owner명이 일치하는 행을 탐색
        for (let i = 1; i < masterData.length; i++) {
          const rowOwner = String(masterData[i][ownerIdx] ?? '').trim().toLowerCase();
          if (rowOwner === owner.toLowerCase()) {
            if (bizNameIdx !== -1) bizName  = String(masterData[i][bizNameIdx] ?? '').trim();
            if (bizRgIdx   !== -1) bizRegNo = String(masterData[i][bizRgIdx]   ?? '').trim();
            break;
          }
        }
      } else if (masterData.length > 1) {
        // owner 컬럼이 없으면 두 번째 행(첫 데이터 행)에서 사업자 정보 추출
        if (bizNameIdx !== -1) bizName  = String(masterData[1][bizNameIdx] ?? '').trim();
        if (bizRgIdx   !== -1) bizRegNo = String(masterData[1][bizRgIdx]   ?? '').trim();
      }
    }

    // PIN이 설정된 경우에만 검증 (미설정 시 PIN 없이 로그인 가능)
    if (sheetPin && String(pin ?? '') !== sheetPin) {
      return { success: false, error: 'PIN이 올바르지 않습니다.' };
    }

    return { success: true, owner, bizName, bizRegNo };
  } catch (e: any) {
    return { success: false, error: 'Master 시트 접근 오류: ' + e.message };
  }
}

// ============================================================
//  계정과목
// ============================================================

/**
 * 계정과목 시트에서 전체 계정과목 목록을 조회하여 반환한다.
 * 시트가 없으면 헤더 행을 포함해 자동 생성한다.
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @returns 계정과목 객체 배열 (yongdo, catRaw, fsName, category 등 포함)
 */
/** 계정과목 목록 반환 */
export async function getAccounts(spreadsheetId: string): Promise<any[]> {
  await ensureSheet(spreadsheetId, BOOK_SHEETS.ACCOUNT, ACCOUNT_HEADERS);
  const data = await getSheetValues(spreadsheetId, BOOK_SHEETS.ACCOUNT);
  return data.slice(1).filter(r => String(r[5] || '').trim()).map(r => ({
    yongdo   : String(r[0] || '').trim(),
    catRaw   : String(r[1] || '').trim(),
    fsName   : cleanFsName(String(r[2] || '')),
    catUpper : String(r[3] || '').trim(),
    catLower : String(r[4] || '').trim(),
    name     : String(r[5] || '').trim(),
    ntsName  : String(r[6] || '').trim(),
    element  : String(r[7] || '').trim(),
    note     : String(r[8] || '').trim(),
    category : cleanCategory(String(r[1] || '')),
  }));
}

/**
 * 계정과목 시트에 새 계정과목 행을 추가한다.
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param body - 추가할 계정과목 데이터 (yongdo, catRaw, fsName, catUpper, catLower, name, ntsName, element, note)
 * @returns 처리 성공 여부
 */
/** 계정과목 추가 */
export async function addAccount(spreadsheetId: string, body: any): Promise<{ success: boolean }> {
  await ensureSheet(spreadsheetId, BOOK_SHEETS.ACCOUNT, ACCOUNT_HEADERS);
  await appendRow(spreadsheetId, BOOK_SHEETS.ACCOUNT, [
    body.yongdo || '', body.catRaw || '', body.fsName || '',
    body.catUpper || '', body.catLower || '', body.name || '',
    body.ntsName || '', body.element || '', body.note || '',
  ]);
  return { success: true };
}

/**
 * 계정과목 시트를 읽어 "계정과목(장부명) → 메타정보" 형태의 맵을 생성한다.
 *
 * 이 맵은 거래 저장·수정·전기이월 시 계정 메타(fsName, element, category 등)를
 * 빠르게 조회하기 위한 내부 전용 헬퍼다.
 *
 * 맵 구조 예시:
 *   {
 *     "현금": { yongdo: "자산", catRaw: "I.유동자산", fsName: "당좌자산",
 *               category: "유동자산", element: "자산의 증가", ... },
 *     "외상매출금": { ... },
 *     ...
 *   }
 *
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @returns 계정과목(장부) 문자열을 키로 하는 메타정보 맵
 */
/** 계정 맵: 계정과목(장부) → 메타정보 */
async function buildAccountMap(spreadsheetId: string): Promise<Record<string, any>> {
  const data = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ACCOUNT);
  const map: Record<string, any> = {};
  data.slice(1).forEach(r => {
    const name = String(r[5] || '').trim(); // F열: 계정과목(장부) — 맵의 키로 사용
    if (!name) return;
    map[name] = {
      yongdo   : String(r[0] || '').trim(),
      catRaw   : String(r[1] || '').trim(),
      fsName   : cleanFsName(String(r[2] || '')),
      catUpper : String(r[3] || '').trim(),
      catLower : String(r[4] || '').trim(),
      ntsName  : String(r[6] || '').trim(),
      element  : String(r[7] || '').trim(),
      note     : String(r[8] || '').trim(),
      category : cleanCategory(String(r[1] || '')),
    };
  });
  return map;
}

// ============================================================
//  거래 CRUD
// ============================================================

/**
 * 새 거래와 분개 항목들을 Spreadsheet에 저장한다.
 *
 * 복식부기 저장 구조:
 *   - 거래 시트에 거래 헤더 1행 추가 (txId, 날짜, 적요, 거래처, 부가세, 금액 등)
 *   - 분개 시트에 분개 항목 N행 추가 (차변/대변 각 계정별로 1행씩)
 *   - 분개 ID(JE...)는 타임스탬프 + 순번으로 자동 채번
 *   - 계정과목 맵에서 fsName(재무제표계정과목)과 element(거래요소) 자동 보완
 *
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param payload - 거래 데이터 (date, description, counterpart, vatFlag, totalAmount,
 *                  supplyAmount, vatAmount, entries: [{side, account, amount}])
 * @returns 생성된 거래ID(txId)와 성공 여부
 */
/** 거래 저장 */
export async function saveTransaction(
  spreadsheetId: string,
  payload: any,
): Promise<{ success: boolean; txId: string }> {
  await ensureSheet(spreadsheetId, BOOK_SHEETS.TRANSACTION, TX_HEADERS);
  await ensureSheet(spreadsheetId, BOOK_SHEETS.ENTRY, ENTRY_HEADERS);

  const now  = new Date().toISOString();
  // txId: 'TX' + 밀리초 타임스탬프 끝 8자리 (예: TX45678901)
  const txId = 'TX' + String(Date.now()).slice(-8);

  // 거래 헤더 행 추가
  await appendRow(spreadsheetId, BOOK_SHEETS.TRANSACTION, [
    txId, payload.date, payload.description,
    payload.counterpart || '', payload.vatFlag || 'X',
    Number(payload.totalAmount)  || 0,
    Number(payload.supplyAmount) || 0,
    Number(payload.vatAmount)    || 0,
    now, now,
  ]);

  // 계정과목 맵으로 각 분개의 fsName·element 보완 후 분개 행 추가
  const accountMap = await buildAccountMap(spreadsheetId);
  for (let idx = 0; idx < (payload.entries || []).length; idx++) {
    const entry = payload.entries[idx];
    const acct  = accountMap[entry.account] || {};
    const eId   = 'JE' + String(Date.now()).slice(-8) + idx;
    await appendRow(spreadsheetId, BOOK_SHEETS.ENTRY, [
      eId, txId, idx + 1, entry.side, entry.account,
      acct.fsName || '', Number(entry.amount) || 0, acct.element || '',
    ]);
  }

  return { success: true, txId };
}

/**
 * 특정 거래ID에 해당하는 거래 헤더와 분개 항목을 조회한다.
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param txId - 조회할 거래ID (예: "TX45678901")
 * @returns 거래 객체 (date, description, counterpart, entries 배열 포함). 없으면 error 반환
 */
/** 단일 거래 조회 */
export async function getTransaction(spreadsheetId: string, txId: string): Promise<any> {
  const tData = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.TRANSACTION);
  const eData = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ENTRY);

  const tx = tData.slice(1).find(r => r[0] === txId);
  if (!tx) return { error: '거래를 찾을 수 없습니다.' };

  const entries = eData.slice(1)
    .filter(r => r[1] === txId)
    .map(r => ({ side: r[3], account: r[4], fsName: r[5], amount: r[6], element: r[7] }));

  return {
    txId        : tx[0],
    date        : safeFormatDate(tx[1]),
    description : tx[2],
    counterpart : tx[3],
    vatFlag     : tx[4],
    totalAmount  : tx[5],
    supplyAmount : tx[6],
    vatAmount    : tx[7],
    entries,
  };
}

/**
 * 거래 목록을 조회한다. 연도·월·키워드 필터를 지원한다.
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param p - 필터 옵션 ({ year?, month?, keyword? })
 * @returns 거래 객체 배열. 날짜 내림차순, 같은 날짜 내에서는 기말결산 > 일반 > 전기이월 순
 */
/** 거래 목록 조회 (연/월/키워드 필터) */
export async function getTransactions(spreadsheetId: string, p: any): Promise<any[]> {
  const tData = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.TRANSACTION);
  const eData = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ENTRY);

  const entryMap: Record<string, any[]> = {};
  eData.slice(1).filter(r => r[0]).forEach(r => {
    if (!entryMap[r[1]]) entryMap[r[1]] = [];
    entryMap[r[1]].push({
      side    : r[3],
      account : r[4],
      fsName  : r[5],
      amount  : Number(r[6]) || 0,
      element : r[7],
    });
  });

  let list = tData.slice(1).filter(r => r[0]).map(r => ({
    txId         : r[0],
    date         : safeFormatDate(r[1]),
    description  : String(r[2] || ''),
    counterpart  : String(r[3] || ''),
    vatFlag      : r[4],
    totalAmount  : Number(r[5]) || 0,
    supplyAmount : Number(r[6]) || 0,
    vatAmount    : Number(r[7]) || 0,
    entries      : entryMap[r[0]] || [],
  }));

  if (p.year)    list = list.filter(t => t.date.startsWith(p.year));
  if (p.month)   list = list.filter(t => t.date.substring(5, 7) === String(p.month).padStart(2, '0'));
  if (p.keyword) {
    const kw = p.keyword.toLowerCase();
    list = list.filter(t =>
      t.description.toLowerCase().includes(kw) ||
      (t.counterpart || '').toLowerCase().includes(kw),
    );
  }

  const typeOrder = (d: string) => d.includes('기말결산') ? 0 : d.includes('전기이월') ? 2 : 1;
  list.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return typeOrder(a.description) - typeOrder(b.description);
  });

  return list;
}

/**
 * 기존 거래를 수정한다. 거래 헤더를 갱신하고 분개를 전체 교체한다.
 *
 * 분개 교체 방식 (기존 삭제 → 새로 추가):
 *   1) 해당 txId의 기존 분개 행을 역순으로 삭제
 *      (역순 삭제: 앞 행을 먼저 삭제하면 뒤 행의 행 번호가 밀려 잘못 삭제되는 것을 방지)
 *   2) payload.entries 배열로 새 분개 행들을 추가
 *
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param payload - 수정할 거래 데이터 (txId 필수, 나머지는 saveTransaction과 동일 구조)
 * @returns 성공 여부. 거래를 찾지 못하면 error 반환
 */
/** 거래 수정 */
export async function updateTransaction(
  spreadsheetId: string,
  payload: any,
): Promise<{ success: boolean; error?: string }> {
  const tData = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.TRANSACTION);
  const eData = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ENTRY);

  const tRows  = tData.slice(1);
  const tIdx   = tRows.findIndex(r => r[0] === payload.txId);
  if (tIdx < 0) return { success: false, error: '거래를 찾을 수 없습니다.' };

  const sheetRowNum = tIdx + 2; // 1-indexed + header
  const now         = new Date().toISOString();

  await updateRow(spreadsheetId, BOOK_SHEETS.TRANSACTION, sheetRowNum, [
    payload.txId,
    payload.date,
    payload.description,
    payload.counterpart  || '',
    payload.vatFlag      || 'X',
    Number(payload.totalAmount)  || 0,
    Number(payload.supplyAmount) || 0,
    Number(payload.vatAmount)    || 0,
    tRows[tIdx][8],  // 등록일시 보존 (최초 등록 시각을 수정 후에도 유지)
    now,
  ]);

  // 기존 분개 삭제 (역순으로 — 행 번호 이동 방지)
  const eRows    = eData.slice(1);
  const toDelete = eRows
    .map((r, i) => ({ r, sheetRow: i + 2 }))
    .filter(({ r }) => r[1] === payload.txId)
    .reverse(); // 행 번호가 큰 것부터 삭제해야 앞 행의 번호가 바뀌지 않음

  for (const { sheetRow } of toDelete) {
    await deleteRow(spreadsheetId, BOOK_SHEETS.ENTRY, sheetRow);
  }

  // 새 분개 추가
  const accountMap = await buildAccountMap(spreadsheetId);
  for (let idx = 0; idx < (payload.entries || []).length; idx++) {
    const entry = payload.entries[idx];
    const acct  = accountMap[entry.account] || {};
    const eId   = 'JE' + String(Date.now()).slice(-8) + idx;
    await appendRow(spreadsheetId, BOOK_SHEETS.ENTRY, [
      eId, payload.txId, idx + 1, entry.side, entry.account,
      acct.fsName || '', Number(entry.amount) || 0, acct.element || '',
    ]);
  }

  return { success: true };
}

/**
 * 거래와 해당 거래의 모든 분개 항목을 삭제한다.
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param txId - 삭제할 거래ID
 * @returns 성공 여부
 */
/** 거래 삭제 */
export async function deleteTransaction(
  spreadsheetId: string,
  txId: string,
): Promise<{ success: boolean }> {
  const tData = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.TRANSACTION);
  const eData = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ENTRY);

  // 거래 행 삭제 (역순)
  const tRows  = tData.slice(1);
  const tIdx   = tRows.findIndex(r => r[0] === txId);
  if (tIdx >= 0) await deleteRow(spreadsheetId, BOOK_SHEETS.TRANSACTION, tIdx + 2);

  // 분개 행 삭제 (역순)
  const eRows    = eData.slice(1);
  const toDelete = eRows
    .map((r, i) => ({ r, sheetRow: i + 2 }))
    .filter(({ r }) => r[1] === txId)
    .reverse();

  for (const { sheetRow } of toDelete) {
    await deleteRow(spreadsheetId, BOOK_SHEETS.ENTRY, sheetRow);
  }

  return { success: true };
}

// ============================================================
//  총계정원장 데이터 (JSON 반환)
// ============================================================

/**
 * 총계정원장 데이터를 집계하여 계정과목별 차변/대변 내역과 잔액을 반환한다.
 *
 * 집계 방식:
 *   - 연도 필터(p.year)가 있으면 해당 연도 거래만 포함
 *   - 각 계정과목별로 차변(debits) 배열, 대변(credits) 배열, 합계(drTotal/crTotal), 잔액(balance) 계산
 *   - balance = drTotal - crTotal (자산/비용은 양수가 정상, 부채/자본/수익은 음수가 정상)
 *   - 결과는 카테고리 순서(유동자산→비유동자산→...→비용→기타)로 정렬
 *
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param p - 필터 옵션 ({ year?: string })
 * @returns 계정과목별 원장 데이터 배열
 */
export async function getLedgerData(spreadsheetId: string, p: any): Promise<any[]> {
  const accountMap = await buildAccountMap(spreadsheetId);
  const txList     = await getTransactions(spreadsheetId, p.year ? { year: p.year } : {});
  const ledger: Record<string, any> = {};

  txList.forEach(tx => {
    tx.entries.forEach((e: any) => {
      if (!ledger[e.account]) {
        const acct = accountMap[e.account] || {};
        ledger[e.account] = {
          name     : e.account,
          fsName   : acct.fsName   || e.fsName   || '',
          catRaw   : acct.catRaw   || '',
          element  : acct.element  || e.element  || '',
          category : acct.category || '기타',
          debits   : [],
          credits  : [],
        };
      }
      const row = { date: tx.date, desc: tx.description, txId: tx.txId, amount: e.amount };
      if (e.side === '차변') ledger[e.account].debits.push(row);
      else                   ledger[e.account].credits.push(row);
    });
  });

  const catOrder = ['유동자산','비유동자산','유동부채','비유동부채','자본','수익','비용','기타'];
  return Object.values(ledger)
    .sort((a: any, b: any) => {
      const ci = catOrder.indexOf(a.category) - catOrder.indexOf(b.category);
      return ci !== 0 ? ci : a.name.localeCompare(b.name, 'ko');
    })
    .map((d: any) => {
      const drTotal = d.debits.reduce((s: number, r: any)  => s + r.amount, 0);
      const crTotal = d.credits.reduce((s: number, r: any) => s + r.amount, 0);
      return {
        name: d.name, fsName: d.fsName, catRaw: d.catRaw,
        element: d.element, category: d.category,
        drTotal, crTotal, balance: drTotal - crTotal,
        debits: d.debits, credits: d.credits,
      };
    });
}

// ============================================================
//  합계잔액시산표 (소득세법 서식 기준)
// ============================================================

/**
 * 합계잔액시산표 데이터를 두 가지 기준으로 집계하여 반환한다.
 *
 * 반환 구조:
 *   - items  : D열(계정과목상) 기준 집계 → 시산표 화면 표시용
 *   - ntsList: G열(국세청계정과목) 기준 집계 → 재무상태표(BS)·손익계산서(IS) 렌더링용
 *
 * D열 vs G열 집계 차이:
 *   D열(계정과목상): 계정과목 시트에서 동일한 D값을 가진 행들의 금액을 묶음
 *                   하나의 D값 아래 여러 G값(국세청 코드)이 혼재할 수 있어
 *                   BS/IS 렌더링에 부적합할 수 있음
 *   G열(국세청계정과목): 국세청 표준 코드별로 재집계
 *                       각 NTS 코드의 정확한 금액을 얻을 수 있어 BS/IS에 적합
 *
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param p - 필터 옵션 ({ year?: string })
 * @returns { items: D열 기준 배열, ntsList: G열 기준 배열 }
 */
export async function getTrialBalance(spreadsheetId: string, p: any): Promise<any> {
  const txList = await getTransactions(spreadsheetId, p && p.year ? { year: p.year } : {});
  // 1단계: 분개 데이터에서 계정과목별 차변·대변 합계를 먼저 집계
  const totals: Record<string, { dr: number; cr: number }> = {};

  txList.forEach(tx => {
    tx.entries.forEach((e: any) => {
      if (!totals[e.account]) totals[e.account] = { dr: 0, cr: 0 };
      if (e.side === '차변') totals[e.account].dr += e.amount;
      else                    totals[e.account].cr += e.amount;
    });
  });

  // 2단계: 계정과목 시트 순서대로 D열(계정과목상) 기준으로 집계
  const data    = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ACCOUNT);
  const rows    = data.slice(1);
  const order   : string[]          = [];
  const accMap  : Record<string, any> = {};

  rows.forEach(r => {
    const jangbu      = String(r[5] || '').trim(); // F열: 계정과목(장부) — totals 조회 키
    const catUpperRaw = String(r[3] || '').trim(); // D열: 계정과목(상) — 집계 그룹 키
    // D열(계정과목상)이 비어있으면 F열(계정과목장부)을 표시명으로 사용
    const catUpper    = cleanFsName(catUpperRaw) || jangbu;
    if (!catUpper) return;

    const t = jangbu ? (totals[jangbu] || { dr: 0, cr: 0 }) : { dr: 0, cr: 0 };

    if (!accMap[catUpper]) {
      // 처음 등장하는 catUpper는 order 배열에 추가하여 원래 시트 순서를 유지
      order.push(catUpper);
      accMap[catUpper] = {
        name     : catUpper,
        nameRaw  : catUpperRaw,
        category : cleanCategory(String(r[1] || '')),
        fsName   : cleanFsName(String(r[2] || '')),
        catRaw   : String(r[1] || '').trim(),
        ntsName  : String(r[6] || '').trim(),   // G열: 국세청계정과목
        drTotal  : 0,
        crTotal  : 0,
      };
    }
    // 동일 catUpper를 가진 여러 장부계정의 금액을 누적 합산
    accMap[catUpper].drTotal += t.dr;
    accMap[catUpper].crTotal += t.cr;
  });

  // ── G열(국세청계정과목) 기준 집계 — BS/IS 렌더링용 ──────────────
  // D열 집계는 하나의 row에 여러 G값이 섞여 ntsName이 첫 번째 값으로만 저장됨.
  // G열 기준으로 재집계하면 각 NTS 코드별 정확한 금액을 얻을 수 있음.
  const ntsOrder: string[] = [];
  const ntsMap: Record<string, any> = {};

  rows.forEach(r => {
    const jangbu  = String(r[5] || '').trim(); // F열: 계정과목(장부) — totals 조회 키
    const ntsName = String(r[6] || '').trim(); // G열: 국세청계정과목 — 집계 그룹 키
    const key     = ntsName || jangbu; // G열 우선, 없으면 F열(장부)
    if (!key) return;

    const t = jangbu ? (totals[jangbu] || { dr: 0, cr: 0 }) : { dr: 0, cr: 0 };

    if (!ntsMap[key]) {
      ntsOrder.push(key);
      ntsMap[key] = {
        name     : cleanFsName(String(r[3] || '').trim()) || jangbu,
        ntsName  : ntsName,
        category : cleanCategory(String(r[1] || '')),
        fsName   : cleanFsName(String(r[2] || '')),
        catRaw   : String(r[1] || '').trim(),
        drTotal  : 0,
        crTotal  : 0,
      };
    }
    ntsMap[key].drTotal += t.dr;
    ntsMap[key].crTotal += t.cr;
  });

  return {
    items   : order.map(name => accMap[name]),    // D열 기준 (TB 렌더링용)
    ntsList : ntsOrder.map(key => ntsMap[key]),   // G열 기준 (BS/IS 렌더링용)
  };
}

// ============================================================
//  전기이월 (carryForward)
//  ※ 유동성매도가능증권은 종목별 별도 거래로 생성 (적요: 전기이월(종목명))
// ============================================================

/**
 * 전년도 재무상태표 계정 잔액을 당해 연도 1월 1일자 "전기이월" 거래로 이월한다.
 *
 * 핵심 로직:
 *   1) 전년도 거래를 모두 조회하여 계정과목별 차변·대변 합계(totals) 계산
 *   2) 재무상태표 계정(자산·부채·자본)만 선별하여 잔액(balance) 산출
 *      - 자산·비용 계정 (crNorm=false): balance = dr - cr
 *      - 부채·자본 계정 (crNorm=true) : balance = cr - dr  ← 크레딧 정규화
 *        (부채·자본은 대변 증가이므로 cr - dr이 양수이면 정상 잔액)
 *   3) balance > 0이면 정상 방향 분개, < 0이면 반대 방향 분개로 entries 구성
 *   4) 유동성매도가능증권(AVS)은 적요의 종목 티커를 파싱하여 종목별 별도 거래 생성
 *      (AVS는 종목별 단방향 분개 1건만 생성 — 상대계정 없음)
 *   5) 기존 전기이월 행(CF{year}, CF{year}AVS_*)을 일괄 삭제 후 새로 작성
 *      (재실행 시 중복 방지)
 *
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param p - 이월 옵션 ({ year: string }) — 이월 대상 연도(당해 연도, 전년도 잔액을 이월함)
 * @returns { success, year, entriesCount } 또는 잔액이 없을 때 { success: false, error }
 */
export async function carryForward(spreadsheetId: string, p: any): Promise<any> {
  const year     = p.year ? parseInt(p.year) : new Date().getFullYear();
  const prevYear = year - 1;
  const AVS_KW   = '유동성매도가능증권';  // 계정명 포함 여부로 판단 (정확 일치 대신 includes 사용)

  const accountMap = await buildAccountMap(spreadsheetId);
  const txList     = await getTransactions(spreadsheetId, { year: String(prevYear) });

  console.log(`[carryForward] year=${year}, prevYear=${prevYear}, txList=${txList.length}건`);

  const totals: Record<string, { dr: number; cr: number }> = {};
  const avsTickerMap: Record<string, { dr: number; cr: number }> = {};

  // AVS 계정의 실제 저장 계정명 추적 (첫 발견 값 사용)
  let avsRealName = '';

  txList.forEach((tx: any) => {
    const desc = (tx.description || '').trim();
    tx.entries.forEach((e: any) => {
      const acctName: string = String(e.account || '');
      if (!totals[acctName]) totals[acctName] = { dr: 0, cr: 0 };
      if (e.side === '차변') totals[acctName].dr += Number(e.amount) || 0;
      else                    totals[acctName].cr += Number(e.amount) || 0;

      // 유동성매도가능증권 계정 감지 (includes로 유연하게)
      if (acctName.includes(AVS_KW)) {
        if (!avsRealName) avsRealName = acctName;
        const m = desc.match(/\(([A-Za-z]+)/);
        const ticker = m ? m[1] : '기타';
        if (!avsTickerMap[ticker]) avsTickerMap[ticker] = { dr: 0, cr: 0 };
        if (e.side === '차변') avsTickerMap[ticker].dr += Number(e.amount) || 0;
        else                    avsTickerMap[ticker].cr += Number(e.amount) || 0;
      }
    });
  });

  // AVS 계정명 로그
  const avsAcctNamesInTotals = Object.keys(totals).filter(n => n.includes(AVS_KW));
  console.log(`[carryForward] AVS 계정명(totals): ${JSON.stringify(avsAcctNamesInTotals)}`);
  console.log(`[carryForward] avsTickerMap: ${JSON.stringify(avsTickerMap)}`);

  // 재무상태표 카테고리 집합 — 이 카테고리에 속하는 계정만 이월 대상
  const bsCats    = new Set(['유동자산','비유동자산','유동부채','비유동부채','자본']);
  const drEntries : any[] = []; // 전기이월 분개 중 차변(Dr) 항목
  const crEntries : any[] = []; // 전기이월 분개 중 대변(Cr) 항목

  Object.keys(totals).forEach(name => {
    // AVS 계정은 종목별 별도 처리 — includes로 판단
    if (name.includes(AVS_KW)) return;

    const acct   = accountMap[name] || {};
    const cat    = acct.category || '기타';
    if (!bsCats.has(cat)) return; // 손익(수익·비용) 계정은 전기이월 불필요

    const { dr, cr } = totals[name];
    // crNorm(크레딧 정규화): 부채·자본은 대변 증가가 정상이므로 잔액 = cr - dr
    const crNorm     = ['유동부채','비유동부채','자본'].includes(cat);
    const balance    = crNorm ? (cr - dr) : (dr - cr);
    if (balance === 0) return; // 잔액이 0이면 이월 불필요

    if (!crNorm) {
      // 자산 계정: balance > 0이면 차변 잔액 → 차변 분개 / balance < 0이면 대변 잔액 → 대변 분개
      if (balance > 0) drEntries.push({ side: '차변', account: name, amount: balance,  acct });
      else             crEntries.push({ side: '대변', account: name, amount: -balance, acct });
    } else {
      // 부채·자본 계정: balance > 0이면 대변 잔액 → 대변 분개 / balance < 0이면 차변 잔액 → 차변 분개
      if (balance > 0) crEntries.push({ side: '대변', account: name, amount: balance,  acct });
      else             drEntries.push({ side: '차변', account: name, amount: -balance, acct });
    }
  });

  // AVS 종목별 잔액 계산 (유동자산 → 차변 기준)
  // avsRealName이 있으면 그걸 사용, 없으면 AVS_KW 사용
  const avsStoredName = avsRealName || AVS_KW;
  const avsAcct = accountMap[avsStoredName] || accountMap[AVS_KW] || {};
  const avsItems: { ticker: string; side: string; amount: number }[] = [];

  Object.entries(avsTickerMap).forEach(([ticker, { dr, cr }]) => {
    const balance = dr - cr;
    if (balance === 0) return;
    if (balance > 0) avsItems.push({ ticker, side: '차변', amount:  balance });
    else             avsItems.push({ ticker, side: '대변', amount: -balance });
  });

  console.log(`[carryForward] avsItems: ${JSON.stringify(avsItems)}, avsStoredName="${avsStoredName}"`);

  if (!drEntries.length && !crEntries.length && !avsItems.length) {
    // 진단 정보 포함한 에러 반환
    const acctKeys  = Object.keys(totals);
    const bsCount   = acctKeys.filter(n => {
      const cat = (accountMap[n] || {}).category || '기타';
      return ['유동자산','비유동자산','유동부채','비유동부채','자본'].includes(cat);
    }).length;
    return {
      success: false,
      error: `${prevYear}년 이월할 잔액이 없습니다. `
           + `[거래:${txList.length}건 / 계정:${acctKeys.length}개 / BS계정:${bsCount}개 / `
           + `계정과목맵:${Object.keys(accountMap).length}개]`,
    };
  }

  const allMainEntries = [...drEntries, ...crEntries];
  const cfTxId      = 'CF' + String(year);
  const cfAvsPrefix = 'CF' + String(year) + 'AVS_';
  const cfDate      = `${year}-01-01`;
  const now         = new Date().toISOString();

  // ── 기존 전기이월 행 일괄 삭제 (API 호출 최소화) ───────────────
  //  대상: ① CF{year}  ② CF{year}AVS_*  ③ year-01-01 + '전기이월' 수동 입력
  const txSheet = await getSheetValues(spreadsheetId, BOOK_SHEETS.TRANSACTION);
  const eSheet  = await getSheetValues(spreadsheetId, BOOK_SHEETS.ENTRY);

  // 삭제 대상 txId 집합 및 TRANSACTION 행 번호 수집
  const deleteIds = new Set<string>();
  const txRowNums: number[] = [];
  txSheet.slice(1).forEach((row: any[], idx: number) => {
    const id   = String(row[0] || '');
    const date = safeFormatDate(row[1]);
    const desc = String(row[2] || '');
    if (id === cfTxId || id.startsWith(cfAvsPrefix)
        || (date === cfDate && desc.includes('전기이월'))) {
      if (id) deleteIds.add(id);
      txRowNums.push(idx + 2);  // 1-indexed + header
    }
  });

  // 삭제 대상 ENTRY 행 번호 수집
  const eRowNums: number[] = [];
  eSheet.slice(1).forEach((row: any[], idx: number) => {
    if (deleteIds.has(String(row[1] || ''))) {
      eRowNums.push(idx + 2);
    }
  });

  console.log(`[carryForward] TX삭제 ${txRowNums.length}행, ENTRY삭제 ${eRowNums.length}행`);

  // ENTRY → TRANSACTION 순서로 일괄 삭제 (각 1회 API 호출)
  if (eRowNums.length)  await bulkDeleteRows(spreadsheetId, BOOK_SHEETS.ENTRY,       eRowNums);
  if (txRowNums.length) await bulkDeleteRows(spreadsheetId, BOOK_SHEETS.TRANSACTION, txRowNums);

  // 주 전기이월 거래 생성 (AVS 제외)
  if (allMainEntries.length) {
    await appendRow(spreadsheetId, BOOK_SHEETS.TRANSACTION, [
      cfTxId, cfDate, '전기이월', '', 'X', 0, 0, 0, now, now,
    ]);
    for (let idx = 0; idx < allMainEntries.length; idx++) {
      const e = allMainEntries[idx];
      await appendRow(spreadsheetId, BOOK_SHEETS.ENTRY, [
        `JE${cfTxId}${idx}`, cfTxId, idx + 1,
        e.side, e.account, e.acct.fsName || '', e.amount, e.acct.element || '',
      ]);
    }
  }

  // AVS 종목별 전기이월 거래 생성
  // — 각 종목: AVS 계정 분개 1건만 (차변 또는 대변 한쪽만, 이익잉여금 상대분개 없음)
  for (const e of avsItems) {
    const txId   = cfAvsPrefix + e.ticker;
    const txDesc = `전기이월(${e.ticker})`;
    await appendRow(spreadsheetId, BOOK_SHEETS.TRANSACTION, [
      txId, cfDate, txDesc, '', 'X', 0, 0, 0, now, now,
    ]);
    await appendRow(spreadsheetId, BOOK_SHEETS.ENTRY, [
      `JE${txId}0`, txId, 1,
      e.side, avsStoredName, avsAcct.fsName || '', e.amount, avsAcct.element || '',
    ]);
  }

  const totalEntries = allMainEntries.length + avsItems.length;  // AVS 각 1분개

  return {
    success: true,
    year,
    entriesCount: totalEntries,
  };
}

// ============================================================
//  고정자산 관리
//  시트: '고정자산' (17컬럼)
// ============================================================

/** 자산번호 자동 채번: YYYYNNNNN (예: 202500001) */
async function genAssetNo(spreadsheetId: string): Promise<string> {
  const year = String(new Date().getFullYear());
  const data = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ASSET);
  const nums = data.slice(1)
    .map(r => String(r[0] || ''))
    .filter(n => n.startsWith(year))
    .map(n => parseInt(n.slice(4)) || 0);
  const maxSeq = nums.length ? Math.max(...nums) : 0;
  return year + String(maxSeq + 1).padStart(5, '0');
}

/**
 * 고정자산 관리대장 시트에서 전체 자산 목록을 조회한다.
 * 자산번호가 비어있는 행은 제외하고, 취득일자는 safeFormatDate로 변환한다.
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @returns 고정자산 객체 배열 (assetNo, name, category, cost, acquireDate, depMethod 등)
 */
/** 고정자산 목록 조회 */
export async function getAssets(spreadsheetId: string): Promise<any[]> {
  await ensureSheet(spreadsheetId, BOOK_SHEETS.ASSET, ASSET_HEADERS);
  const data = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ASSET);
  return data.slice(1)
    .filter(r => String(r[0] || '').trim())
    .map(r => ({
      assetNo    : String(r[0]  || ''),
      name       : String(r[1]  || ''),
      category   : String(r[2]  || ''),
      model      : String(r[3]  || ''),
      qty        : Number(r[4]) || 1,
      acqMethod  : String(r[5]  || ''),
      location   : String(r[6]  || ''),
      dept       : String(r[7]  || ''),
      manager    : String(r[8]  || ''),
      note       : String(r[9]  || ''),
      acquireDate: safeFormatDate(r[10]),
      cost       : Number(r[11]) || 0,
      depMethod  : String(r[12] || '정액법'),
      usefulLife : Number(r[13]) || 5,
      salvageRate: Number(r[14]) || 0,
    }));
}

/**
 * 고정자산 관리대장에 새 자산을 등록한다.
 * 자산번호는 "연도+5자리 일련번호" 형식으로 자동 채번된다 (예: 202500001).
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param body - 자산 데이터 (name, category, model, qty, acqMethod, location,
 *               dept, manager, note, acquireDate, cost, depMethod, usefulLife, salvageRate)
 * @returns 생성된 자산번호(assetNo)와 성공 여부
 */
/** 고정자산 등록 */
export async function saveAsset(
  spreadsheetId: string,
  body: any,
): Promise<{ success: boolean; assetNo: string }> {
  await ensureSheet(spreadsheetId, BOOK_SHEETS.ASSET, ASSET_HEADERS);
  const assetNo = await genAssetNo(spreadsheetId);
  const now     = new Date().toISOString();
  await appendRow(spreadsheetId, BOOK_SHEETS.ASSET, [
    assetNo,
    body.name       || '',
    body.category   || '',
    body.model      || '',
    Number(body.qty) || 1,
    body.acqMethod  || '매입',
    body.location   || '',
    body.dept       || '',
    body.manager    || '',
    body.note       || '',
    body.acquireDate || '',
    Number(body.cost) || 0,
    body.depMethod  || '정액법',
    Number(body.usefulLife) || 5,
    Number(body.salvageRate) || 0,
    now, now,
  ]);
  return { success: true, assetNo };
}

/**
 * 고정자산 정보를 수정한다.
 * 최초 등록일시(P열)는 보존하고 수정일시(Q열)만 갱신한다.
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param body - 수정할 자산 데이터 (assetNo 필수, 나머지는 saveAsset과 동일 구조)
 * @returns 성공 여부. 자산번호를 찾지 못하면 error 반환
 */
/** 고정자산 수정 */
export async function updateAsset(
  spreadsheetId: string,
  body: any,
): Promise<{ success: boolean; error?: string }> {
  const data = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ASSET);
  const rows  = data.slice(1);
  const idx   = rows.findIndex(r => String(r[0] || '') === String(body.assetNo));
  if (idx < 0) return { success: false, error: '자산을 찾을 수 없습니다.' };

  const sheetRow  = idx + 2;   // 1-indexed + header
  const origCreated = String(rows[idx][15] || '');
  const now       = new Date().toISOString();

  await updateRow(spreadsheetId, BOOK_SHEETS.ASSET, sheetRow, [
    body.assetNo,
    body.name       || '',
    body.category   || '',
    body.model      || '',
    Number(body.qty) || 1,
    body.acqMethod  || '매입',
    body.location   || '',
    body.dept       || '',
    body.manager    || '',
    body.note       || '',
    body.acquireDate || '',
    Number(body.cost) || 0,
    body.depMethod  || '정액법',
    Number(body.usefulLife) || 5,
    Number(body.salvageRate) || 0,
    origCreated, now,
  ]);
  return { success: true };
}

/**
 * 고정자산 관리대장에서 자산 행을 삭제한다.
 * @param spreadsheetId - 대상 Google Spreadsheet ID
 * @param assetNo - 삭제할 자산번호 (예: "202500001")
 * @returns 성공 여부. 자산번호를 찾지 못하면 error 반환
 */
/** 고정자산 삭제 */
export async function deleteAsset(
  spreadsheetId: string,
  assetNo: string,
): Promise<{ success: boolean; error?: string }> {
  const data = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ASSET);
  const rows  = data.slice(1);
  const idx   = rows.findIndex(r => String(r[0] || '') === String(assetNo));
  if (idx < 0) return { success: false, error: '자산을 찾을 수 없습니다.' };
  await deleteRow(spreadsheetId, BOOK_SHEETS.ASSET, idx + 2);
  return { success: true };
}
