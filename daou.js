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
    if (t === "image" || t === "media" || t === "font" || t === "stylesheet") return route.abort();
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

    // 2) Works > 지출관리 > 등록
    // (메뉴 경로가 길어 직접 URL 진입이 가능하면 그게 안정적. 우선 검색/메뉴로 시도)
    step("지출관리 이동 시도");
    const isForm = /\/doc\/new\//.test(DAOU.expenseUrl);
    if (DAOU.expenseUrl) {
      // 주소로 바로 진입 (홍보팝업/메뉴 회피)
      await page.goto(DAOU.expenseUrl, { waitUntil: "networkidle" }).catch(() => {});
      await closePopups(page, step);
      if (isForm) step("등록 폼 직접 진입");
    } else {
      await page.goto(DAOU.loginUrl.replace(/\/$/, "") + "/app/works", { waitUntil: "networkidle" }).catch(() => {});
      await closePopups(page, step);
      await page.getByText("지출관리", { exact: false }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await closePopups(page, step);
    }
    // 폼 직접진입(/doc/new)이 아니면 좌측 상단 [등록] 버튼 클릭
    if (!isForm) {
      await page.getByRole("button", { name: "등록" }).first().click({ timeout: 8000 })
        .catch(async () => { await page.getByText("등록", { exact: true }).first().click({ timeout: 8000 }); });
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(2500);
    step("등록 화면 진입");

    // 진단: 모든 프레임 목록 + 각 프레임 필드 수
    try {
      const fi = [];
      for (const f of page.frames()) {
        try {
          const n = await f.locator("input, select, textarea").count();
          fi.push(`frame f=${n} | ${(f.url() || "").slice(0, 55)}`);
        } catch (e) { fi.push(`frame X(접근불가) | ${(f.url() || "").slice(0, 45)}`); }
      }
      step("프레임목록:\n" + fi.join("\n"));
    } catch {}

    // 폼이 들어있는 iframe 찾기 (폼은 보통 iframe 안)
    const F = await getFormFrame(page, step);

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

    // 3) 등록유형
    if (p.registerType) {
      await F.getByText(/등록\s*유형/).locator("xpath=following::select[1]")
        .selectOption({ label: p.registerType }).catch(() => step("등록유형 선택 실패(수동확인)"));
    }

    // 4) 파일첨부 (영수증 사진)
    if (p.photo) {
      await F.locator('input[type="file"]').first().setInputFiles({
        name: p.photo.originalname || "receipt.jpg",
        mimeType: p.photo.mimetype || "image/jpeg",
        buffer: p.photo.buffer,
      }).then(() => step("사진 첨부")).catch(() => step("파일첨부 실패(수동확인)"));
    }

    // 5) 결산산입부서
    if (p.dept) {
      await F.getByText("결산산입부서").locator("xpath=following::select[1]")
        .selectOption({ label: p.dept }).catch(() => step("부서 선택 실패(수동확인)"));
    }

    // 6) 금액
    if (p.amount) {
      await F.getByText("금액").locator("xpath=following::input[1]").fill(String(p.amount))
        .then(() => step("금액 입력: " + p.amount)).catch(() => step("금액 입력 실패(수동확인)"));
    }

    // 7) 지출항목 검색 -> 데이터검색 창에서 선택
    if (p.category) {
      await clickSearchNear(F, "지출항목")
        .catch(() => F.getByRole("button", { name: "검색" }).first().click().catch(() => {}));
      await page.waitForTimeout(1000);
      await F.getByRole("textbox").last().fill(p.category).catch(() => {});
      await F.getByRole("button", { name: "검색" }).last().click().catch(() => {});
      await page.waitForTimeout(1000);
      await F.getByText(p.category, { exact: true }).first().click()
        .catch(() => F.getByRole("row", { name: new RegExp(p.category) }).first().click().catch(() => step("지출항목 선택 실패(수동확인)")));
      step("지출항목 선택: " + p.category);
    }

    // 8) 제목
    if (p.title) {
      await F.getByText("제목", { exact: false }).locator("xpath=following::input[1]").fill(p.title)
        .then(() => step("제목 입력")).catch(() => step("제목 입력 실패(수동확인)"));
    }

    // 9) 등록부서의 부서장 추가
    if (p.managerName) {
      await F.getByText("등록부서의 부서장").locator("xpath=following::*[contains(text(),'추가')][1]").click().catch(() => {});
      await page.waitForTimeout(700);
      await F.getByRole("textbox").last().fill(p.managerName).catch(() => {});
      await page.waitForTimeout(900);
      await F.getByText(p.managerName, { exact: false }).first().click().catch(() => step("부서장 선택 실패(수동확인)"));
    }

    // 10) 사용카드 검색 -> 데이터검색에서 뒷번호로 선택
    if (p.cardLast4) {
      await clickSearchNear(F, "사용카드").catch(() => {});
      await page.waitForTimeout(1000);
      await F.getByRole("textbox").last().fill(p.cardLast4).catch(() => {});
      await F.getByRole("button", { name: "검색" }).last().click().catch(() => {});
      await page.waitForTimeout(1000);
      await F.getByText(p.cardLast4, { exact: false }).first().click().catch(() => step("카드 선택 실패(수동확인)"));
      step("카드 선택: " + p.cardLast4);
    }

    // 11) 확인
    let confirmed = false;
    await F.getByRole("button", { name: "확인" }).first().click()
      .then(() => { confirmed = true; }).catch(() => step("확인 버튼 실패(수동확인)"));
    await page.waitForTimeout(1500);
    step(confirmed ? "확인 클릭 성공" : "확인 클릭 실패");

    // 12) (옵션) 결재완료 — autoApprove=true 일 때만.
    if (p.autoApprove) {
      await F.getByRole("button", { name: /결재완료|결제완료/ }).first().click().catch(() => step("결재완료 실패(수동확인)"));
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
