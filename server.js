import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, DAOU } from "./config.js";
import { submitToDaou, daouReady } from "./daou.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// 영수증 사진 -> 금액/날짜/상호 추출 + 지출항목/제목 추천
app.post("/api/ocr", upload.single("photo"), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았어요." });
    if (!req.file) return res.status(400).json({ error: "사진이 없어요." });

    const b64 = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype || "image/jpeg";

    const prompt = `이 영수증 사진을 보고 아래 JSON만 출력해. 설명 금지, JSON만.
{
  "amount": 숫자(원, 콤마 없이),
  "date": "YYYY-MM-DD",
  "vendor": "가게/상호명",
  "category": "${CATEGORIES.join(" / ")} 중 가장 알맞은 하나",
  "title": "지출 제목 (예: '점심 식대 - 김밥천국', 가게명과 용도 포함, 25자 이내)"
}
값을 못 읽으면 빈 문자열 또는 0. 추측 가능한 건 합리적으로 채워.`;

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: prompt },
        ],
      }],
    });

    const text = msg.content.find(c => c.type === "text")?.text || "{}";
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json({ ok: true, data: json, categories: CATEGORIES });
  } catch (e) {
    res.status(500).json({ error: "사진 분석 실패: " + e.message });
  }
});

// 다우오피스 자동 등록 (2단계 - daou.js 셀렉터 채워지면 작동)
app.post("/api/submit", upload.single("photo"), async (req, res) => {
  try {
    if (!daouReady()) return res.status(503).json({ error: "다우오피스 자동등록은 아직 준비중이에요(2단계). 화면 확인 후 연결됩니다." });
    const { amount, date, vendor, category, title } = req.body;
    await submitToDaou({ amount, date, vendor, category, title, photo: req.file });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "등록 실패: " + e.message });
  }
});

app.get("/api/status", (_req, res) => {
  res.json({ ocr: !!process.env.ANTHROPIC_API_KEY, daou: daouReady(), categories: CATEGORIES });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("법카 영수증 자동등록 서버 실행: " + PORT));
