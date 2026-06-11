// ===== 회사 맞춤 설정 =====
// 실제 값은 여기서 바꾸면 됩니다. (다우오피스 화면 확인 후 채워넣음)

// 1) 지출항목 목록 — 다우오피스 '지출항목' 버튼 눌렀을 때 나오는 항목들.
//    OCR이 영수증을 보고 이 중에서 골라 추천합니다.
//    TODO: 실제 회사 지출항목 목록으로 교체
export const CATEGORIES = [
  "식대(직원)",
  "식대(접대)",
  "주유비",
  "통신비",
  "소모품비",
  "비품구입",
  "교통비",
  "주차비",
  "도서구입비",
  "교육훈련비",
  "복리후생비",
  "기타"
];

// 2) 다우오피스 주소/로그인 — 환경변수(Render)에서 읽음. 코드에 비번 넣지 말 것.
export const DAOU = {
  loginUrl: process.env.DAOU_LOGIN_URL || "",   // 예: https://회사도메인.daouoffice.com/
  id: process.env.DAOU_ID || "",
  pw: process.env.DAOU_PW || "",
};

// 3) 다우오피스 화면 셀렉터 — 실제 페이지 확인 후 채움 (2단계)
//    daou.js 에서 사용. 지금은 비어있어 자동등록은 '준비중' 상태.
export const SELECTORS = {
  // TODO: 실제 다우오피스 works>지출관리 페이지 보고 채우기
  idInput: "",
  pwInput: "",
  loginBtn: "",
  expenseMenu: "",
  addBtn: "",
  categoryBtn: "",
  titleInput: "",
  fileInput: "",
  submitBtn: "",
};
