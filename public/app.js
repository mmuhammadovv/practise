import { Terminal } from "./terminal.js";
import { LESSONS } from "./lessons.js";

const app = document.getElementById("app");
const userBox = document.getElementById("user-box");
let me = null;
let levels = [];

// ---------- API ----------

async function api(path, body) {
  const res = await fetch("/api" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") {
    me = null;
    location.hash = "#/login";
  }
  if (!res.ok) throw new Error(data.error || "Ошибка " + res.status);
  return data;
}

// ---------- помощники ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Текст: `код` → <code>, переносы строк сохраняются. Всё через textContent — без innerHTML.
function rich(text, tag = "div") {
  const p = h(tag, { class: "rich" });
  text.split("\n").forEach((line, i) => {
    if (i) p.append(h("br"));
    line.split(/(`[^`]+`)/).forEach((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1) p.append(h("code", {}, part.slice(1, -1)));
      else if (part) p.append(part);
    });
  });
  return p;
}

function setView(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function renderUserBox() {
  userBox.replaceChildren();
  if (!me) return;
  userBox.append(
    h("a", { href: "#/", class: "nav-link" }, "Уровни"),
    h("a", { href: "#/stats", class: "nav-link" }, "Статистика"),
    h("span", { class: "muted username" }, me.username),
    h(
      "button",
      {
        class: "btn ghost small",
        onclick: async () => {
          await api("/logout", {}).catch(() => {});
          me = null;
          renderUserBox();
          location.hash = "#/login";
        },
      },
      "Выйти"
    )
  );
}

async function loadLevels() {
  levels = (await api("/levels")).levels;
}

function progressBar(value, max) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return h(
    "div",
    { class: "bar", role: "progressbar", "aria-valuenow": value, "aria-valuemin": 0, "aria-valuemax": max },
    h("div", { class: "bar-fill", style: `width:${pct}%` })
  );
}

// ---------- вход ----------

function viewAuth(mode = "login") {
  const isLogin = mode === "login";
  const err = h("p", { class: "error", role: "alert" });
  const username = h("input", { name: "username", autocomplete: "username", required: true, minlength: 3, maxlength: 32 });
  const password = h("input", {
    name: "password",
    type: "password",
    autocomplete: isLogin ? "current-password" : "new-password",
    required: true,
    minlength: 8,
    maxlength: 128,
  });
  const submit = h("button", { class: "btn", type: "submit" }, isLogin ? "Войти" : "Создать аккаунт");

  const form = h(
    "form",
    {
      class: "card auth",
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = "";
        submit.disabled = true;
        try {
          await api(isLogin ? "/login" : "/register", { username: username.value.trim(), password: password.value });
          me = (await api("/me")).user;
          renderUserBox();
          location.hash = "#/";
        } catch (e2) {
          err.textContent = e2.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
    h("h1", {}, isLogin ? "Вход" : "Регистрация"),
    h("p", { class: "muted" }, "Прогресс сохраняется в аккаунте и доступен с любого устройства."),
    h("label", {}, "Логин", username),
    h("label", {}, "Пароль", password),
    !isLogin && h("p", { class: "muted small" }, "Минимум 8 символов. Латиница, цифры и _ для логина."),
    err,
    submit,
    h(
      "p",
      { class: "muted small" },
      isLogin ? "Нет аккаунта? " : "Уже есть аккаунт? ",
      h("a", { href: isLogin ? "#/register" : "#/login" }, isLogin ? "Зарегистрироваться" : "Войти")
    )
  );
  setView(form);
  username.focus();
}

// ---------- уровни ----------

function viewDashboard() {
  const totalSolved = levels.reduce((s, l) => s + l.solvedCount, 0);
  const total = levels.reduce((s, l) => s + l.total, 0);
  setView(
    h(
      "section",
      { class: "intro" },
      h("h1", {}, "Путь в кибербезопасность"),
      h("p", { class: "muted" }, `${levels.length} уровней. Решено ${totalSolved} из ${total} задач.`),
      progressBar(totalSolved, total)
    ),
    h(
      "div",
      { class: "levels" },
      levels.map((l) =>
        h(
          l.unlocked ? "a" : "div",
          { class: `card level ${l.unlocked ? "" : "locked"} ${l.passed ? "passed" : ""}`, href: l.unlocked ? `#/level/${l.id}` : null },
          h("div", { class: "level-num" }, l.passed ? "✓" : l.unlocked ? l.id : "🔒"),
          h(
            "div",
            { class: "level-body" },
            h("h2", {}, `Уровень ${l.id}. ${l.title}`),
            h("p", { class: "muted" }, l.subtitle),
            progressBar(l.solvedCount, l.total),
            h(
              "p",
              { class: "small muted" },
              !l.unlocked
                ? "Закрыт. Пройдите предыдущий уровень."
                : !l.theoryRead
                ? "Начните с теории."
                : `Решено ${l.solvedCount}/${l.total}. Для следующего уровня нужно ${l.required}.`
            )
          )
        )
      )
    )
  );
}

