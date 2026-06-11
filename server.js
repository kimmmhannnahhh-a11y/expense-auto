import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, DEPARTMENTS, REGISTER_TYPES } from "./config.js";
import { submitToDaou, daouReady } from "./daou.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

app.get("/api/config", (_req, res) => {
  res.json({
    ocr: !!process.env.ANTHROPIC_API_KEY,
    daou: daouReady(),
    categories: CATEGORIES,
    departments: DEPARTMENTS,
    registerTypes: REGISTER_TYPES,
  });
});

// 영수증 사진 -> 금액/날짜/상호 추출
app.post("/api/ocr", upload.single("photo"), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 없어요." });
    if (!req.file) return res.status(400).json({ error: "사진이 없어요." });

    const b64 = req.file.buffer.toString("base64");
    const prompt = `이 영수증 사진을 보고 아래 JSON만 출력해. 설명 금지.
{"amount": 숫자(원,콤마없이), "date": "YYYY-MM-DD", "vendor": "가게/상호명"}
못 읽으면 빈 문자열 또는 0.`;

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: req.file.mimetype || "image/jpeg", data: b64 } },
          { type: "text", text: prompt },
        ],
      }],
    });
    const text = msg.content.find(c => c.type === "text")?.text || "{}";
    const data = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: "사진 분석 실패: " + e.message });
  }
});

// 다우오피스 자동 등록
app.post("/api/submit", upload.single("photo"), async (req, res) => {
  try {
    if (!daouReady()) return res.status(503).json({ error: "다우오피스 로그인 정보(환경변수)가 아직 없어요." });
    const b = req.body;
    const result = await submitToDaou({
      amount: b.amount, date: b.date, title: b.title,
      category: b.category, dept: b.dept, registerType: b.registerType,
      managerName: b.managerName, cardLast4: b.cardLast4,
      autoApprove: b.autoApprove === "true",
      photo: req.file,
    });
    res.json({ ok: true, log: result.log, screenshot: result.screenshot });
  } catch (e) {
    res.status(500).json({ error: "등록 중 막힘: " + e.message, log: e.log, screenshot: e.screenshot });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("법카 영수증 자동등록 서버 실행: " + PORT));
