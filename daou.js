import { chromium } from "playwright";
import { DAOU } from "./config.js";

// 멀티유저: 로그인 아이디/비번은 직원마다 앱 설정에서 받음(요청에 포함).
// 서버엔 회사 주소(loginUrl)만 있으면 됨.
export function daouReady() {
  return !!DAOU.loginUrl;
}

// 홍보/안내 팝업 닫기 (등록 버튼 가리는 모달 제거)
async function closePopups(page, step) {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("Escape").catch(() => {});
    for (const t of ["오늘 하루 보지 않기", "오늘 하루 그만보기", "다시 보지 않기", "닫기", "확인"]) {
      await page.getByRole("button", { name: t }).first().click({ timeout: 900 }).catch(() => {});
      await page.getByText(t, { exact: true }).first().click({ timeout: 900 }).catch(() => {});
    }
    // 닫기 X (다우 레이어/다이얼로그 공통 클래스 + title/alt)
    const sels = [
      '.ui-dialog-titlebar-close', '.layer_close', '.btn_close', '.btnClose', '.ico_close',
      '.popup_close', '[class*="close"]', 'button[title="닫기"]', 'a[title="닫기"]',
      'button[aria-label="Close"]', 'img[alt="닫기"]',
    ];
    for (const s of sels) {
      await page.locator(s).first().click({ timeout: 700 }).catch(() => {});
    }
  }
  if (step) step("팝업 닫기 시도");
}

// 정규식 특수문자 이스케이프 (검색 결과 정확 매칭용)
function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// 라벨 텍스트 옆의 '검색' 버튼/링크/인풋 클릭 (유연하게)
async function clickSearchNear(frame, labelText) {
  const xp = `xpath=//*[contains(normalize-space(.),"${labelText}")]/following::*[(self::button or self::a or (self::input and (@type="button" or @type="submit" or @type="image"))) and (contains(normalize-space(.),"검색") or contains(@value,"검색"))][1]`;
  await frame.locator(xp).first().click({ timeout: 8000 });
}

