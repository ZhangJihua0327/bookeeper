/**
 * 手写台账识别：调用阿里云百炼（DashScope）的视觉模型，把照片转成结构化草稿。
 * 只负责“识别 + 归一化”，写库由前端确认后调 /api/records 完成。
 */

const ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

export const DEFAULT_OCR_MODEL = "qwen3-vl-plus";

export function buildOcrPrompt({ customers = [], truckModels = [] } = {}) {
  const customerHint = customers.length ? `客户：${customers.join("、")}` : "客户：（暂无名单）";
  const modelHint = truckModels.length ? `车型：${truckModels.join("、")}` : "车型：（暂无名单）";

  return `你是混凝土运输记账的录入员。用户会给你一张手写台账照片，你只负责把内容转成结构化 JSON，不要解释、不要寒暄。

台账的样子：
- 顶部写日期，例如「11月18日」。
- 上半部分：泵车作业，每行带编号 ①②③④，格式是「客户 施工地点 方量」，例如「亿德鑫 板坪 8方」。
- 下半部分：搅拌车运输，没有编号，格式是「客户 每车方量×车数 司机姓氏」，例如「朱水波 12×3 姜」。

参考名单（只在字迹形近、拿不准时用来校正，不要强行套用；明显不匹配就当新客户）：
${customerHint}
${modelHint}

只输出严格 JSON，不要 markdown 代码块：
{
  "date": "YYYY-MM-DD 或空字符串",
  "entries": [
    {
      "table": "pump" 或 "mixer",
      "customer": "客户名称",
      "volume": 数字,
      "note": "泵车填施工地点；搅拌车填原始算式，例如 12×3 姜",
      "raw": "该行原文的抄录",
      "confidence": 0 到 1,
      "uncertain": ["不确定的字段名"]
    }
  ]
}

识别要点：
1. 有编号 ①②③④ 的行 → pump；没有编号且形如「客户 12×3 姜」的行 → mixer。
2. mixer 一行只对应一个「数字×数字」加一个司机姓氏，volume = 相乘结果；同一客户连续多行则拆成多条，不要合并成一行。
3. 「8+3」是加法，不要改写成「8×3」或「8×3 姜」；「8×2」才是乘法。
4. 数字照实读，不要把 3.5 读成 35、也不要反过来；看不清就写进 uncertain 并给出最可能的值。
5. 客户名优先用参考名单里字形最接近的那个；认不出的字用「?」代替并写进 uncertain。
6. 日期只有「月日」时，年份用 2026。
7. 被划掉的内容不要输出；不要臆造不存在的行。
8. **手写会换行**：一行内容可能折到下一行（常见的是方量或「方」字单独写在下一行），这种续行要并回上一条，不要当成新的一条。
9. 不确定就降低 confidence，不要为了凑数而猜。`;
}

/** 模型偶尔会套 ```json 代码块或前后加话，这里做健壮提取。 */
export function extractJson(text) {
  let value = String(text ?? "").trim();
  value = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(value.slice(start, end + 1));
    }
    throw new Error("模型没有返回合法的 JSON");
  }
}

const SCOPES = new Set(["pump", "mixer"]);

/** 把模型输出归一化成前端可直接渲染的草稿。 */
export function normalizeOcrResult(raw, { today = "" } = {}) {
  if (!raw || typeof raw !== "object") throw new Error("识别结果为空");

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || "")) ? String(raw.date) : today;

  const entries = [];
  for (const item of Array.isArray(raw.entries) ? raw.entries : []) {
    const table = String(item?.table || "").toLowerCase();
    if (!SCOPES.has(table)) continue;

    const customer = String(item?.customer ?? "").trim().slice(0, 128);
    const volume = Number(item?.volume);
    if (!customer && !(volume > 0)) continue;

    const confidence = Number(item?.confidence);
    entries.push({
      table,
      customer,
      volume: Number.isFinite(volume) ? Math.round(volume * 1000) / 1000 : 0,
      note: String(item?.note ?? "").trim().slice(0, 255),
      raw: String(item?.raw ?? "").trim().slice(0, 255),
      confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : null,
      uncertain: Array.isArray(item?.uncertain) ? item.uncertain.map((value) => String(value)).slice(0, 6) : [],
    });
  }

  return { date, entries: mergeMixerEntries(entries) };
}

const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * 搅拌车按「同一客户当天一条」合并：方量相加，司机明细用换行连接。
 * 与历史台账的写法保持一致（一条记录里多行司机明细）。
 */
export function mergeMixerEntries(entries) {
  const merged = [];
  const indexByCustomer = new Map();

  for (const entry of entries) {
    if (entry.table !== "mixer" || !entry.customer) {
      merged.push(entry);
      continue;
    }

    const existingIndex = indexByCustomer.get(entry.customer);
    if (existingIndex === undefined) {
      indexByCustomer.set(entry.customer, merged.length);
      merged.push({ ...entry, uncertain: [...entry.uncertain] });
      continue;
    }

    const target = merged[existingIndex];
    target.volume = round3(target.volume + entry.volume);
    target.note = [target.note, entry.note].filter(Boolean).join("\n");
    target.raw = [target.raw, entry.raw].filter(Boolean).join(" / ");
    if (entry.confidence !== null) {
      target.confidence =
        target.confidence === null ? entry.confidence : Math.min(target.confidence, entry.confidence);
    }
    target.uncertain = [...new Set([...target.uncertain, ...entry.uncertain])];
  }

  return merged;
}

/**
 * 调用视觉模型识别一张图。
 * @param {{apiKey: string, model?: string, imageDataUrl: string, dicts?: object, today?: string, timeoutMs?: number, fetchImpl?: Function}} options
 */
export async function recognizeLedger({
  apiKey,
  model = DEFAULT_OCR_MODEL,
  imageDataUrl,
  dicts = {},
  today = "",
  timeoutMs = 120000,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error("未配置 DASHSCOPE_API_KEY");

  const payload = {
    model,
    messages: [
      { role: "system", content: buildOcrPrompt(dicts) },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl } },
          { type: "text", text: "识别这张台账，严格按 JSON 输出。" },
        ],
      },
    ],
    temperature: 0.1,
  };

  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`识别服务返回 ${response.status}：${text.slice(0, 200)}`);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("识别服务返回的不是 JSON");
  }

  const message = body?.choices?.[0]?.message?.content;
  const content = Array.isArray(message)
    ? message.map((part) => part?.text || "").join("")
    : String(message || "");

  if (!content) throw new Error("识别服务没有返回内容");

  const parsed = extractJson(content);
  return normalizeOcrResult(parsed, { today });
}
