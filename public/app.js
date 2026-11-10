import { Terminal } from "./terminal.js";

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

// Текст задачи: `код` → <code>, переносы строк сохраняются. Всё через textContent — без innerHTML.
function rich(text) {
  const p = h("div", { class: "rich" });
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
    h("span", { class: "muted" }, me.username),
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

// ---------- экраны ----------

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

function viewDashboard() {
  const totalSolved = levels.reduce((s, l) => s + l.solvedCount, 0);
  const total = levels.reduce((s, l) => s + l.total, 0);
  setView(
    h(
      "section",
      { class: "intro" },
      h("h1", {}, "Путь в кибербезопасность"),
      h("p", { class: "muted" }, `4 уровня. Решено ${totalSolved} из ${total} задач.`),
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
              l.unlocked
                ? `Решено ${l.solvedCount}/${l.total}. Для следующего уровня нужно ${l.required}.`
                : "Закрыт. Пройдите предыдущий уровень."
            )
          )
        )
      )
    )
  );
}

function progressBar(value, max) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return h(
    "div",
    { class: "bar", role: "progressbar", "aria-valuenow": value, "aria-valuemin": 0, "aria-valuemax": max },
    h("div", { class: "bar-fill", style: `width:${pct}%` })
  );
}

function viewLevel(id) {
  const level = levels.find((l) => l.id === id);
  if (!level || !level.unlocked) return (location.hash = "#/");
  setView(
    h("a", { href: "#/", class: "back" }, "← Все уровни"),
    h("h1", {}, `Уровень ${level.id}. ${level.title}`),
    h("p", { class: "muted" }, level.subtitle),
    progressBar(level.solvedCount, level.total),
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

function viewTask(taskId) {
  const level = levels.find((l) => l.tasks.some((t) => t.id === taskId));
  if (!level) return (location.hash = "#/");
  const idx = level.tasks.findIndex((t) => t.id === taskId);
  const task = level.tasks[idx];
  const nextTask = level.tasks[idx + 1];

  const result = h("div", { class: "result", "aria-live": "polite" });
  const hintBox = h("p", { class: "hint", hidden: true }, task.hint);
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
      h("button", { class: "btn ghost", type: "button", onclick: () => (hintBox.hidden = !hintBox.hidden) }, "Подсказка")
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

// ---------- маршрутизация ----------

async function route() {
  const hash = location.hash || "#/";
  if (!me && !hash.startsWith("#/login") && !hash.startsWith("#/register")) {
    location.hash = "#/login";
    return;
  }
  if (me && (hash === "#/login" || hash === "#/register")) return (location.hash = "#/");
  if (hash === "#/login") return viewAuth("login");
  if (hash === "#/register") return viewAuth("register");

  try {
    await loadLevels();
  } catch (e) {
    return setView(h("p", { class: "error" }, e.message));
  }
  const m = hash.match(/^#\/(level|task)\/(.+)$/);
  if (m && m[1] === "level") return viewLevel(Number(m[2]));
  if (m && m[1] === "task") return viewTask(decodeURIComponent(m[2]));
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