function renderLesson(blocks) {
  return h(
    "article",
    { class: "lesson" },
    blocks.map((b) => {
      if (b.h) return h("h2", {}, b.h);
      if (b.p) return rich(b.p, "p");
      if (b.note) return h("aside", { class: "note" }, rich(b.note));
      if (b.list) return h("ul", {}, b.list.map((li) => h("li", {}, rich(li, "span"))));
      if (b.table)
        return h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, b.table.head.map((c) => h("th", { scope: "col" }, c)))),
            h("tbody", {}, b.table.rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, rich(c, "span"))))))
          )
        );
      return null;
    })
  );
}

function viewTheory(level) {
  const btnText = level.theoryRead ? "К задачам →" : "Я изучил теорию → к задачам";
  const err = h("p", { class: "error", role: "alert" });
  const go = h(
    "button",
    {
      class: "btn",
      onclick: async () => {
        go.disabled = true;
        try {
          if (!level.theoryRead) await api("/theory", { levelId: level.id });
          location.hash = `#/level/${level.id}/tasks`;
        } catch (e) {
          err.textContent = e.message;
          go.disabled = false;
        }
      },
    },
    btnText
  );
  setView(
    h("a", { href: "#/", class: "back" }, "← Все уровни"),
    h("p", { class: "eyebrow" }, `Уровень ${level.id} · Теория`),
    h("h1", {}, level.title),
    !level.theoryRead && h("p", { class: "muted" }, "Прочитайте теорию до конца. Задачи откроются после неё."),
    renderLesson(LESSONS[level.id] || []),
    h("div", { class: "card cta" }, h("p", {}, "Всё понятно? Переходите к задачам. К теории можно вернуться в любой момент."), err, go)
  );
}

function viewLevel(id, tab) {
  const level = levels.find((l) => l.id === id);
  if (!level || !level.unlocked) return (location.hash = "#/");
  if (tab === "theory" || !level.theoryRead) return viewTheory(level);

  setView(
    h("a", { href: "#/", class: "back" }, "← Все уровни"),
    h("p", { class: "eyebrow" }, `Уровень ${level.id}`),
    h("h1", {}, level.title),
    h("p", { class: "muted" }, level.subtitle),
    progressBar(level.solvedCount, level.total),
    h(
      "p",
      { class: "small muted" },
      `Решено ${level.solvedCount}/${level.total}. Для следующего уровня нужно ${level.required}. `,
      h("a", { href: `#/level/${level.id}/theory` }, "📖 Теория уровня")
    ),
    h(
      "ol",
      { class: "tasks" },
      level.tasks.map((t) =>
        h(
          "li",
          {},
          h(
            "a",
            { class: `card task-row ${t.solved ? "solved" : ""}`, href: `#/task/${t.id}` },
            h("span", { class: "task-id" }, t.id),
            h("span", { class: "task-title" }, t.title),
            h("span", { class: `tag ${t.type}` }, { choice: "тест", text: "ответ", terminal: "терминал" }[t.type]),
            h("span", { class: "task-status" }, t.solved ? "✓" : "")
          )
        )
      )
    )
  );
}

// ---------- задача ----------

