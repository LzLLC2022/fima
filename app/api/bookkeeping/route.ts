/**
 * ============================================================
 * /api/bookkeeping — 복식장부 통합 API 엔드포인트
 *
 * GET  /api/bookkeeping?action=xxx&owner=Lz&...
 * POST /api/bookkeeping  body: { action, owner, ... }
 *
 * Actions (GET):
 *   login          — owner + pin 검증
 *   getAccounts    — 계정과목 목록
 *   getTransactions — 거래 목록 (year, month, keyword 필터)
 *   getTransaction  — 단일 거래 조회 (txId)
 *   getLedger       — 총계정원장 데이터
 *   getTrialBalance — 합계잔액시산표
 *   carryForward    — 전기이월 실행
 *
 * Actions (POST):
 *   login             — owner + pin 검증 (GET과 동일)
 *   saveTransaction   — 거래 저장
 *   updateTransaction — 거래 수정
 *   deleteTransaction — 거래 삭제 (body.txId)
 *   addAccount        — 계정과목 추가
 *   generateLedger    — 총계정원장 JSON 반환 (= getLedger)
 *
 * CORS: book.lim.kr 허용
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOwnerSheetId } from '@/lib/config';
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
} from '@/lib/bookkeeping';

// ── CORS 헤더 ─────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin' : 'https://book.lim.kr',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ok(data: any) {
  return NextResponse.json(data, { headers: CORS });
}

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status, headers: CORS });
}

// ── Preflight ──────────────────────────────────────────────────
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// ── 공통: owner → spreadsheetId 조회 ──────────────────────────
function resolveSpreadsheetId(owner: string): string | null {
  try {
    return getOwnerSheetId(owner);
  } catch {
    return null;
  }
}

// ── GET 핸들러 ─────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const p      = Object.fromEntries(req.nextUrl.searchParams.entries());
  const action = p.action || '';
  const owner  = String(p.owner || '').trim();

  try {
    // login은 spreadsheetId 없이 처리
    if (action === 'login') {
      const result = await loginUser(owner, p.pin || '');
      return ok(result);
    }

    if (!owner) return err('owner 파라미터가 필요합니다.');
    const spreadsheetId = resolveSpreadsheetId(owner);
    if (!spreadsheetId) return err('등록되지 않은 사용자입니다.', 401);

    switch (action) {
      case 'getAccounts':
        return ok(await getAccounts(spreadsheetId));

      case 'getTransactions':
        return ok(await getTransactions(spreadsheetId, p));

      case 'getTransaction':
        if (!p.txId) return err('txId 파라미터가 필요합니다.');
        return ok(await getTransaction(spreadsheetId, p.txId));

      case 'getLedger':
        return ok(await getLedgerData(spreadsheetId, p));

      case 'getTrialBalance':
        return ok(await getTrialBalance(spreadsheetId, p));

      case 'carryForward':
        return ok(await carryForward(spreadsheetId, p));

      default:
        return err('Unknown action: ' + action);
    }
  } catch (e: any) {
    console.error('[bookkeeping GET] action=' + action, e);
    return NextResponse.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

// ── POST 핸들러 ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return err('요청 본문이 올바르지 않습니다.');
  }

  const action = String(body.action || '');
  const owner  = String(body.owner  || '').trim();

  try {
    // login은 spreadsheetId 없이 처리
    if (action === 'login') {
      const result = await loginUser(owner, body.pin || '');
      return ok(result);
    }

    if (!owner) return err('owner 파라미터가 필요합니다.');
    const spreadsheetId = resolveSpreadsheetId(owner);
    if (!spreadsheetId) return err('등록되지 않은 사용자입니다.', 401);

    switch (action) {
      case 'saveTransaction':
        return ok(await saveTransaction(spreadsheetId, body));

      case 'updateTransaction':
        return ok(await updateTransaction(spreadsheetId, body));

      case 'deleteTransaction':
        if (!body.txId) return err('txId가 필요합니다.');
        return ok(await deleteTransaction(spreadsheetId, body.txId));

      case 'addAccount':
        return ok(await addAccount(spreadsheetId, body));

      case 'generateLedger':
        // 시트 쓰기 없이 JSON 반환 (getLedger와 동일)
        return ok(await getLedgerData(spreadsheetId, body));

      default:
        return err('Unknown action: ' + action);
    }
  } catch (e: any) {
    console.error('[bookkeeping POST] action=' + action, e);
    return NextResponse.json({ error: e.message }, { status: 500, headers: CORS });
  }
}
