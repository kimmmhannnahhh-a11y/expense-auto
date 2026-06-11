// ===== 회사/다우오피스 설정 =====

// 다우오피스 주소 + 로그인 — 비번은 코드에 넣지 말고 Render 환경변수로.
export const DAOU = {
  loginUrl: process.env.DAOU_LOGIN_URL || "https://mj321.daouoffice.com/",
  // 지출관리 '목록' 페이지 주소 (있으면 메뉴 안 거치고 바로 진입 → 홍보팝업 회피)
  expenseUrl: process.env.DAOU_EXPENSE_URL || "",
  id: process.env.DAOU_ID || "",
  pw: process.env.DAOU_PW || "",
};

// 결산산입부서 드롭다운 목록 (지출 등록화면)
export const DEPARTMENTS = [
  "경영지원실", "공사", "대외팀", "대성", "마케팅부",
  "영업부(영업지원팀)", "영업부(시흥영업1팀)", "영업부(시흥영업2팀)", "영업부(천안영업/청약)",
  "우선 기술사업부", "우선 영업사업부", "우성 영업사업부",
  "유통사업부", "모바일 유통사업부", "통합(공용)",
  "구로헌장팀(구)", "시흥청약팀(구)", "영업운영팀(구)", "부천영업팀(구)",
];

// 등록유형 드롭다운 목록
export const REGISTER_TYPES = [
  "입금요청", "법인카드 사용", "법인카드 취소", "구매/결제 요청",
  "자동이체", "현금자급요청", "기타(비고란 기재)",
];

// 자주 쓰는 지출항목 (앱 드롭다운용). 실제 선택은 다우 '데이터검색'에서 이 텍스트로 찾아 클릭.
// value = 다우 검색·제목에 들어가는 실제 값 / label = 드롭다운에 보이는 이름
export const CATEGORIES = [
  { value: "식대", label: "식대 (특근·야근·멘토멘티 제외)" },
  { value: "식대-특근", label: "식대-특근" },
  { value: "식대-야근", label: "식대-야근" },
  { value: "식대-멘토멘티", label: "식대-멘토멘티" },
  { value: "소모품", label: "소모품" },
  { value: "협력점수수료", label: "협력점수수료" },
  { value: "상부점환수", label: "상부점환수" },
  { value: "기타", label: "기타" },
];
