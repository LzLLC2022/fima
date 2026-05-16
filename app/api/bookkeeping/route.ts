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
 * CORS: book.lim.kr, book-dev.lim.kr 허용
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
} from '@/lib/bookkeeping';

// ── CORS 헤더 ─────────────────────────────────────────────────
const ALLOWED_ORIGINS = ['https://book.lim.kr', 'https://book-dev.lim.kr'];

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin' : allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function ok(data: any, req: NextRequest) {
  return NextResponse.json(data, { headers: corsHeaders(req) });
}

function err(msg: string, req: NextRequest, status = 400) {
  return NextResponse.json({ error: msg }, { status, headers: corsHeaders(req) });
}

// ── Preflight ──────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
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
      return ok(result, req);
    }

    if (!owner) return err('owner 파라미터가 필요합니다.', req);
    const spreadsheetId = resolveSpreadsheetId(owner);
    if (!spreadsheetId) return err('등록되지 않은 사용자입니다.', req, 401);

    switch (action) {
      case 'getAccounts':
        return ok(await getAccounts(spreadsheetId), req);

      case 'getTransactions':
        return ok(await getTransactions(spreadsheetId, p), req);

      case 'getTransaction':
        if (!p.txId) return err('txId 파라미터가 필요합니다.', req);
        return ok(await getTransaction(spreadsheetId, p.txId), req);

      case 'getLedger':
        return ok(await getLedgerData(spreadsheetId, p), req);

      case 'getTrialBalance':
        return ok(await getTrialBalance(spreadsheetId, p), req);

      case 'carryForward':
        return ok(await carryForward(spreadsheetId, p), req);

      // ── 진단: 거래 시트 원시 데이터 조회 (최근 N행) ──
      case 'debugTx': {
        const raw = await getSheetValues(spreadsheetId, '거래');
        const n   = Math.min(parseInt(p.n || '30'), 200);
        return ok({ totalRows: raw.length, last: raw.slice(Math.max(0, raw.length - n)) }, req);
      }

      default:
        return err('Unknown action: ' + action, req);
    }
  } catch (e: any) {
    console.error('[bookkeeping GET] action=' + action, e);
    return NextResponse.json({ error: e.message }, { status: 500, headers: corsHeaders(req) });
  }
}

// ── POST 핸들러 ────────────────────────────────────────────────
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
        return ok(await saveTransaction(spreadsheetId, body), req);

      case 'updateTransaction':
        return ok(await updateTransaction(spreadsheetId, body), req);

      case 'deleteTransaction':
        if (!body.txId) return err('txId가 필요합니다.', req);
        return ok(await deleteTransaction(spreadsheetId, body.txId), req);

      case 'addAccount':
        return ok(await addAccount(spreadsheetId, body), req);

      case 'generateLedger':
        // 시트 쓰기 없이 JSON 반환 (getLedger와 동일)
        return ok(await getLedgerData(spreadsheetId, body), req);

      default:
        return err('Unknown action: ' + action, req);
    }
  } catch (e: any) {
    console.error('[bookkeeping POST] action=' + action, e);
    return NextResponse.json({ error: e.message }, { status: 500, headers: corsHeaders(req) });
  }
}
