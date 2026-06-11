import { chromium } from "playwright";
import { DAOU, SELECTORS } from "./config.js";

// 다우오피스 자동등록 준비됐는지 (셀렉터/로그인 정보 다 있나)
export function daouReady() {
  return !!(DAOU.loginUrl && DAOU.id && DAOU.pw && SELECTORS.idInput && SELECTORS.submitBtn);
}

// 2단계: 실제 다우오피스 works>지출관리에 자동 입력+등록
// 실제 페이지 셀렉터를 config.js SELECTORS에 채운 뒤 작동합니다.
export async function submitToDaou({ amount, date, vendor, category, title, photo }) {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  try {
    // 1) 로그인
    await page.goto(DAOU.loginUrl, { waitUntil: "networkidle" });
    await page.fill(SELECTORS.idInput, DAOU.id);
    await page.fill(SELECTORS.pwInput, DAOU.pw);
    await page.click(SELECTORS.loginBtn);
    await page.waitForLoadState("networkidle");

    // 2) works > 지출관리 > 등록
    await page.click(SELECTORS.expenseMenu);
    await page.click(SELECTORS.addBtn);

    // 3) 지출항목 선택
    await page.click(SELECTORS.categoryBtn);
    await page.click(`text=${category}`);

    // 4) 제목 입력
    await page.fill(SELECTORS.titleInput, title);

    // 5) 사진 첨부
    if (photo) {
      await page.setInputFiles(SELECTORS.fileInput, {
        name: photo.originalname || "receipt.jpg",
        mimeType: photo.mimetype || "image/jpeg",
        buffer: photo.buffer,
      });
    }

    // 6) 등록
    await page.click(SELECTORS.submitBtn);
    await page.waitForLoadState("networkidle");
  } finally {
    await browser.close();
  }
}
