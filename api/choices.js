// Vercel Serverless Function — حفظ اختيارات المعلمين في Upstash Redis
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const TEACHER_CODE = process.env.TEACHER_CODE || "123123";
const KEY = "student-choices";
const TOTAL = 153;

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// لو الطالب مسجّل بواسطة معلم تاني يرجع "locked:<الاسم>"، غير كده يحفظ (ذرّيًا)
const LUA = `
local cur = redis.call('HGET', KEYS[1], ARGV[1])
if cur then
  local o = cjson.decode(cur)
  if o.teacher ~= ARGV[2] then return 'locked:' .. o.teacher end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
return 'ok'
`;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) return res.status(500).json({ error: "database_not_configured" });
  if ((req.headers["x-code"] || "") !== TEACHER_CODE) return res.status(401).json({ error: "bad_code" });

  try {
    if (req.method === "GET") {
      const flat = (await redis(["HGETALL", KEY])) || [];
      const choices = {};
      for (let i = 0; i < flat.length; i += 2) {
        try { choices[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) {}
      }
      return res.status(200).json({ choices });
    }

    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const m = /^s(\d+)$/.exec(b.id || "");
      const teacher = String(b.teacher || "").trim().replace(/\s+/g, " ").slice(0, 60);
      if (!m || +m[1] < 1 || +m[1] > TOTAL) return res.status(400).json({ error: "bad_id" });
      if (b.decision !== "up" && b.decision !== "st") return res.status(400).json({ error: "bad_decision" });
      if (!teacher) return res.status(400).json({ error: "bad_teacher" });

      const value = JSON.stringify({ decision: b.decision, teacher, ts: Date.now() });
      const out = await redis(["EVAL", LUA, "1", KEY, b.id, teacher, value]);
      if (typeof out === "string" && out.startsWith("locked:"))
        return res.status(409).json({ error: "locked", by: out.slice(7) });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(500).json({ error: "server_error" });
  }
};
