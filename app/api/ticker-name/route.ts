import { NextRequest, NextResponse } from 'next/server';
import { getStockInfo } from '@/lib/stock';

export async function POST(req: NextRequest) {
  try {
    const { ticker } = await req.json();
    const name = await getStockInfo(ticker, 'name');
    return NextResponse.json({ success: true, name: name || '' });
  } catch (e: any) {
    return NextResponse.json({ success: false, name: '', error: e.message });
  }
}
