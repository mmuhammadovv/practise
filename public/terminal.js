// Учебный терминал прямо в браузере: виртуальная файловая система и базовые команды Linux.
// Весь вывод вставляется через textContent, поэтому HTML из файлов не выполняется.

const USER = "student";
const HOST = "srv";

const HELP = `Доступные команды:
  ls [-a] [-l] [путь]     список файлов (-a — со скрытыми)
  cd <путь>               перейти в папку (cd .. — на уровень вверх, cd ~ — домой)
  pwd                     где я сейчас
  cat <файл>              показать содержимое файла
  grep [-i] [-v] [-c] [-n] <шаблон> [файл]   найти строки с шаблоном
  find [путь] [-name <имя>] [-type f|d]      искать файлы (в имени можно *)
  head / tail [-n N]      первые / последние строки
  wc -l                   посчитать строки
  sort, uniq [-c]         отсортировать, убрать повторы (-c — посчитать)
  base64 [-d] [файл]      закодировать / раскодировать Base64
  ps                      список процессов
  echo, whoami, hostname, history, clear
Можно соединять команды через |, например:  grep Failed auth.log | wc -l`;

export class Terminal {
  constructor(root, config = {}) {
    this.root = root;
    this.processes = config.processes || [];
    this.home = `/home/${USER}`;
    this.history = [];
    this.histPos = 0;
    this.buildFs(config.files || {});
    this.cwd = this.nodes.has(config.cwd) ? config.cwd : this.home;
    this.render();
    this.print(`Учебный терминал. Введите help, чтобы увидеть команды.\n`);
  }

  // ---------- файловая система ----------

  buildFs(files) {
    this.nodes = new Map();
    const addDir = (p) => {
      if (this.nodes.has(p)) return;
      this.nodes.set(p, { type: "dir" });
      if (p !== "/") addDir(parentOf(p));
    };
    ["/", "/home", this.home, "/tmp", "/etc", "/var", "/var/log", "/usr", "/bin"].forEach(addDir);
    for (const [path, content] of Object.entries(files)) {
      if (path.endsWith("/")) {
        addDir(path.slice(0, -1) || "/");
      } else {
        addDir(parentOf(path));
        this.nodes.set(path, { type: "file", content });
      }
    }
  }

  resolve(p) {
    if (!p) return this.cwd;
    if (p === "~" || p.startsWith("~/")) p = this.home + p.slice(1);
    const parts = (p.startsWith("/") ? p : this.cwd + "/" + p).split("/");
    const out = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return "/" + out.join("/");
  }

  children(dir) {
    const prefix = dir === "/" ? "/" : dir + "/";
    const names = [];
    for (const path of this.nodes.keys()) {
      if (path !== dir && path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
        names.push(path.slice(prefix.length));
      }
    }
    return names.sort();
  }

  readFile(p) {
    const full = this.resolve(p);
    const node = this.nodes.get(full);
    if (!node) throw new Error(`${p}: Нет такого файла или каталога`);
    if (node.type === "dir") throw new Error(`${p}: Это каталог`);
    return node.content;
  }

  // ---------- интерфейс ----------

  render() {
    this.root.classList.add("term");
    this.root.innerHTML = "";
    this.out = document.createElement("pre");
    this.out.className = "term-out";
    const line = document.createElement("label");
    line.className = "term-line";
    this.promptEl = document.createElement("span");
    this.promptEl.className = "term-prompt";
    this.input = document.createElement("input");
    this.input.className = "term-input";
    this.input.setAttribute("autocomplete", "off");
    this.input.setAttribute("autocapitalize", "off");
    this.input.setAttribute("spellcheck", "false");
    this.input.setAttribute("aria-label", "Команда терминала");
    line.append(this.promptEl, this.input);
    this.root.append(this.out, line);
    this.updatePrompt();

    this.root.addEventListener("click", () => {
      if (!window.getSelection().toString()) this.input.focus();
    });
    this.input.addEventListener("keydown", (e) => this.onKey(e));
  }

  promptText() {
    const dir = this.cwd === this.home ? "~" : this.cwd.startsWith(this.home + "/") ? "~" + this.cwd.slice(this.home.length) : this.cwd;
    return `${USER}@${HOST}:${dir}$ `;
  }

  updatePrompt() {
    this.promptEl.textContent = this.promptText();
  }

  print(text, cls) {
    const span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text.endsWith("\n") || text === "" ? text : text + "\n";
    this.out.append(span);
    this.root.scrollTop = this.root.scrollHeight;
  }