function viewTask(taskId) {
  const level = levels.find((l) => l.tasks.some((t) => t.id === taskId));
  if (!level) return (location.hash = "#/");
  if (!level.theoryRead) return (location.hash = `#/level/${level.id}`);
  const idx = level.tasks.findIndex((t) => t.id === taskId);
  const task = level.tasks[idx];
  const nextTask = level.tasks[idx + 1];

  const result = h("div", { class: "result", "aria-live": "polite" });
  const hintBox = h("p", { class: "hint", hidden: true }, rich(task.hint, "span"));
  let getAnswer;
  let answerArea;

  if (task.type === "choice") {
    const name = "opt-" + task.id;
    answerArea = h(
      "fieldset",
      { class: "options" },
      h("legend", { class: "sr-only" }, "Варианты ответа"),
      task.options.map((o, i) => h("label", { class: "option" }, h("input", { type: "radio", name, value: i }), h("span", {}, rich(o))))
    );
    getAnswer = () => answerArea.querySelector("input:checked")?.value;
  } else {
    const input = h("input", {
      class: "answer-input",
      placeholder: task.type === "terminal" ? "flag{...} или ответ" : "Ваш ответ",
      autocomplete: "off",
      spellcheck: "false",
    });
    answerArea = h("label", { class: "answer-label" }, task.type === "terminal" ? "Найденный ответ" : "Ответ", input);
    getAnswer = () => input.value.trim();
  }

  const submit = h("button", { class: "btn", type: "submit" }, "Проверить");
  const form = h(
    "form",
    {
      class: "answer-form",
      onsubmit: async (e) => {
        e.preventDefault();
        const answer = getAnswer();
        if (answer === undefined || answer === "") {
          result.replaceChildren(h("p", { class: "error" }, "Сначала выберите или введите ответ."));
          return;
        }
        submit.disabled = true;
        try {
          const res = await api("/answer", { taskId: task.id, answer });
          if (res.correct) {
            task.solved = true;
            task.explain = res.explain;
            await loadLevels();
            showSolved(res.unlockedLevel);
          } else {
            result.replaceChildren(h("p", { class: "error" }, "Неверно. Попробуйте ещё раз или откройте подсказку."));
          }
        } catch (e2) {
          result.replaceChildren(h("p", { class: "error" }, e2.message));
        } finally {
          submit.disabled = false;
        }
      },
    },
    answerArea,
    h(
      "div",
      { class: "row" },
      submit,
      h("button", { class: "btn ghost", type: "button", onclick: () => (hintBox.hidden = !hintBox.hidden) }, "Подсказка"),
      h("a", { class: "btn ghost", href: `#/level/${level.id}/theory` }, "Теория")
    )
  );

  function showSolved(unlockedLevel) {
    result.replaceChildren(
      h(
        "div",
        { class: "success" },
        h("p", { class: "ok" }, "✓ Верно!"),
        task.explain && rich(task.explain),
        unlockedLevel && h("p", { class: "unlock" }, `🔓 Открыт уровень ${unlockedLevel}!`),
        h(
          "div",
          { class: "row" },
          nextTask
            ? h("a", { class: "btn", href: `#/task/${nextTask.id}` }, "Следующая задача →")
            : h("a", { class: "btn", href: "#/" }, "К уровням →")
        )
      )
    );
  }

  const termBox = task.type === "terminal" ? h("div", { class: "term-wrap" }) : null;

  setView(
    h("a", { href: `#/level/${level.id}`, class: "back" }, `← Уровень ${level.id}. ${level.title}`),
    h("h1", {}, `${task.id}. ${task.title}`, task.solved ? h("span", { class: "badge" }, "решено") : null),
    h("div", { class: "card" }, rich(task.question)),
    termBox,
    form,
    hintBox,
    result
  );

  if (termBox) new Terminal(termBox, task.terminal);
  if (task.solved) showSolved(null);
}

// ---------- статистика ----------

const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (ts) => new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

function computeStats(data) {
  const titles = {};
  data.levels.forEach((l) => l.tasks.forEach((t) => (titles[t.id] = t.title)));
  const totalTasks = Object.keys(titles).length;
  const solvedAt = Object.fromEntries(data.solved.map((s) => [s.task_id, s.solved_at]));

  const attempts = data.attempts.length;
  const correct = data.attempts.filter((a) => a.correct).length;
  const wrongByTask = {};
  data.attempts.forEach((a) => {
    if (!a.correct) wrongByTask[a.task_id] = (wrongByTask[a.task_id] || 0) + 1;
  });
  const firstTry = data.solved.filter(
    (s) => !data.attempts.some((a) => a.task_id === s.task_id && !a.correct && a.created_at < s.solved_at)
  ).length;

  // Активные дни и серия подряд
  const activeDays = new Set(data.attempts.map((a) => dayKey(a.created_at)));
  let streak = 0;
  const cursor = new Date();
  if (!activeDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1); // сегодня ещё не занимались — серия жива
  while (activeDays.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Решено задач по дням за последние 14 дней
  const perDay = {};
  data.solved.forEach((s) => (perDay[dayKey(s.solved_at)] = (perDay[dayKey(s.solved_at)] || 0) + 1));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: dayKey(d), date: d, count: perDay[dayKey(d)] || 0 });
  }

  const perLevel = data.levels.map((l) => ({
    id: l.id,
    title: l.title,
    total: l.tasks.length,
    solved: l.tasks.filter((t) => solvedAt[t.id]).length,
  }));

  const hardest = Object.entries(wrongByTask)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, wrong]) => ({ id, title: titles[id], wrong, solved: !!solvedAt[id] }));

  const recent = [...data.solved]
    .sort((a, b) => b.solved_at - a.solved_at)
    .slice(0, 6)
    .map((s) => ({ id: s.task_id, title: titles[s.task_id], at: s.solved_at }));

  return { totalTasks, solved: data.solved.length, attempts, correct, firstTry, activeDays: activeDays.size, streak, days, perLevel, hardest, recent };
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function tile(value, label, sub) {
  return h("div", { class: "card tile" }, h("div", { class: "tile-value" }, value), h("div", { class: "tile-label" }, label), sub && h("div", { class: "tile-sub muted small" }, sub));
}

