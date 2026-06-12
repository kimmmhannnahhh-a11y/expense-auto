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

// 다우 '데이터 검색' 팝업(.layer_app_search)에서 검색→결과 선택.
// ⚠ 검색은 '실제 키입력'에만 반응한다. fill()로 값만 넣으면 검색이 안 돈다 → pressSequentially 사용.
async function pickFromSearch(page, F, openLinkXpath, query, matchRe) {
  const DBG = process.env.DEBUG_SEARCH === "1";
  // 1) [검색] 링크 클릭 (보이는 것 우선, 가려져 있으면 JS클릭으로 우회)
  const all = F.locator("xpath=" + openLinkXpath);
  const useLink = (await all.filter({ visible: true }).count()) ? all.filter({ visible: true }).first() : all.first();
  await useLink.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await useLink.click({ timeout: 5000 }).catch(() => useLink.evaluate(el => el.click()));

  // 2) '데이터 검색' 팝업 + 검색창에 실제 타이핑(키입력만 검색이 돈다) + Enter
  await page.waitForSelector(".layer_app_search input.txt_mini", { timeout: 8000 });
  await page.waitForTimeout(700);                          // 팝업 초기화/핸들러 바인딩 대기
  const box = page.locator(".layer_app_search input.txt_mini").last();
  await box.click();
  await box.fill("");
  await box.pressSequentially(String(query), { delay: 45 });
  await box.press("Enter");
  await page.waitForTimeout(1200);

  // 3) 결과 선택
  const aHit = page.locator(".layer_app_search a").filter({ hasText: matchRe });
  if (await aHit.count()) {
    // 리스트형(지출항목): 결과가 <a> 링크 → 클릭
    const h = aHit.first();
    await h.waitFor({ state: "visible", timeout: 8000 });
    await h.click({ timeout: 6000 }).catch(() => h.evaluate(el => el.click()));
  } else {
    // 그리드형(카드, RealGrid): 값이 든 '셀'을 클릭해 활성화 → 그 셀에 뜨는 선택버튼(.rg-button-action) 클릭
    const cell = page.locator(".layer_app_search .rg-data-row .rg-renderer").filter({ hasText: matchRe }).first();
    await cell.waitFor({ state: "visible", timeout: 8000 });
    const stillOpen = async () => page.locator(".layer_app_search input.txt_mini").last().isVisible().catch(() => false);
    // RealGrid 선택은 타이밍에 민감 → 셀활성화→선택버튼클릭(+더블클릭)을 닫힐 때까지 재시도
    for (let attempt = 0; attempt < 4 && (await stillOpen()); attempt++) {
      await cell.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(800);
      await page.locator(".layer_app_search .rg-button-action").first().click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (!(await stillOpen())) break;
      await cell.dblclick({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  // 4) 검색창이 사라지면(팝업 닫힘) 선택 성공. 안 닫히면 닫기 시도.
  await page.locator(".layer_app_search input.txt_mini").last().waitFor({ state: "hidden", timeout: 5000 })
    .catch(async () => {
      if (DBG) console.log("[pick] 팝업 안닫힘 → 닫기 시도:", query);
      await page.locator(".layer_app_search a.btn_minor_s", { hasText: "닫기" }).last().click({ timeout: 2000 }).catch(() => {});
    });
  await page.waitForTimeout(400);
  if (DBG) console.log("[pick] 선택시도 완료:", query);
}

// 사용카드 선택 — RealGrid 그리드라 선택이 까다롭고 '닫기'만 되고 미선택되기 쉬움.
// 카드번호가 실제 폼에 들어갈 때까지(커밋) 검증하며 재시도한다.
async function pickCard(page, F, last4) {
  const re = new RegExp(escapeReg(String(last4)));
  const committed = () => page.evaluate((n) => {
    if (document.querySelector(".layer_app_search input.txt_mini")) return false; // 검색팝업 아직 열림
    return document.body.innerText.includes(n);  // 선택된 카드(별칭/번호)에 뒷자리 포함
  }, String(last4)).catch(() => false);

  for (let attempt = 0; attempt < 3 && !(await committed()); attempt++) {
    await page.evaluate(() => { const x = document.evaluate('//*[normalize-space()="사용카드"]/following::a[normalize-space()="검색"][1]', document, null, 9, null).singleNodeValue; if (x) x.click(); });
    await page.waitForSelector(".layer_app_search input.txt_mini", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);
    const box = page.locator(".layer_app_search input.txt_mini").last();
    await box.click().catch(() => {});
    await box.fill("").catch(() => {});
    await box.pressSequentially(String(last4), { delay: 45 }).catch(() => {});
    await box.press("Enter").catch(() => {});
    await page.waitForTimeout(1200);
    // 셀 활성화 → 선택버튼(.rg-button-action) 클릭, 팝업 닫힐 때까지 내부 재시도
    for (let k = 0; k < 3; k++) {
      const cell = page.locator(".layer_app_search .rg-data-row .rg-renderer").filter({ hasText: re }).first();
      await cell.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(800);
      await page.locator(".layer_app_search .rg-button-action").first().click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(700);
      if (!(await page.locator(".layer_app_search input.txt_mini").last().isVisible().catch(() => false))) break;
    }
    await page.evaluate(() => document.querySelectorAll("#popOverlay").forEach((e) => e.remove())).catch(() => {});
    await page.waitForTimeout(400);
  }
  if (!(await committed())) throw new Error("카드 미커밋");
}

// 등록부서의 부서장(필수) 선택 — [추가] → 조직도 팝업(.dop_organization)에서 이름 검색 후 클릭.
// ⚠ 이 필드가 비면 확인 시 "필수 항목입니다"로 등록이 막힌다.
async function pickManager(page, name) {
  // 폼 '등록부서의 부서장' 행에 이름이 반영됐는지 확인
  const managerSet = () => page.evaluate((nm) => {
    const lbl = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && /등록부서의\s*부서장/.test(e.textContent) && e.textContent.trim().length < 25);
    if (!lbl) return false;
    const row = lbl.closest("tr") || lbl.parentElement?.parentElement?.parentElement;
    return row ? row.textContent.includes(nm) : false;
  }, name).catch(() => false);

  // 반영될 때까지 최대 3회: [추가]→검색→결과클릭→닫기
  for (let attempt = 0; attempt < 3 && !(await managerSet()); attempt++) {
    await page.evaluate(() => {
      const lbl = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && /등록부서의\s*부서장/.test(e.textContent) && e.textContent.trim().length < 25);
      if (!lbl) return;
      const ly = lbl.getBoundingClientRect().y;
      const adds = [...document.querySelectorAll("span,a,button")].filter(e => e.children.length === 0 && /^추가$/.test(e.textContent.trim()));
      let best = null, bd = 1e9;
      for (const a of adds) { const d = Math.abs(a.getBoundingClientRect().y - ly); if (d < bd) { bd = d; best = a; } }
      if (best && bd < 140) best.click();
    });
    await page.waitForSelector('input[placeholder*="이름"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const box = page.locator('input[placeholder*="이름"]').first();
    await box.click().catch(() => {});
    await box.fill("").catch(() => {});
    await box.pressSequentially(String(name), { delay: 45 }).catch(() => {});
    await box.press("Enter").catch(() => {});
    await page.waitForTimeout(1300);
    // 결과의 멤버 항목(.member) 클릭 → 폼 부서장 필드에 추가됨 (.list 클릭은 안 먹음, .member라야 함)
    await page.locator(".dop_organization .member, .wrap_popup .member")
      .filter({ hasText: name }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    // 팝업 닫기 (선택은 유지됨): Esc + 닫기
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    await page.getByText("닫기", { exact: true }).last().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  if (!(await managerSet())) throw new Error("부서장 미반영(이름이 조직도에 있는지 확인)");
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
  const launchArgs = [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-gpu", "--disable-extensions", "--disable-background-networking",
  ];
  // 저메모리(단일프로세스) 플래그는 Render(리눅스 512MB)용. 로컬 테스트(NO_LOWMEM=1)에선 크래시나므로 끈다.
  if (!process.env.NO_LOWMEM) launchArgs.push("--single-process", "--no-zygote");
  const launchOpts = { args: launchArgs, headless: process.env.HEADED === "1" ? false : true };
  if (process.env.CHANNEL) launchOpts.channel = process.env.CHANNEL;
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ acceptDownloads: false });
  // 메모리 절약: 이미지/폰트/CSS/미디어 차단 (폼 입력엔 불필요)
  if (!process.env.NO_BLOCK) {
    await ctx.route("**/*", route => {
      const t = route.request().resourceType();
      // 큰 리소스(영상/폰트)만 차단. 이미지·CSS는 살려서 스크린샷/폼이 제대로 보이게.
      if (t === "media" || t === "font") return route.abort();
      return route.continue();
    });
  }
  const page = await ctx.newPage();
  // 한 동작이 오래 멈춰있지 않게 (못 찾으면 빨리 실패)
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(25000);
  const log = [];
  const step = (m) => { log.push(m); console.log("[daou]", m); };
  // 다우가 띄우는 네이티브 alert/confirm(필수항목 경고 등)을 잡아서 로그에 남기고 닫는다.
  if (process.env.DEBUG_SEARCH === "1") {
    page.on("request", (r) => { if (r.method() === "POST" || r.method() === "PUT") console.log(`[${r.method()}]`, (r.url() || "").replace(/https:\/\/[^/]+/, "").slice(0, 70)); });
    page.on("response", (r) => { const s = r.status(); if (s >= 400) console.log(`[HTTP ${s}]`, (r.url() || "").replace(/https:\/\/[^/]+/, "").slice(0, 70)); });
  }
  page.on("dialog", async (d) => {
    step("[알림창] " + (d.message() || "").replace(/\s+/g, " ").slice(0, 160));
    await d.accept().catch(() => {});
  });

  const loginId = p.daouId || DAOU.id;
  const loginPw = p.daouPw || DAOU.pw;
  try {
    if (!loginId || !loginPw) throw new Error("다우오피스 아이디/비번이 없어요. 앱 설정에 입력하세요.");
    // 1) 로그인
    step("◆ 코드버전: v2-2026.06.12 (부서장+전필드)");
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
    // 세션 워밍업: 포털 홈을 확실히 띄워 SSO/토큰(graphql 등) 확립 (제출이 포털 세션을 요구함)
    await page.goto(DAOU.loginUrl.replace(/\/+$/, "") + "/home", { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(3000);
    step("로그인 완료");

    // 2) 지출관리 앱 홈 → [등록] 클릭 → 등록 폼(doc/new) 진입
    //    ⚠ applet/22937/ 로 직접 가면 Works 홈으로 튕긴다. 반드시 /home 으로 가서 [등록]을 눌러야 폼이 뜬다.
    step("지출관리 앱 이동");
    const BASE = DAOU.loginUrl.replace(/\/+$/, "") + "/gw/app/works/applet/22937";
    await page.goto(BASE + "/home", { waitUntil: "networkidle" }).catch(() => {});
    await closePopups(page, step);
    // [등록] 버튼 클릭으로 폼 진입 — 서버측 초안(draft) 컨텍스트가 생겨야 제출이 된다(직접 URL은 템플릿만 뜸).
    await page.locator("a.btn_function", { hasText: /^\s*등록\s*$/ }).first().click({ timeout: 10000 })
      .catch(() => page.locator("a").filter({ hasText: /^등록$/ }).first().click({ timeout: 8000 }))
      .catch(() => step("등록 버튼 클릭 실패(수동확인)"));
    await page.waitForURL(/\/doc\/new\//, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
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

    // 5) 금액 — 네이티브 setter + input/change 이벤트로 입력(자동계산 필드 트리거 필수)
    if (p.amount) {
      const amt = String(p.amount).replace(/[^\d]/g, "");
      const ok = await F.evaluate((v) => {
        const el = document.evaluate('//*[normalize-space()="금액º"]/following::input[1]', document, null, 9, null).singleNodeValue;
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
        setter.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        return true;
      }, amt).catch(() => false);
      step(ok ? "금액: " + amt : "금액 입력 실패(수동확인)");
      await page.waitForTimeout(1200);   // 자동계산 대기
    }

    // 6) 제목 — 네이티브 setter + input/change 로 입력(다우 내부 모델 갱신; .fill()은 모델에 안 잡힐 수 있음)
    if (p.title) {
      const ok = await F.evaluate((v) => {
        const el = document.evaluate('//*[normalize-space()="제목º"]/following::input[1]', document, null, 9, null).singleNodeValue;
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
        setter.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        return true;
      }, p.title).catch(() => false);
      step(ok ? "제목 입력" : "제목 입력 실패(수동확인)");
    }

    // 7) 지출항목 — '데이터 검색' 팝업에서 검색 후 정확히 일치 항목 클릭
    if (p.category) {
      await pickFromSearch(page, F,
        '//*[normalize-space()="지출항목º"]/following::a[normalize-space()="검색"][1]',
        p.category, new RegExp("^" + escapeReg(p.category) + "$"))
        .then(() => step("지출항목: " + p.category))
        .catch((e) => step("지출항목 선택 실패: " + (e.message || "").slice(0, 90)));
    }

    // 8) 사용카드 — 뒷4자리로 검색 후 그리드에서 선택(커밋 검증 재시도)
    if (p.cardLast4) {
      await pickCard(page, F, p.cardLast4)
        .then(() => step("카드: " + p.cardLast4))
        .catch((e) => step("카드 선택 실패: " + (e.message || "").slice(0, 90)));
    }

    // 8-2) 등록부서의 부서장 (필수!) — 조직도에서 이름으로 선택
    if (p.managerName) {
      await pickManager(page, p.managerName)
        .then(() => step("부서장: " + p.managerName))
        .catch((e) => step("부서장 선택 실패: " + (e.message || "").slice(0, 90)));
    } else {
      step("⚠ 부서장 미설정 — 설정에서 부서장 이름을 입력해야 등록됩니다(필수항목)");
    }

    // 9) 파일첨부 (영수증 사진) — [카드전표] 첨부 필수
    //   '파일선택' 클릭 → 파일선택창(filechooser) 방식이 다우 업로드를 제대로 잡는다.
    if (p.photo) {
      const fileObj = {
        name: p.photo.originalname || "receipt.jpg",
        mimeType: p.photo.mimetype || "image/jpeg",
        buffer: p.photo.buffer,
      };
      try {
        const [chooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 8000 }),
          page.locator("span.btn_file, .btn_file").first().click({ timeout: 6000 }),
        ]);
        await chooser.setFiles(fileObj);
        step("사진 첨부");
      } catch {
        // 폴백: input 에 직접 설정
        await F.locator('input[type="file"][name="file"], xpath=//*[normalize-space()="파일첨부"]/following::input[@type="file"][1]')
          .first().setInputFiles(fileObj).then(() => step("사진 첨부(직접)")).catch(() => step("파일첨부 실패(수동확인)"));
      }
      await page.waitForTimeout(2500);   // 업로드 완료 대기
    }

    // 확인 전: 광고/안내 모달 <dialog> 닫기 (모달이면 뒤 페이지가 inert 되어 확인 클릭이 먹지 않음!)
    await page.evaluate(() => {
      document.querySelectorAll("dialog[open]").forEach((d) => { try { d.close(); } catch (e) {} d.remove(); });
      // 광고 배너(더워지는 날씨 등) 닫기 버튼
      [...document.querySelectorAll('button,a')].forEach((b) => {
        const t = (b.textContent || "").trim();
        if (/다시\s*보지|닫기|오늘\s*하루/.test(t) && t.length < 12) b.click();
      });
    }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
    if (process.env.DEBUG_SEARCH === "1") {
      const dump = await page.evaluate(() => {
        const xv = (x) => { const e = document.evaluate(x, document, null, 9, null).singleNodeValue; return e ? (e.value !== undefined ? e.value : e.textContent).toString().trim().slice(0, 30) : "∅"; };
        const rowOf = (lblRe) => { const lbl = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && lblRe.test(e.textContent) && e.textContent.trim().length < 25); const r = lbl && (lbl.closest("tr") || lbl.parentElement?.parentElement?.parentElement); return r ? r.textContent.trim().replace(/\s+/g, " ").slice(0, 55) : "∅"; };
        const sels = [...document.querySelectorAll("select")].map(s => s.options[s.selectedIndex]?.textContent.trim());
        return {
          selects: sels,
          금액: xv('//*[normalize-space()="금액º"]/following::input[1]'),
          제목: xv('//*[normalize-space()="제목º"]/following::input[1]'),
          지출항목: rowOf(/지출항목/),
          카드: rowOf(/사용카드/),
          부서장: rowOf(/등록부서의\s*부서장/),
          파일: (document.body.innerText.match(/[\d,]+\s*Byte/) || ["∅"])[0],
          picker: !!document.querySelector(".dop_organization"), overlay: !!document.querySelector("#popOverlay"),
        };
      }).catch((e) => ({ err: e.message }));
      console.log("[확인전 필드]", JSON.stringify(dump));
    }

    // 10) 확인 (등록 실행) — a.btn-confirm
    //   DRY_RUN=1 이면 실제 등록(확인 클릭)을 생략한다. (테스트로 폼 채우기만 검증)
    let confirmed = false;
    if (process.env.DRY_RUN === "1") {
      step("DRY_RUN: 확인 클릭 생략 (실제 등록 안 함)");
    } else {
      if (process.env.DEBUG_SEARCH === "1") {
        const c = await page.evaluate(() => {
          const bs = [...document.querySelectorAll("a.btn-confirm")];
          return { count: bs.length, vis: bs.map(b => b.offsetParent !== null), txt: bs.map(b => b.textContent.trim().slice(0, 6)) };
        }).catch(() => ({}));
        console.log("[확인버튼]", JSON.stringify(c));
      }
      await page.waitForTimeout(2000);
      // 확인을 실제 클릭으로 여러 번 시도 — 등록(URL이 doc/new → doc/<id> 로 변경)될 때까지
      for (let k = 0; k < 4 && /\/doc\/new\//.test(page.url()); k++) {
        await F.locator("a.btn-confirm").first().scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
        await F.locator("a.btn-confirm").first().click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
      // 실제 등록 여부 = URL이 더이상 /doc/new/ 가 아님
      confirmed = !/\/doc\/new\//.test(page.url());
      step(confirmed ? "✅ 등록 완료" : "확인 클릭했으나 등록 미확인 — 진단정보 확인 필요");
      if (process.env.DEBUG_SEARCH === "1") {
        const after = await page.evaluate(() => {
          const layers = [...document.querySelectorAll('.go_popup, .layer_normal, [role="dialog"], [class*="confirm"], [class*="alert"], [class*="toast"], [class*="popup"]')]
            .filter(e => e.offsetParent !== null).map(e => `${(e.className || "").toString().slice(0, 24)}: ${e.textContent.trim().replace(/\s+/g, " ").slice(0, 50)}`);
          const btns = [...document.querySelectorAll("a,button")].filter(e => e.offsetParent !== null && /확인|예|등록|저장|닫기/.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 6).map(e => (e.textContent || "").trim());
          return { url: location.href.slice(-30), layers: layers.slice(0, 6), btns: [...new Set(btns)] };
        }).catch((e) => ({ err: e.message }));
        console.log("[확인후]", JSON.stringify(after));
      }
      await page.waitForTimeout(1500);
      if (process.env.DEBUG_SEARCH === "1") {
        const diag = await page.evaluate(() => {
          // 인라인 '필수 항목입니다' 메시지가 붙은 필드 라벨 찾기
          const reqFields = [];
          [...document.querySelectorAll("*")].forEach(e => {
            if (e.children.length === 0 && /필수\s*항목입니다/.test(e.textContent) && e.offsetParent !== null) {
              let row = e.closest("tr") || e.parentElement?.parentElement?.parentElement;
              const leaf = row && [...row.querySelectorAll("*")].find(n => n.children.length === 0 && /[가-힣]/.test(n.textContent) && !/필수/.test(n.textContent) && n.textContent.trim().length > 1 && n.textContent.trim().length < 20);
              reqFields.push(leaf ? leaf.textContent.trim() : (row ? row.textContent.trim().replace(/\s+/g, " ").slice(0, 30) : "?"));
            }
          });
          return { url: location.href.slice(-40), formOpen: !!document.querySelector("a.btn-confirm"), 필수누락: [...new Set(reqFields)].slice(0, 6) };
        }).catch(() => ({}));
        console.log("[확인후 진단]", JSON.stringify(diag));
      }
      // 확인 후 2차 확인 레이어가 뜨면 처리
      await page.locator('.go_popup a.btn-confirm, .layer_normal a:has-text("확인")').first().click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(1200);
      step(confirmed ? "확인 클릭 성공" : "확인 클릭 실패");
    }

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