  onKey(e) {
    if (e.key === "Enter") {
      const cmd = this.input.value;
      this.input.value = "";
      this.print(this.promptText() + cmd, "term-echo");
      if (cmd.trim()) {
        this.history.push(cmd);
        this.histPos = this.history.length;
        this.run(cmd);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (this.histPos > 0) this.input.value = this.history[--this.histPos];
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.histPos = Math.min(this.history.length, this.histPos + 1);
      this.input.value = this.history[this.histPos] || "";
    } else if (e.key === "Tab") {
      e.preventDefault();
      this.complete();
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      this.out.textContent = "";
    }
  }

  // Автодополнение имени файла по Tab
  complete() {
    const val = this.input.value;
    const m = val.match(/(\S*)$/);
    const word = m[1];
    const slash = word.lastIndexOf("/");
    const dirPart = slash >= 0 ? word.slice(0, slash + 1) : "";
    const base = slash >= 0 ? word.slice(slash + 1) : word;
    const dir = this.resolve(dirPart || ".");
    if (!this.nodes.has(dir)) return;
    const matches = this.children(dir).filter((n) => n.startsWith(base) && (base.startsWith(".") || !n.startsWith(".")));
    if (matches.length === 1) {
      const full = (dir === "/" ? "/" : dir + "/") + matches[0];
      const suffix = this.nodes.get(full).type === "dir" ? "/" : " ";
      this.input.value = val.slice(0, val.length - word.length) + dirPart + matches[0] + suffix;
    } else if (matches.length > 1) {
      this.print(this.promptText() + val, "term-echo");
      this.print(matches.join("  "));
    }
  }

  // ---------- выполнение ----------

  run(line) {
    const stages = splitPipes(line).map(tokenize);
    let stdin = null;
    for (const [name, ...args] of stages) {
      if (!name) continue;
      const fn = this.commands[name];
      if (!fn) {
        this.print(`${name}: команда не найдена. Введите help.`, "term-err");
        return;
      }
      try {
        stdin = fn.call(this, args, stdin);
      } catch (err) {
        this.print(`${name}: ${err.message}`, "term-err");
        return;
      }
      if (stdin === undefined) stdin = "";
    }
    if (stdin) this.print(stdin);
    this.updatePrompt();
  }

  get commands() {
    return {
      help: () => HELP,
      clear: () => {
        this.out.textContent = "";
        return "";
      },
      pwd: () => this.cwd,
      whoami: () => USER,
      hostname: () => HOST,
      id: () => `uid=1000(${USER}) gid=1000(${USER}) groups=1000(${USER})`,
      echo: (args) => args.join(" "),
      history: () => this.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join("\n"),

      cd: (args) => {
        const target = this.resolve(args[0] || "~");
        const node = this.nodes.get(target);
        if (!node) throw new Error(`${args[0]}: Нет такого файла или каталога`);
        if (node.type !== "dir") throw new Error(`${args[0]}: Это не каталог`);
        this.cwd = target;
        return "";
      },

      ls: (args) => {
        const { flags, rest } = parseFlags(args);
        const all = flags.has("a");
        const long = flags.has("l");
        const targets = rest.length ? rest : ["."];
        const blocks = targets.map((t) => {
          const full = this.resolve(t);
          const node = this.nodes.get(full);
          if (!node) throw new Error(`невозможно открыть '${t}': Нет такого файла или каталога`);
          let names = node.type === "dir" ? this.children(full) : [t];
          if (!all) names = names.filter((n) => !n.startsWith("."));
          else if (node.type === "dir") names = [".", "..", ...names];
          const fmt = (n) => {
            if (!long) return n;
            const p = node.type === "dir" ? this.resolve(full + "/" + n) : full;
            const nd = this.nodes.get(p) || { type: "dir" };
            const isDir = nd.type === "dir";
            const owner = p.startsWith(this.home) ? USER : "root";
            const size = isDir ? 4096 : new TextEncoder().encode(nd.content).length;
            return `${isDir ? "drwxr-xr-x" : "-rw-r--r--"} 1 ${owner.padEnd(7)} ${owner.padEnd(7)} ${String(size).padStart(5)} Nov 10 03:00 ${n}`;
          };
          const body = long ? names.map(fmt).join("\n") : names.join("  ");
          return targets.length > 1 ? `${t}:\n${body}` : body;
        });
        return blocks.join("\n\n");
      },

      cat: (args, stdin) => {
        if (!args.length) return stdin || "";
        return args.map((f) => this.readFile(f)).join("");
      },

      grep: (args, stdin) => {
        const { flags, rest } = parseFlags(args);
        const [pattern, ...files] = rest;
        if (pattern === undefined) throw new Error("укажите шаблон, например: grep Failed auth.log");
        let re;
        try {
          re = new RegExp(pattern, flags.has("i") ? "i" : "");
        } catch {
          re = new RegExp(escapeRe(pattern), flags.has("i") ? "i" : "");
        }
        const sources = files.length
          ? files.map((f) => ({ name: f, text: this.readFile(f) }))
          : [{ name: "", text: stdin || "" }];
        const out = [];
        let count = 0;
        for (const { name, text } of sources) {
          text.split("\n").forEach((l, i) => {
            if (l === "" && i === text.split("\n").length - 1) return;
            if (re.test(l) !== flags.has("v")) {
              count++;
              const pre = (files.length > 1 ? name + ":" : "") + (flags.has("n") ? i + 1 + ":" : "");
              out.push(pre + l);
            }
          });
        }
        return flags.has("c") ? String(count) : out.join("\n");
      },

      find: (args) => {
        let start = ".";
        let name = null;
        let type = null;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "-name" || args[i] === "-iname") name = args[++i];
          else if (args[i] === "-type") type = args[++i];
          else if (!args[i].startsWith("-")) start = args[i];
        }
        const root = this.resolve(start);
        if (!this.nodes.has(root)) throw new Error(`'${start}': Нет такого файла или каталога`);
        const re = name ? globToRe(name) : null;
        const shown = start.replace(/\/$/, "") || "/";
        const out = [];
        for (const [path, node] of [...this.nodes.entries()].sort()) {
          if (path !== root && !path.startsWith(root === "/" ? "/" : root + "/")) continue;
          if (type === "f" && node.type !== "file") continue;
          if (type === "d" && node.type !== "dir") continue;
          if (re && !re.test(path.split("/").pop())) continue;
          out.push(start.startsWith("/") ? path : shown + path.slice(root.length));
        }
        return out.join("\n");
      },

      head: (args, stdin) => this.slice(args, stdin, (lines, n) => lines.slice(0, n)),
      tail: (args, stdin) => this.slice(args, stdin, (lines, n) => lines.slice(-n)),

      wc: (args, stdin) => {
        const { rest } = parseFlags(args);
        const text = rest.length ? rest.map((f) => this.readFile(f)).join("") : stdin || "";
        const lines = text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
        return String(lines);
      },

      sort: (args, stdin) => {
        const { flags, rest } = parseFlags(args);
        const text = rest.length ? rest.map((f) => this.readFile(f)).join("") : stdin || "";
        let lines = lines_(text).sort();
        if (flags.has("n")) lines = lines_(text).sort((a, b) => parseFloat(a) - parseFloat(b));
        if (flags.has("r")) lines.reverse();
        return lines.join("\n");
      },

      uniq: (args, stdin) => {
        const { flags } = parseFlags(args);
        const out = [];
        for (const l of lines_(stdin || "")) {
          const last = out[out.length - 1];
          if (last && last.line === l) last.n++;
          else out.push({ line: l, n: 1 });
        }
        return out.map((o) => (flags.has("c") ? `${String(o.n).padStart(7)} ${o.line}` : o.line)).join("\n");
      },

      base64: (args, stdin) => {
        const { flags, rest } = parseFlags(args);
        const text = rest.length ? rest.map((f) => this.readFile(f)).join("") : stdin || "";
        if (flags.has("d")) {
          try {
            const bin = atob(text.replace(/\s+/g, ""));
            return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
          } catch {
            throw new Error("неверные входные данные");
          }
        }
        const bytes = new TextEncoder().encode(text);
        return btoa(String.fromCharCode(...bytes));
      },

      ps: () => {
        const list = this.processes.length
          ? this.processes
          : [
              { pid: 1, user: "root", cpu: "0.0", cmd: "/sbin/init" },
              { pid: 2048, user: USER, cpu: "0.0", cmd: "-bash" },
            ];
        const rows = list.map((p) => `${p.user.padEnd(9)} ${String(p.pid).padStart(5)} ${String(p.cpu).padStart(5)}  ${p.cmd}`);
        return [`USER        PID  %CPU  COMMAND`, ...rows].join("\n");
      },
    };
  }

  slice(args, stdin, pick) {
    let n = 10;
    const files = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-n") n = parseInt(args[++i], 10) || 10;
      else if (/^-\d+$/.test(args[i])) n = parseInt(args[i].slice(1), 10);
      else files.push(args[i]);
    }
    const text = files.length ? files.map((f) => this.readFile(f)).join("") : stdin || "";
    return pick(lines_(text), n).join("\n");
  }
}

// ---------- помощники ----------

function parentOf(p) {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

function lines_(text) {
  const l = text.split("\n");
  if (l[l.length - 1] === "") l.pop();
  return l;
}

function parseFlags(args) {
  const flags = new Set();
  const rest = [];
  for (const a of args) {
    if (/^-[a-zA-Z]+$/.test(a)) [...a.slice(1)].forEach((c) => flags.add(c));
    else rest.push(a);
  }
  return { flags, rest };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRe(glob) {
  return new RegExp("^" + glob.split("*").map(escapeRe).join(".*") + "$");
}

function splitPipes(line) {
  const parts = [];
  let cur = "";
  let quote = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "|") {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function tokenize(s) {
  const tokens = [];
  let cur = "";
  let quote = null;
  let has = false;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) tokens.push(cur);
      cur = "";
      has = false;
    } else cur += ch;
  }
  if (cur || has) tokens.push(cur);
  return tokens;
}
