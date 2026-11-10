// Все запросы к /api/* попадают сюда (Cloudflare Pages Functions)
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  deleteSession,
  sessionCookie,
  clearCookie,
  isLoginBlocked,
  recordLoginFail,
  clearLoginFails,
} from "../../src/auth.js";
import { LEVELS, requiredFor, findTask, checkAnswer, publicTask } from "../../src/tasks.js";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

const fail = (status, error) => json({ error }, status);

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function solvedSet(db, userId) {
  const { results } = await db.prepare("SELECT task_id FROM progress WHERE user_id = ?").bind(userId).all();
  return new Set(results.map((r) => r.task_id));
}

// Уровень 1 открыт всегда, следующий — когда в предыдущем решено достаточно задач
function levelStates(solved) {
  let prevDone = true;
  return LEVELS.map((level) => {
    const solvedCount = level.tasks.filter((t) => solved.has(t.id)).length;
    const required = requiredFor(level);
    const state = { level, solvedCount, required, unlocked: prevDone, passed: solvedCount >= required };
    prevDone = prevDone && state.passed;
    return state;
  });
}

const routes = {
  "POST /register": async ({ db, request }) => {
    const { username, password } = await readBody(request);
    if (typeof username !== "string" || !USERNAME_RE.test(username)) {
      return fail(400, "Логин: от 3 до 32 символов, только латиница, цифры и _");
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return fail(400, "Пароль: от 8 до 128 символов");
    }
    const exists = await db.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first();
    if (exists) return fail(409, "Такой логин уже занят");

    const { hash, salt } = await hashPassword(password);
    const user = await db
      .prepare("INSERT INTO users (username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?) RETURNING id")
      .bind(username, hash, salt, Date.now())
      .first();
    const token = await createSession(db, user.id);
    return json({ ok: true }, 201, { "Set-Cookie": sessionCookie(token, request) });
  },

  "POST /login": async ({ db, request }) => {
    const { username, password } = await readBody(request);
    if (typeof username !== "string" || typeof password !== "string") return fail(400, "Введите логин и пароль");

    const key = "u:" + username.toLowerCase();
    if (await isLoginBlocked(db, key)) {
      return fail(429, "Слишком много неудачных попыток. Подождите 15 минут.");
    }
    const user = await db
      .prepare("SELECT id, pass_hash, salt FROM users WHERE username = ?")
      .bind(username)
      .first();
    const ok = user && (await verifyPassword(password, user.pass_hash, user.salt));
    if (!ok) {
      await recordLoginFail(db, key);
      // Одинаковое сообщение, чтобы нельзя было узнать, существует ли логин
      return fail(401, "Неверный логин или пароль");
    }
    await clearLoginFails(db, key);
    // Заодно чистим просроченные сессии
    await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
    const token = await createSession(db, user.id);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, request) });
  },

  "POST /logout": async ({ db, request }) => {
    await deleteSession(db, request);
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
  },

  "GET /me": async ({ user }) => json({ user }),

  "GET /levels": async ({ db, user }) => {
    const solved = await solvedSet(db, user.id);
    const levels = levelStates(solved).map(({ level, solvedCount, required, unlocked, passed }) => ({
      id: level.id,
      title: level.title,
      subtitle: level.subtitle,
      total: level.tasks.length,
      solvedCount,
      required,
      unlocked,
      passed,
      tasks: unlocked
        ? level.tasks.map((t) => ({ ...publicTask(t, solved.has(t.id)), solved: solved.has(t.id) }))
        : [],
    }));
    return json({ levels });
  },

  "POST /answer": async ({ db, user, request }) => {
    const { taskId, answer } = await readBody(request);
    const found = typeof taskId === "string" && findTask(taskId);
    if (!found) return fail(404, "Задача не найдена");
    if (answer === undefined || answer === null || String(answer).length > 500) return fail(400, "Пустой ответ");

    const solved = await solvedSet(db, user.id);
    const before = levelStates(solved);
    const idx = before.findIndex((s) => s.level.id === found.level.id);
    if (!before[idx].unlocked) return fail(403, "Этот уровень ещё закрыт");

    if (!checkAnswer(found.task, answer)) return json({ correct: false });

    await db
      .prepare("INSERT OR IGNORE INTO progress (user_id, task_id, solved_at) VALUES (?, ?, ?)")
      .bind(user.id, taskId, Date.now())
      .run();
    solved.add(taskId);
    const next = levelStates(solved)[idx + 1];
    const justUnlocked = next && next.unlocked && !before[idx + 1].unlocked;
    return json({
      correct: true,
      explain: found.task.explain,
      unlockedLevel: justUnlocked ? next.level.id : null,
    });
  },
};

const PUBLIC = new Set(["POST /register", "POST /login", "POST /logout", "GET /me"]);

export async function onRequest({ request, env, params }) {
  const db = env.DB;
  if (!db) return fail(500, "База D1 не подключена (binding DB)");

  const path = "/" + (params.path || []).join("/");
  const key = `${request.method} ${path}`;
  const handler = routes[key];
  if (!handler) return fail(404, "Не найдено");

  // Защита от CSRF: POST принимаем только со своего сайта и только в JSON
  if (request.method === "POST") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return fail(403, "Чужой источник запроса");
    if (!(request.headers.get("Content-Type") || "").includes("application/json")) {
      return fail(415, "Нужен JSON");
    }
  }

  const user = await getSessionUser(db, request);
  if (!PUBLIC.has(key) && !user) return fail(401, "Нужно войти");

  try {
    return await handler({ db, request, user });
  } catch (err) {
    console.error(err);
    return fail(500, "Ошибка сервера");
  }
}