// 폼이 들어있는 프레임 찾기 — 입력칸(input/select)이 가장 많은 프레임 = 폼.
// 다우 지출폼은 /applet/(또는 /doc/) iframe 안에서 내용이 async로 늦게 뜬다.
// 그래서 폼이 실제로 채워질 때까지 충분히(최대 ~24초) 기다린다.
async function getFormFrame(page, step) {
  let appletFrame = null;            // 필드는 아직 0이라도 폼 전용 iframe 후보 기억
  for (let tryN = 0; tryN < 24; tryN++) {
    let best = null, bestN = 0;
    for (const f of page.frames()) {
      const u = f.url() || "";
      let n = 0;
      try { n = await f.locator("input, select, textarea").count(); } catch { continue; }
      if (/\/applet\/|\/doc\//.test(u)) appletFrame = f;
      if (n > bestN) { bestN = n; best = f; }
    }
    // 실제 입력칸이 3개 이상 잡히면 그게 폼 — 채택
    if (best && bestN >= 3) { if (step) step(`폼 프레임 발견 (필드 ${bestN}개)`); return best; }
    await page.waitForTimeout(1000);
  }
  // 끝까지 필드가 안 채워지면, 그래도 폼 전용 iframe(applet/doc)이 있으면 그걸 사용
  if (appletFrame) { if (step) step("폼 프레임 추정(applet) 사용 — 필드 로딩 지연"); return appletFrame; }
  if (step) step("폼 프레임 못찾음 - 메인 사용");
  return page.mainFrame();
}

// 라벨/텍스트 기반 자동등록. 실제 사이트에서 한번 돌려보며 미세조정 필요.
// 에러나면 그 시점 화면 스크린샷(base64)을 함께 던져서 어디서 막혔는지 바로 보이게 함.
export async function submitToDaou(p) {
  // 저메모리 옵션 (Render 무료 512MB에서도 크롬 뜨게)
  const browser = await chromium.launch({ args: [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-gpu", "--single-process", "--no-zygote",
    "--disable-extensions", "--disable-background-networking",
  ] });
  const ctx = await browser.newContext({ acceptDownloads: false });
  // 메모리 절약: 이미지/폰트/CSS/미디어 차단 (폼 입력엔 불필요)
  await ctx.route("**/*", route => {
    const t = route.request().resourceType();
    // 큰 리소스(영상/폰트)만 차단. 이미지·CSS는 살려서 스크린샷/폼이 제대로 보이게.
    if (t === "media" || t === "font") return route.abort();
    return route.continue();
  });
  const page = await ctx.newPage();
  // 한 동작이 오래 멈춰있지 않게 (못 찾으면 빨리 실패)
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(25000);
  const log = [];
  const step = (m) => { log.push(m); console.log("[daou]", m); };

  const loginId = p.daouId || DAOU.id;
  const loginPw = p.daouPw || DAOU.pw;
  try {
    if (!loginId || !loginPw) throw new Error("다우오피스 아이디/비번이 없어요. 앱 설정에 입력하세요.");
    // 1) 로그인
    step("로그인 페이지 이동");
    await page.goto(DAOU.loginUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[type="password"]', { timeout: 15000 }).catch(() => {});
    await page.locator('input[name="id"], input#id, input#username, input[type="text"]').first().fill(loginId).catch(() => {});
    await page.locator('input[type="password"]').first().fill(loginPw).catch(() => {});
    await page.locator('button[type="submit"], button:has-text("로그인"), .login_btn, a:has-text("로그인")').first().click().catch(() => {});
    // 로그인 완료까지 대기 (비밀번호 칸이 사라질 때까지)
    await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    // 아직도 로그인 화면이면 실패 처리
    if (await page.locator('input[type="password"]').count() > 0) {
      throw new Error("다우 로그인이 안 됐어요. 설정의 아이디/비밀번호를 확인하세요.");
    }
    step("로그인 완료");

    // 2) 지출관리 앱 홈 → [등록] 클릭 → 등록 폼(doc/new) 진입
    //    ⚠ applet/22937/ 로 직접 가면 Works 홈으로 튕긴다. 반드시 /home 으로 가서 [등록]을 눌러야 폼이 뜬다.
    step("지출관리 앱 이동");
    const EXPENSE_HOME = DAOU.loginUrl.replace(/\/+$/, "") + "/gw/app/works/applet/22937/home";
    await page.goto(EXPENSE_HOME, { waitUntil: "networkidle" }).catch(() => {});
    await closePopups(page, step);
    // 좌측 상단 [등록] 버튼 (a.btn_function). '일괄 등록'·'내가 등록한 데이터'와 섞이지 않게 정확히 '등록'.
    await page.locator("a.btn_function", { hasText: /^\s*등록\s*$/ }).first().click({ timeout: 10000 })
      .catch(() => page.locator("a").filter({ hasText: /^등록$/ }).first().click({ timeout: 8000 }))
      .catch(() => step("등록 버튼 클릭 실패(수동확인)"));
    await page.waitForURL(/\/doc\/new\//, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    step("등록 화면 진입");

    // 폼은 메인 문서에 있다 (iframe 아님). 폼 로딩 확인: select 가 뜰 때까지 대기.
    const F = page.mainFrame();
    await F.waitForSelector("select", { timeout: 12000 }).catch(() => {});
    try {
      const nf = await F.locator("input, select, textarea").count();
      step(`폼 필드 ${nf}개 감지`);
    } catch {}

    // 진단: 현재 주소 + 폼 프레임에 실제 보이는 글자(에러 메시지/안내문 확인용)
    try {
      step("현재주소: " + page.url());
      const seen = await F.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300));
      step("화면문구: " + (seen || "(빈 화면)"));
    } catch {}

    // 진단: 폼 프레임의 버튼/인풋/셀렉트 목록 덤프
    try {
      const dump = await F.evaluate(() => {
        const out = [];
        document.querySelectorAll("button, a, input, select, textarea").forEach((e, i) => {
          if (i > 160) return;
          const tag = e.tagName.toLowerCase();
          const type = e.type ? `[${e.type}]` : "";
          const id = e.name || e.id || "";
          const txt = (e.value || e.innerText || e.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 22);
          if (txt || id) out.push(`${tag}${type} ${id} | ${txt}`);
        });
        return out.join("\n");
      });
      step("폼요소:\n" + dump);
    } catch {}

    // ── 폼 입력 ──
    // ※ 폼의 텍스트칸 name 은 매번 랜덤(_08cgz460d 등)이라 라벨 기준으로 잡는다.
    // ※ select 는 결산산입부서/등록유형 2개뿐이고 둘 다 name="select_option" → 옵션 내용으로 구분.

    // 3) 등록유형 (옵션 '법인카드 사용'을 가진 select)
    if (p.registerType) {
      await F.locator("select", { has: F.locator('option:text-is("법인카드 사용")') }).first()
        .selectOption({ label: p.registerType })
        .then(() => step("등록유형: " + p.registerType))
        .catch(() => step("등록유형 선택 실패(수동확인)"));
    }

    // 4) 결산산입부서 (옵션 '경영지원실'을 가진 select)
    if (p.dept) {
      await F.locator("select", { has: F.locator('option:text-is("경영지원실")') }).first()
        .selectOption({ label: p.dept })
        .then(() => step("부서: " + p.dept))
        .catch(() => step("부서 선택 실패(수동확인) — 부서명이 목록과 정확히 일치해야 함: " + p.dept));
    }

    // 5) 금액 (입력 후 자동계산 딜레이 있음)
    if (p.amount) {
      const amt = String(p.amount).replace(/[^\d]/g, "");
      await F.locator('xpath=//*[normalize-space()="금액º"]/following::input[1]').first().fill(amt)
        .then(() => step("금액: " + amt)).catch(() => step("금액 입력 실패(수동확인)"));
      await page.waitForTimeout(900);
    }

    // 6) 제목
    if (p.title) {
      await F.locator('xpath=//*[normalize-space()="제목º"]/following::input[1]').first().fill(p.title)
        .then(() => step("제목 입력")).catch(() => step("제목 입력 실패(수동확인)"));
    }

    // 7) 지출항목 — [검색] → '데이터 검색' 팝업(.layer_app_search)에서 검색 후 정확히 일치 항목 클릭
    if (p.category) {
      try {
        await F.locator('xpath=//*[normalize-space()="지출항목º"]/following::a[normalize-space()="검색"][1]').first().click({ timeout: 8000 });
        await page.waitForSelector(".layer_app_search input.txt_mini", { timeout: 8000 });
        const sbox = page.locator(".layer_app_search input.txt_mini");
        await sbox.fill(p.category);
        await sbox.press("Enter");
        await page.waitForTimeout(1300);
        await page.locator(".layer_app_search a").filter({ hasText: new RegExp("^" + escapeReg(p.category) + "$") }).first().click({ timeout: 6000 });
        step("지출항목: " + p.category);
      } catch { step("지출항목 선택 실패(수동확인)"); }
    }

    // 8) 사용카드 — [검색] → 뒷4자리 검색 후 결과 클릭
    if (p.cardLast4) {
      try {
        await F.locator('xpath=//*[normalize-space()="사용카드"]/following::a[normalize-space()="검색"][1]').first().click({ timeout: 8000 });
        await page.waitForSelector(".layer_app_search input.txt_mini", { timeout: 8000 });
        const cbox = page.locator(".layer_app_search input.txt_mini");
        await cbox.fill(p.cardLast4);
        await cbox.press("Enter");
        await page.waitForTimeout(1300);
        await page.locator(".layer_app_search a").filter({ hasText: new RegExp(escapeReg(p.cardLast4)) }).first().click({ timeout: 6000 });
        step("카드: " + p.cardLast4);
      } catch { step("카드 선택 실패(수동확인)"); }
    }

    // 9) 파일첨부 (영수증 사진) — [카드전표] 첨부 필수
    if (p.photo) {
      await F.locator('xpath=//*[normalize-space()="파일첨부"]/following::input[@type="file"][1]').first().setInputFiles({
        name: p.photo.originalname || "receipt.jpg",
        mimeType: p.photo.mimetype || "image/jpeg",
        buffer: p.photo.buffer,
      }).then(() => step("사진 첨부")).catch(() => step("파일첨부 실패(수동확인)"));
      await page.waitForTimeout(1500);
    }

    // 10) 확인 (등록 실행) — a.btn-confirm
    let confirmed = false;
    await F.locator("a.btn-confirm").first().click({ timeout: 8000 })
      .then(() => { confirmed = true; }).catch(() => step("확인 버튼 실패(수동확인)"));
    await page.waitForTimeout(1500);
    // 확인 후 2차 확인 레이어가 뜨면 처리
    await page.locator('.go_popup a.btn-confirm, .layer_normal a:has-text("확인")').first().click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(1200);
    step(confirmed ? "확인 클릭 성공" : "확인 클릭 실패");

    // 11) (옵션) 결재완료 — autoApprove=true 일 때만.
    if (p.autoApprove) {
      await F.getByRole("button", { name: /결재완료|결제완료|상신/ }).first().click({ timeout: 5000 }).catch(() => step("결재완료 실패(수동확인)"));
      step("결재완료 클릭");
    }

    const shot = (await page.screenshot()).toString("base64");
    await browser.close();
    return { ok: true, confirmed, log, screenshot: shot };
  } catch (e) {
    let shot = null;
    try { shot = (await page.screenshot()).toString("base64"); } catch {}
    await browser.close();
    const err = new Error(e.message);
    err.log = log;
    err.screenshot = shot;
    throw err;
  }
}
