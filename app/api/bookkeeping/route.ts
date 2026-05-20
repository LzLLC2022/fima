/**
 * ============================================================
 * /api/bookkeeping — 복식장부 통합 API 엔드포인트
 *
 * 이 파일은 복식부기 웹앱(book.lim.kr)의 모든 데이터 요청을
 * 한 곳에서 처리하는 서버 함수입니다.
 * 브라우저 → 이 파일 → Google Sheets 순서로 데이터가 흐릅니다.
 *
 * ── 사용 방법 ──────────────────────────────────────────────
 * GET  요청: URL에 ?action=xxx&owner=Lz 형태로 파라미터 전달
 *   예시) /api/bookkeeping?action=getAccounts&owner=Lz
 *
 * POST 요청: 요청 본문(JSON)에 action, owner 등 포함
 *   예시) { "action": "saveTransaction", "owner": "Lz", ... }
 *
 * ── GET 액션 목록 ──────────────────────────────────────────
 *   login           — owner(사용자 ID) + pin(비밀번호) 검증
 *                     성공 시 { ok: true }, 실패 시 오류 반환
 *   getAccounts     — 해당 사용자의 계정과목 전체 목록 반환
 *                     (자산/부채/자본/수익/비용 분류 포함)
 *   getTransactions — 거래 목록 반환 (year·month·keyword 필터 가능)
 *                     예: ?action=getTransactions&owner=Lz&year=2025&month=5
 *   getTransaction  — 특정 거래 1건 조회 (txId 필수)
 *                     예: ?action=getTransaction&owner=Lz&txId=TX-001
 *   getLedger       — 총계정원장 데이터 반환
 *                     계정별로 차변/대변 내역이 시간순 정렬
 *   getTrialBalance — 합계잔액시산표 반환
 *                     모든 계정의 합계·잔액을 한눈에 확인
 *   carryForward    — 전기이월 실행
 *                     전 기간 잔액을 새 기간 첫 행에 이월
 *   getAssets       — 자산(비품·차량 등) 목록 반환
 *
 * ── POST 액션 목록 ─────────────────────────────────────────
 *   login             — owner + pin 검증 (GET login과 동일)
 *   saveTransaction   — 새 거래 저장 (차변·대변 분개 포함)
 *   updateTransaction — 기존 거래 수정 (txId로 해당 행 찾아서 덮어씀)
 *   deleteTransaction — 거래 삭제 (body.txId 필수)
 *   addAccount        — 새 계정과목 추가
 *   generateLedger    — 총계정원장 JSON 반환 (getLedger와 동일, 시트 쓰기 없음)
 *   saveAsset         — 새 자산 저장
 *   updateAsset       — 기존 자산 수정
 *   deleteAsset       — 자산 삭제 (body.assetNo 필수)
 *
 * ── CORS 허용 출처 ─────────────────────────────────────────
 *   book.lim.kr (운영), book-dev.lim.kr (개발) 두 도메인만 허용
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOwnerSheetId } from '@/lib/config';
import { getSheetValues } from '@/lib/sheets';
import {
  loginUser,
  getAccounts,
  addAccount,
  saveTransaction,
  getTransaction,
  getTransactions,
  updateTransaction,
  deleteTransaction,
  getLedgerData,
  getTrialBalance,
  carryForward,
  getAssets,
  saveAsset,
  updateAsset,
  deleteAsset,
} from '@/lib/bookkeeping';

// ── CORS 헤더 ─────────────────────────────────────────────────
const ALLOWED_ORIGINS = ['https://book.lim.kr', 'https://book-dev.lim.kr'];

// corsHeaders: 요청 출처(origin)가 허용 목록에 있으면 해당 도메인을,
//              없으면 기본값(book.lim.kr)을 CORS 허용 헤더로 반환합니다.
function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin' : allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ok: 처리 성공 시 JSON 데이터를 200 응답으로 반환하는 헬퍼 함수입니다.
function ok(data: any, req: NextRequest) {
  return NextResponse.json(data, { headers: corsHeaders(req) });
}

// err: 처리 실패 시 오류 메시지와 상태 코드를 JSON 응답으로 반환하는 헬퍼 함수입니다.
//      status 기본값은 400 (잘못된 요청), 인증 실패 시 401로 호출합니다.
function err(msg: string, req: NextRequest, status = 400) {
  return NextResponse.json({ error: msg }, { status, headers: corsHeaders(req) });
}

// ── Preflight ──────────────────────────────────────────────────
// OPTIONS: 브라우저가 실제 요청 전에 보내는 사전 확인(Preflight) 요청을 처리합니다.
//          204(내용 없음) 응답과 CORS 헤더를 반환하여 본 요청을 허용합니다.
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// ── 공통: owner → spreadsheetId 조회 ──────────────────────────
// resolveSpreadsheetId: 사용자 ID(owner)로 연결된 Google 스프레드시트 ID를 찾습니다.
//                       config 설정에 등록되지 않은 사용자는 null을 반환합니다.
function resolveSpreadsheetId(owner: string): string | null {
  try {
    return getOwnerSheetId(owner);
  } catch {
    return null;
  }
}

// ── GET 핸들러 ─────────────────────────────────────────────────
// GET: URL 쿼리 파라미터(?action=xxx&owner=Lz&...)를 읽어 해당 액션을 실행합니다.
//      조회 전용 요청에 사용합니다 (데이터를 변경하지 않는 경우).
export async function GET(req: NextRequest) {
  const p      = Object.fromEntries(req.nextUrl.searchParams.entries());
  const action = p.action || '';
  const owner  = String(p.owner || '').trim();

  try {
    // login은 spreadsheetId 없이 처리
    if (action === 'login') {
      const result = await loginUser(owner, p.pin || '');
      return ok(result, req);
    }

    if (!owner) return err('owner 파라미터가 필요합니다.', req);
    const spreadsheetId = resolveSpreadsheetId(owner);
    if (!spreadsheetId) return err('등록되지 않은 사용자입니다.', req, 401);

    switch (action) {
      case 'getAccounts':
        // 해당 사용자의 계정과목 시트 전체를 읽어 반환합니다
        return ok(await getAccounts(spreadsheetId), req);

      case 'getTransactions':
        // year, month, keyword 쿼리 파라미터로 거래 목록을 필터링해 반환합니다
        return ok(await getTransactions(spreadsheetId, p), req);

      case 'getTransaction':
        // txId에 해당하는 거래 1건의 상세 정보를 반환합니다
        if (!p.txId) return err('txId 파라미터가 필요합니다.', req);
        return ok(await getTransaction(spreadsheetId, p.txId), req);

      case 'getLedger':
        // 계정별 차변·대변 전체 내역(총계정원장)을 시간순으로 반환합니다
        return ok(await getLedgerData(spreadsheetId, p), req);

      case 'getTrialBalance':
        // 모든 계정의 합계와 잔액을 표 형태(합계잔액시산표)로 반환합니다
        return ok(await getTrialBalance(spreadsheetId, p), req);

      case 'carryForward':
        // 이전 기간 잔액을 새 기간 첫 번째 행에 이월 처리합니다
        return ok(await carryForward(spreadsheetId, p), req);

      case 'getAssets':
        // 비품·차량 등 고정자산 목록 전체를 반환합니다
        return ok(await getAssets(spreadsheetId), req);

      // ── 진단: 거래 시트 원시 데이터 조회 (최근 N행) ──
      case 'debugTx': {
        // 개발·디버그용: 거래 시트 원시 데이터를 최근 N행(기본 30, 최대 200) 반환합니다
        const raw = await getSheetValues(spreadsheetId, '거래');
        const n   = Math.min(parseInt(p.n || '30'), 200);
        return ok({ totalRows: raw.length, last: raw.slice(Math.max(0, raw.length - n)) }, req);
      }

      // ── 새 GET 액션 추가 방법 ────────────────────────────────
      // 아래 패턴을 복사해서 case 블록을 추가하세요.
      //
      // case 'myNewAction':
      //   // 1. 필요한 파라미터를 p.xxx 형태로 꺼냅니다
      //   // 2. lib/bookkeeping.ts 에 구현된 함수를 호출합니다
      //   // 3. ok(결과, req) 로 반환합니다
      //   return ok(await myNewFunction(spreadsheetId, p), req);
      //
      // ※ lib/bookkeeping.ts 에 함수 구현 → 이 파일 상단 import 추가 → case 추가
      //    세 곳을 함께 수정해야 합니다.
      // ─────────────────────────────────────────────────────────

      default:
        return err('Unknown action: ' + action, req);
    }
  } catch (e: any) {
    console.error('[bookkeeping GET] action=' + action, e);
    return NextResponse.json({ error: e.message }, { status: 500, headers: corsHeaders(req) });
  }
}

// ── POST 핸들러 ────────────────────────────────────────────────
// POST: 요청 본문(JSON)의 action 값에 따라 데이터를 저장·수정·삭제합니다.
//       데이터를 변경하는 모든 요청(쓰기)에 사용합니다.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return err('요청 본문이 올바르지 않습니다.', req);
  }

  const action = String(body.action || '');
  const owner  = String(body.owner  || '').trim();

  try {
    // login은 spreadsheetId 없이 처리
    if (action === 'login') {
      const result = await loginUser(owner, body.pin || '');
      return ok(result, req);
    }

    if (!owner) return err('owner 파라미터가 필요합니다.', req);
    const spreadsheetId = resolveSpreadsheetId(owner);
    if (!spreadsheetId) return err('등록되지 않은 사용자입니다.', req, 401);

    switch (action) {
      case 'saveTransaction':
        // 새 거래(분개)를 거래 시트 마지막 행에 추가합니다
        return ok(await saveTransaction(spreadsheetId, body), req);

      case 'updateTransaction':
        // txId로 기존 거래를 찾아 body의 내용으로 수정합니다
        return ok(await updateTransaction(spreadsheetId, body), req);

      case 'deleteTransaction':
        // txId에 해당하는 거래 행을 시트에서 삭제합니다
        if (!body.txId) return err('txId가 필요합니다.', req);
        return ok(await deleteTransaction(spreadsheetId, body.txId), req);

      case 'addAccount':
        // 계정과목 시트에 새 계정(코드·이름·분류 등)을 추가합니다
        return ok(await addAccount(spreadsheetId, body), req);

      case 'generateLedger':
        // 시트 쓰기 없이 JSON 반환 (getLedger와 동일)
        // 총계정원장 데이터를 JSON으로만 반환합니다 (시트에 기록하지 않음)
        return ok(await getLedgerData(spreadsheetId, body), req);

      case 'saveAsset':
        // 새 자산(비품·차량 등)을 자산 시트에 추가합니다
        return ok(await saveAsset(spreadsheetId, body), req);

      case 'updateAsset':
        // assetNo로 기존 자산을 찾아 body의 내용으로 수정합니다
        return ok(await updateAsset(spreadsheetId, body), req);

      case 'deleteAsset':
        // assetNo에 해당하는 자산 행을 시트에서 삭제합니다
        if (!body.assetNo) return err('assetNo가 필요합니다.', req);
        return ok(await deleteAsset(spreadsheetId, body.assetNo), req);

      // ── 새 POST 액션 추가 방법 ───────────────────────────────
      // 아래 패턴을 복사해서 case 블록을 추가하세요.
      //
      // case 'myNewAction':
      //   // 1. body.xxx 로 필요한 값을 꺼냅니다
      //   // 2. 필수 파라미터가 빠졌으면 err() 로 즉시 반환합니다
      //   //    예: if (!body.someId) return err('someId가 필요합니다.', req);
      //   // 3. lib/bookkeeping.ts 에 구현된 함수를 호출합니다
      //   // 4. ok(결과, req) 로 반환합니다
      //   return ok(await myNewFunction(spreadsheetId, body), req);
      //
      // ※ lib/bookkeeping.ts 에 함수 구현 → 이 파일 상단 import 추가 → case 추가
      //    세 곳을 함께 수정해야 합니다.
      // ─────────────────────────────────────────────────────────

      default:
        return err('Unknown action: ' + action, req);
    }
  } catch (e: any) {
    console.error('[bookkeeping POST] action=' + action, e);
    return NextResponse.json({ error: e.message }, { status: 500, headers: corsHeaders(req) });
  }
}
