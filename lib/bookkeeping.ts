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

import { getSheets, getSheetValues, appendRow, updateRow, deleteRow, bulkDeleteRows } from '@/lib/sheets';
import { getOwnerSheetId, MASTER_SHEET_NAME } from '@/lib/config';

// ── 시트명 ────────────────────────────────────────────────────
export const BOOK_SHEETS = {
  TRANSACTION : '거래',
  ENTRY       : '분개',
  ACCOUNT     : '계정과목',
} as const;

// ── 헤더 정의 ─────────────────────────────────────────────────
const TX_HEADERS      = ['거래ID','날짜','적요','거래처','부가세여부','공급대가','공급가액','부가세','등록일시','수정일시'];
const ENTRY_HEADERS   = ['분개ID','거래ID','순번','구분','계정과목','재무제표계정과목','금액','거래요소'];
const ACCOUNT_HEADERS = ['용도','분류(상)','분류(하)','계정과목(상)','계정과목(하)','계정과목(장부)','국세청계정과목','거래의요소','내용'];

// ============================================================
//  공통 유틸
// ============================================================

/** 분류(하) 접두사 제거: "(1)당좌자산" → "당좌자산" */
export function cleanFsName(v: any): string {
  return String(v || '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/^\d+[.\s]+/, '')
    .trim();
}

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

/** 날짜 안전 파싱 → yyyy-MM-dd */
export function safeFormatDate(rawVal: any): string {
  if (!rawVal && rawVal !== 0) return '';
  try {
    // Google Sheets 날짜 시리얼 숫자 처리 (USER_ENTERED로 저장된 날짜)
    // Sheets 기준점: 1899-12-30 (Excel 호환 방식)
    if (typeof rawVal === 'number' && rawVal > 1000) {
      const sheetsEpoch = Date.UTC(1899, 11, 30); // 1899-12-30 UTC
      const d = new Date(sheetsEpoch + rawVal * 86400000);
      const y   = d.getUTCFullYear();
      const m   = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    const d = rawVal instanceof Date ? rawVal : new Date(rawVal);
    if (isNaN(d.getTime())) return String(rawVal);
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
        for (let i = 1; i < masterData.length; i++) {
          const rowOwner = String(masterData[i][ownerIdx] ?? '').trim().toLowerCase();
          if (rowOwner === owner.toLowerCase()) {
            if (bizNameIdx !== -1) bizName  = String(masterData[i][bizNameIdx] ?? '').trim();
            if (bizRgIdx   !== -1) bizRegNo = String(masterData[i][bizRgIdx]   ?? '').trim();
            break;
          }
        }
      } else if (masterData.length > 1) {
        if (bizNameIdx !== -1) bizName  = String(masterData[1][bizNameIdx] ?? '').trim();
        if (bizRgIdx   !== -1) bizRegNo = String(masterData[1][bizRgIdx]   ?? '').trim();
      }
    }

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

/** 계정 맵: 계정과목(장부) → 메타정보 */
async function buildAccountMap(spreadsheetId: string): Promise<Record<string, any>> {
  const data = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ACCOUNT);
  const map: Record<string, any> = {};
  data.slice(1).forEach(r => {
    const name = String(r[5] || '').trim();
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

/** 거래 저장 */
export async function saveTransaction(
  spreadsheetId: string,
  payload: any,
): Promise<{ success: boolean; txId: string }> {
  await ensureSheet(spreadsheetId, BOOK_SHEETS.TRANSACTION, TX_HEADERS);
  await ensureSheet(spreadsheetId, BOOK_SHEETS.ENTRY, ENTRY_HEADERS);

  const now  = new Date().toISOString();
  const txId = 'TX' + String(Date.now()).slice(-8);

  await appendRow(spreadsheetId, BOOK_SHEETS.TRANSACTION, [
    txId, payload.date, payload.description,
    payload.counterpart || '', payload.vatFlag || 'X',
    Number(payload.totalAmount)  || 0,
    Number(payload.supplyAmount) || 0,
    Number(payload.vatAmount)    || 0,
    now, now,
  ]);

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
    tRows[tIdx][8],  // 등록일시 보존
    now,
  ]);

  // 기존 분개 삭제 (역순으로 — 행 번호 이동 방지)
  const eRows    = eData.slice(1);
  const toDelete = eRows
    .map((r, i) => ({ r, sheetRow: i + 2 }))
    .filter(({ r }) => r[1] === payload.txId)
    .reverse();

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
export async function getTrialBalance(spreadsheetId: string, p: any): Promise<any> {
  const txList = await getTransactions(spreadsheetId, p && p.year ? { year: p.year } : {});
  const totals: Record<string, { dr: number; cr: number }> = {};

  txList.forEach(tx => {
    tx.entries.forEach((e: any) => {
      if (!totals[e.account]) totals[e.account] = { dr: 0, cr: 0 };
      if (e.side === '차변') totals[e.account].dr += e.amount;
      else                    totals[e.account].cr += e.amount;
    });
  });

  const data    = await safeGetSheetValues(spreadsheetId, BOOK_SHEETS.ACCOUNT);
  const rows    = data.slice(1);
  const order   : string[]          = [];
  const accMap  : Record<string, any> = {};

  rows.forEach(r => {
    const jangbu      = String(r[5] || '').trim();
    const catUpperRaw = String(r[3] || '').trim();
    // D열(계정과목상)이 비어있으면 F열(계정과목장부)을 표시명으로 사용
    const catUpper    = cleanFsName(catUpperRaw) || jangbu;
    if (!catUpper) return;

    const t = jangbu ? (totals[jangbu] || { dr: 0, cr: 0 }) : { dr: 0, cr: 0 };

    if (!accMap[catUpper]) {
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
    accMap[catUpper].drTotal += t.dr;
    accMap[catUpper].crTotal += t.cr;
  });

  // ── G열(국세청계정과목) 기준 집계 — BS/IS 렌더링용 ──────────────
  // D열 집계는 하나의 row에 여러 G값이 섞여 ntsName이 첫 번째 값으로만 저장됨.
  // G열 기준으로 재집계하면 각 NTS 코드별 정확한 금액을 얻을 수 있음.
  const ntsOrder: string[] = [];
  const ntsMap: Record<string, any> = {};

  rows.forEach(r => {
    const jangbu  = String(r[5] || '').trim();
    const ntsName = String(r[6] || '').trim();
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

  const bsCats    = new Set(['유동자산','비유동자산','유동부채','비유동부채','자본']);
  const drEntries : any[] = [];
  const crEntries : any[] = [];

  Object.keys(totals).forEach(name => {
    // AVS 계정은 종목별 별도 처리 — includes로 판단
    if (name.includes(AVS_KW)) return;

    const acct   = accountMap[name] || {};
    const cat    = acct.category || '기타';
    if (!bsCats.has(cat)) return;

    const { dr, cr } = totals[name];
    const crNorm     = ['유동부채','비유동부채','자본'].includes(cat);
    const balance    = crNorm ? (cr - dr) : (dr - cr);
    if (balance === 0) return;

    if (!crNorm) {
      if (balance > 0) drEntries.push({ side: '차변', account: name, amount: balance,  acct });
      else             crEntries.push({ side: '대변', account: name, amount: -balance, acct });
    } else {
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

  // 이익잉여금 조정 — AVS 제외한 non-AVS 항목만으로 주 거래 균형 맞춤
  // (AVS 종목별 거래는 각각 이익잉여금 상대 분개로 개별 균형 처리)
  const drSumNoAvs = drEntries.reduce((s: number, e: any) => s + e.amount, 0);
  const crSumNoAvs = crEntries.reduce((s: number, e: any) => s + e.amount, 0);
  const diff       = drSumNoAvs - crSumNoAvs;

  const adjAcct = accountMap['이익잉여금'] || {};
  if (diff !== 0) {
    if (diff > 0) crEntries.push({ side: '대변', account: '이익잉여금', amount: diff,  acct: adjAcct });
    else          drEntries.push({ side: '차변', account: '이익잉여금', amount: -diff, acct: adjAcct });
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