async function viewStats() {
  let data;
  try {
    data = await api("/stats");
  } catch (e) {
    return setView(h("p", { class: "error" }, e.message));
  }
  const s = computeStats(data);
  const accuracy = s.attempts ? Math.round((s.correct / s.attempts) * 100) : 0;
  const max = Math.max(1, ...s.days.map((d) => d.count));

  const chart = h(
    "div",
    { class: "chart", role: "img", "aria-label": "Решено задач по дням за последние 14 дней" },
    s.days.map((d) => {
      const label = `${fmtDate(d.date)}: ${d.count} ${plural(d.count, "задача", "задачи", "задач")}`;
      return h(
        "div",
        { class: "chart-col", tabindex: 0, "data-tip": label, "aria-label": label },
        h("div", { class: "chart-track" }, h("div", { class: `chart-bar ${d.count ? "" : "empty"}`, style: `height:${d.count ? Math.max(6, (d.count / max) * 100) : 0}%` })),
        h("div", { class: "chart-day" }, d.date.getDate())
      );
    })
  );

  setView(
    h("h1", {}, "Статистика"),
    h("p", { class: "muted" }, `${me.username}${data.joinedAt ? " · с нами с " + new Date(data.joinedAt).toLocaleDateString("ru-RU") : ""}`),
    h(
      "div",
      { class: "tiles" },
      tile(`${s.solved}/${s.totalTasks}`, "Решено задач", `${Math.round((s.solved / s.totalTasks) * 100)}% курса`),
      tile(s.attempts ? `${accuracy}%` : "—", "Точность", `${s.correct} верных из ${s.attempts} попыток`),
      tile(String(s.firstTry), "С первой попытки", s.solved ? `${Math.round((s.firstTry / s.solved) * 100)}% решённых` : null),
      tile(`${s.streak}`, `${plural(s.streak, "день", "дня", "дней")} подряд`, `всего активных дней: ${s.activeDays}`)
    ),
    h("h2", {}, "Решено задач по дням"),
    h("div", { class: "card" }, chart, h("p", { class: "muted small chart-note" }, "Последние 14 дней. Наведите на столбик, чтобы увидеть число.")),
    h("h2", {}, "Прогресс по уровням"),
    h(
      "div",
      { class: "card level-stats" },
      s.perLevel.map((l) =>
        h(
          "div",
          { class: "level-stat" },
          h("div", { class: "level-stat-head" }, h("span", {}, `${l.id}. ${l.title}`), h("span", { class: "muted" }, `${l.solved}/${l.total}`)),
          progressBar(l.solved, l.total)
        )
      )
    ),
    h(
      "div",
      { class: "two-col" },
      h(
        "section",
        {},
        h("h2", {}, "Самые трудные задачи"),
        s.hardest.length
          ? h(
              "ul",
              { class: "card list" },
              s.hardest.map((t) =>
                h("li", {}, h("a", { href: `#/task/${t.id}` }, `${t.id}. ${t.title}`), h("span", { class: "muted small" }, `${t.wrong} ${plural(t.wrong, "ошибка", "ошибки", "ошибок")}${t.solved ? " · решено" : ""}`))
              )
            )
          : h("p", { class: "muted" }, "Ошибок пока нет.")
      ),
      h(
        "section",
        {},
        h("h2", {}, "Недавно решённые"),
        s.recent.length
          ? h(
              "ul",
              { class: "card list" },
              s.recent.map((t) => h("li", {}, h("a", { href: `#/task/${t.id}` }, `${t.id}. ${t.title}`), h("span", { class: "muted small" }, fmtDate(t.at))))
            )
          : h("p", { class: "muted" }, "Пока ничего не решено.")
      )
    )
  );
}

// ---------- маршрутизация ----------

async function route() {
  const hash = location.hash || "#/";
  if (!me && hash !== "#/login" && hash !== "#/register") {
    location.hash = "#/login";
    return;
  }
  if (me && (hash === "#/login" || hash === "#/register")) return (location.hash = "#/");
  if (hash === "#/login") return viewAuth("login");
  if (hash === "#/register") return viewAuth("register");
  if (hash === "#/stats") return viewStats();

  try {
    await loadLevels();
  } catch (e) {
    return setView(h("p", { class: "error" }, e.message));
  }
  let m = hash.match(/^#\/level\/(\d+)(?:\/(theory|tasks))?$/);
  if (m) return viewLevel(Number(m[1]), m[2]);
  m = hash.match(/^#\/task\/(.+)$/);
  if (m) return viewTask(decodeURIComponent(m[1]));
  viewDashboard();
}

window.addEventListener("hashchange", route);

(async () => {
  try {
    me = (await api("/me")).user;
  } catch {
    me = null;
  }
  renderUserBox();
  route();
})();
