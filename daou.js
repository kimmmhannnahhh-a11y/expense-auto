import { chromium } from "playwright";
import { DAOU } from "./config.js";

// 멀티유저: 로그인 아이디/비번은 직원마다 앱 설정에서 받음(요청에 포함).
// 서버엔 회사 주소(loginUrl)만 있으면 됨.
export function daouReady() {
  return !!DAOU.loginUrl;
}

// 홍보/안내 팝업 닫기 (등록 버튼 가리는 모달 제거)
async function closePopups(page, step) {
  await page.keyboard.press("Escape").catch(() => {});
  for (const t of ["오늘 하루 보지 않기", "오늘 하루 그만보기", "닫기"]) {
    await page.getByRole("button", { name: t }).first().click({ timeout: 1200 }).catch(() => {});
  }
  await page.locator('.modal .close, [class*="layer"] [class*="close"], button[title="닫기"], button[aria-label="Close"], [class*="popup"] [class*="close"]')
    .first().click({ timeout: 1200 }).catch(() => {});
  if (step) step("팝업 닫기 시도");
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
  const page = await ctx.newPage();
  const log = [];
  const step = (m) => { log.push(m); console.log("[daou]", m); };

  const loginId = p.daouId || DAOU.id;
  const loginPw = p.daouPw || DAOU.pw;
  try {
    if (!loginId || !loginPw) throw new Error("다우오피스 아이디/비번이 없어요. 앱 설정에 입력하세요.");
    // 1) 로그인
    step("로그인 페이지 이동");
    await page.goto(DAOU.loginUrl, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="id"], input[type="text"], #username, #id', loginId).catch(() => {});
    await page.fill('input[name="password"], input[type="password"], #password', loginPw);
    await page.click('button[type="submit"], .login_btn, button:has-text("로그인")');
    await page.waitForLoadState("networkidle");
    step("로그인 완료");

    // 2) Works > 지출관리 > 등록
    // (메뉴 경로가 길어 직접 URL 진입이 가능하면 그게 안정적. 우선 검색/메뉴로 시도)
    step("지출관리 이동 시도");
    await page.goto(DAOU.loginUrl.replace(/\/$/, "") + "/app/works", { waitUntil: "networkidle" }).catch(() => {});
    await closePopups(page, step);
    await page.getByText("지출관리", { exact: false }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await closePopups(page, step);
    await page.getByRole("button", { name: "등록" }).first().click({ timeout: 8000 })
      .catch(async () => { await page.getByText("등록", { exact: true }).first().click(); });
    await page.waitForTimeout(2000);
    step("등록 화면 진입");

    // 3) 등록유형 = 법인카드 사용 (먼저 선택)
    if (p.registerType) {
      await page.getByText("등록 유형").locator("xpath=following::select[1]")
        .selectOption({ label: p.registerType }).catch(() => step("등록유형 선택 실패(수동확인)"));
    }

    // 4) 파일첨부 (영수증 사진)
    if (p.photo) {
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles({
        name: p.photo.originalname || "receipt.jpg",
        mimeType: p.photo.mimetype || "image/jpeg",
        buffer: p.photo.buffer,
      }).catch(() => step("파일첨부 실패(수동확인)"));
      step("사진 첨부");
    }

    // 5) 결산산입부서
    if (p.dept) {
      await page.getByText("결산산입부서").locator("xpath=following::select[1]")
        .selectOption({ label: p.dept }).catch(() => step("부서 선택 실패(수동확인)"));
    }

    // 6) 금액
    if (p.amount) {
      await page.getByText("금액").locator("xpath=following::input[1]").fill(String(p.amount))
        .catch(() => step("금액 입력 실패(수동확인)"));
    }

    // 7) 지출항목 검색 -> 데이터검색 창에서 선택
    if (p.category) {
      await page.getByText("지출항목").locator("xpath=following::button[contains(.,'검색')][1]").click()
        .catch(() => page.getByRole("button", { name: "검색" }).first().click());
      await page.waitForTimeout(800);
      const dlg = page.getByText("데이터 검색").locator("xpath=ancestor::*[self::div][1]");
      await dlg.getByRole("textbox").first().fill(p.category).catch(() => {});
      await dlg.getByRole("button", { name: "검색" }).click().catch(() => {});
      await page.waitForTimeout(800);
      await page.getByRole("row", { name: new RegExp(p.category) }).first().click()
        .catch(() => page.getByText(p.category, { exact: true }).first().click());
      step("지출항목 선택: " + p.category);
    }

    // 8) 제목
    if (p.title) {
      await page.getByText("제목", { exact: false }).locator("xpath=following::input[1]").fill(p.title)
        .catch(() => step("제목 입력 실패(수동확인)"));
    }

    // 9) 등록부서의 부서장 추가
    if (p.managerName) {
      await page.getByText("등록부서의 부서장").locator("xpath=following::*[contains(text(),'추가')][1]").click()
        .catch(() => {});
      await page.waitForTimeout(600);
      await page.getByRole("textbox").last().fill(p.managerName).catch(() => {});
      await page.waitForTimeout(800);
      await page.getByText(p.managerName, { exact: false }).first().click().catch(() => step("부서장 선택 실패(수동확인)"));
    }

    // 10) 사용카드 검색 -> 데이터검색에서 뒷번호로 선택
    if (p.cardLast4) {
      await page.getByText("사용카드").locator("xpath=following::button[contains(.,'검색')][1]").click().catch(() => {});
      await page.waitForTimeout(800);
      await page.getByRole("textbox").last().fill(p.cardLast4).catch(() => {});
      await page.getByRole("button", { name: "검색" }).last().click().catch(() => {});
      await page.waitForTimeout(800);
      await page.getByText(p.cardLast4, { exact: false }).first().click().catch(() => step("카드 선택 실패(수동확인)"));
      step("카드 선택: " + p.cardLast4);
    }

    // 11) 확인
    await page.getByRole("button", { name: "확인" }).first().click().catch(() => step("확인 버튼 실패(수동확인)"));
    await page.waitForTimeout(1500);
    step("확인 클릭");

    // 12) (옵션) 결재완료 — 위험하니 기본은 멈춤. autoApprove=true 일 때만.
    if (p.autoApprove) {
      await page.getByRole("button", { name: /결재완료|결제완료/ }).first().click().catch(() => step("결재완료 실패(수동확인)"));
      step("결재완료 클릭");
    }

    const shot = (await page.screenshot()).toString("base64");
    await browser.close();
    return { ok: true, log, screenshot: shot };
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
