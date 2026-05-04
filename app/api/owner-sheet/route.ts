import { NextRequest, NextResponse } from "next/server";
import { getOwnerSheetId } from "@/lib/config";

// GET /api/owner-sheet?owner=Lz
// budget.lim.kr 에서 owner별 spreadsheet ID 조회용
export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner") ?? "";
  if (!owner)
    return NextResponse.json({ error: "owner required" }, { status: 400 });
  try {
    const sheetId = getOwnerSheetId(owner);
    return NextResponse.json({ sheetId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 404 });
  }
}
