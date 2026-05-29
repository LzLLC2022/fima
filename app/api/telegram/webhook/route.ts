import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/telegram/webhook
 *
 * 텔레그램 봇 Webhook 엔드포인트.
 * 사용자가 봇과 1:1 대화에서 /start 또는 /myid 를 입력하면, 봇이 본인 chat_id 를 자동으로 안내한다.
 * (도움말의 "텔레그램 ID 확인 방법" 흐름과 연결)
 *
 * 설정 방법 (관리자 1회):
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -d "url=https://fima.lim.kr/api/telegram/webhook" \
 *     -d "secret_token=<RANDOM_STRING_OPTIONAL>"
 *
 * 보안:
 *   - 환경변수 TELEGRAM_WEBHOOK_SECRET 가 설정되어 있으면 X-Telegram-Bot-Api-Secret-Token 헤더 검증.
 *   - 미설정이면 모든 POST 를 허용. (텔레그램만이 봇 토큰을 알기 때문에 토큰 자체가 일종의 secret이지만,
 *     URL 이 알려지면 누구나 webhook 을 호출할 수 있으므로 secret_token 사용 권장)
 */

const TG_API = 'https://api.telegram.org';

export async function POST(req: NextRequest) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) {
    // 토큰 미설정 — 텔레그램에 200 응답해야 webhook 등록이 풀리지 않음
    return NextResponse.json({ ok: true, skipped: 'TELEGRAM_BOT_TOKEN missing' });
  }

  // (선택) webhook secret 검증
  const expectedSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();
  if (expectedSecret) {
    const got = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
    if (got !== expectedSecret) {
      return NextResponse.json({ ok: false, error: 'invalid secret' }, { status: 401 });
    }
  }

  const update = await req.json().catch(() => ({} as any));
  const msg    = update?.message;
  const chatId = msg?.chat?.id;
  const text   = String(msg?.text ?? '').trim();
  if (!chatId) {
    // message 가 아닌 update (edited_message, callback_query 등) 는 무시
    return NextResponse.json({ ok: true });
  }

  // /start / /myid / /id → 본인 chat_id 안내
  // /start@botname 형태도 인식 (group chat 호환)
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  if (cmd === '/start' || cmd === '/myid' || cmd === '/id') {
    const name = String(msg?.from?.first_name ?? '').trim();
    const greeting = name ? `${name}님, 안녕하세요!` : '안녕하세요!';
    const reply = [
      greeting,
      '',
      '당신의 텔레그램 ID 입니다:',
      `<b><code>${chatId}</code></b>`,
      '',
      'fima 앱에서 <b>⚙️ 정보 변경 → 📨 관심종목 알람(텔레그램)</b> 의',
      '<b>텔레그램 ID</b> 칸에 위 숫자를 입력하시면 관심종목 변동 알림을 받으실 수 있습니다.',
    ].join('\n');

    await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:    chatId,
        text:       reply,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    }).catch(() => { /* 응답 실패는 텔레그램이 재시도 */ });
  }

  // 그 외 메시지는 무시 (간단한 안내가 필요하면 여기서 응답)
  return NextResponse.json({ ok: true });
}

/** GET 은 디버그용 — 200 OK만 응답하여 webhook URL 동작 확인 */
export async function GET() {
  return NextResponse.json({ ok: true, hint: 'Telegram webhook endpoint. Use POST.' });
}

/**
 * PUT /api/telegram/webhook
 *
 * 운영 환경변수 TELEGRAM_BOT_TOKEN 으로 텔레그램 setWebhook 을 호출하는 setup 엔드포인트.
 * 인증: Authorization: Bearer <REPORT_SECRET>
 *
 * Body (모두 optional):
 *   { url?: string, secret_token?: string }
 *     - url:          기본 https://fima.lim.kr/api/telegram/webhook
 *     - secret_token: 명시되면 그 값으로 등록. 빈 문자열이면 환경변수 TELEGRAM_WEBHOOK_SECRET 사용.
 *       그것도 빈 값이면 secret 미사용으로 등록.
 *
 * 이 라우트는 setup용 — webhook 등록 후 일상적으로 호출할 일 없음. 인증된 호출만 허용.
 */
export async function PUT(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const got  = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const expected = String(process.env.REPORT_SECRET ?? '').trim();
  if (!expected || got !== expected) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!botToken) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN missing' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({} as any));
  const url  = String(body?.url ?? '').trim() || 'https://fima.lim.kr/api/telegram/webhook';
  // secret_token: body 값이 있으면 그것 / 없으면 환경변수 / 둘 다 없으면 미사용
  let secretToken = String(body?.secret_token ?? '').trim();
  if (!secretToken) secretToken = String(process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();

  const params: any = { url };
  if (secretToken) params.secret_token = secretToken;

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(params),
    });
    const tgJson = await tgRes.json().catch(() => ({}));

    // getWebhookInfo 도 같이 호출해서 등록 상태 반환
    const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`).catch(() => null);
    const infoJson = infoRes ? await infoRes.json().catch(() => ({})) : null;

    return NextResponse.json({
      ok:           tgRes.ok && tgJson?.ok === true,
      setWebhook:   tgJson,
      webhookInfo:  infoJson?.result ?? infoJson ?? null,
      secretUsed:   !!secretToken,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'fetch failed' }, { status: 500 });
  }
}
