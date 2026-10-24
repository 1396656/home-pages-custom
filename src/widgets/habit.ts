import { App, Notice, Setting, TFile, normalizePath, setIcon } from "obsidian";
import type HomePagesPlugin from "../main";
import type { WidgetInstance } from "../types";
import { MONTH_LABELS, buildRecentDays, parseIsoDate, toIsoDate, todayIso } from "../utils/date";
import { ensureFolder, findDailyNote, getOrCreateDailyNote } from "../utils/vault";
import { addPathSetting, addTextareaSetting } from "../ui/settingHelpers";
import { WidgetContext, WidgetDefinition, normalizeWith, toStringList } from "./types";

export type HabitRange = "week" | "month" | "year";
/** plugin=插件数据；daily=当天日记；file=文件夹内按月命名的笔记（如 2026-10.md）。 */
export type HabitStorage = "plugin" | "daily" | "file";
/** 对某个习惯项（任务行）的操作。 */
export type TaskAction = "check" | "uncheck" | "add" | "remove";

export interface HabitConfig extends Record<string, unknown> {
  habits: string[];
  range: HabitRange;
  storage: HabitStorage;
  checkins: Record<string, string[]>;
  heading: string;
  /** file 模式的文件夹路径。 */
  folder: string;
}

const DEFAULTS: HabitConfig = {
  habits: ["早起", "运动", "阅读", "复盘"],
  range: "year",
  storage: "plugin",
  checkins: {},
  heading: "## 习惯打卡",
  folder: ""
};

const RANGE_DAYS: Record<HabitRange, number> = { week: 7, month: 30, year: 371 };
const RANGE_LABEL: Record<HabitRange, string> = { week: "近 7 天", month: "近 30 天", year: "近一年" };
const WEEKDAY_CHARS = ["日", "一", "二", "三", "四", "五", "六"];

/** 规范化习惯打卡配置；供组件自身与跨卡片调用（如番茄时钟）共用。 */
function normalizeHabitConfig(raw: Record<string, unknown>): HabitConfig {
  const config = normalizeWith(DEFAULTS, raw);
  config.habits = toStringList(config.habits, 12);
  if (config.habits.length === 0) config.habits = [...DEFAULTS.habits];
  config.range = config.range === "week" || config.range === "month" ? config.range : "year";
  config.storage = config.storage === "daily" ? "daily" : config.storage === "file" ? "file" : "plugin";
  config.heading = config.heading.trim() || DEFAULTS.heading;
  config.folder = String(config.folder ?? "").trim();
  const checkins: Record<string, string[]> = {};
  for (const [date, list] of Object.entries(config.checkins ?? {})) {
    if (parseIsoDate(date) && Array.isArray(list)) checkins[date] = list.map((item) => String(item));
  }
  config.checkins = checkins;
  return config;
}

/** 某一天的任务：tasks 为该天全部任务（含未完成），done 为已完成集合。 */
interface HabitDay {
  tasks: string[];
  done: Set<string>;
}

/** 一次渲染需要的全部数据。 */
interface HabitSourceData {
  done: Map<string, Set<string>>;
  tasks: Map<string, string[]>;
  /** file 模式：笔记里存在该日期的标题；其他模式恒为范围内的全部日期。 */
  present: Set<string>;
  /** 展示用的习惯项：设置里的列表 + 笔记里出现的任务。 */
  habits: string[];
}

export const habitWidget: WidgetDefinition<HabitConfig> = {
  kind: "habit",
  name: "习惯打卡",
  description: "今日打卡 + GitHub 风格热力图；可存在插件里、写入每日日记，或读写按月整理的笔记文件夹。",
  icon: "badge-check",
  accent: "#16a34a",
  defaultSize: { w: 6, h: 7 },
  defaultConfig: () => ({ ...DEFAULTS, habits: [...DEFAULTS.habits], checkins: {} }),
  normalizeConfig: normalizeHabitConfig,

  async render(body, ctx) {
    const { config } = ctx;
    const today = todayIso();
    const days = buildRecentDays(RANGE_DAYS[config.range]);
    const data = await loadHabitData(ctx, days);
    if (!ctx.isAlive()) return;
    const sourceLabel = config.storage === "daily" ? "Daily Note" : config.storage === "file" ? "月份笔记" : "本地记录";
    ctx.setSubtitle(`${sourceLabel} · ${RANGE_LABEL[config.range]}`);

    const wrap = body.createDiv({ cls: `hp-habit is-range-${config.range}` });
    const toolbar = wrap.createDiv({ cls: "hp-habit-toolbar" });
    // 本地记录有完整历史；其他模式只读取了当前范围内的笔记，连续天数最多数到范围开头。
    const habitSet = new Set(data.habits);
    const streak = config.storage === "plugin"
      ? habitStreak((iso) => (config.checkins[iso] ?? []).some((habit) => habitSet.has(habit)), today)
      : habitStreak((iso) => (data.done.get(iso)?.size ?? 0) > 0, today, days.length);
    if (streak > 0) {
      const badge = toolbar.createSpan({ cls: "hp-habit-streak", attr: { title: "连续有打卡的天数（今天还没打卡不算中断）" } });
      setIcon(badge.createSpan({ cls: "hp-habit-streak-icon" }), "flame");
      badge.createSpan({ text: `连续 ${streak} 天` });
    }
    const isFile = config.storage === "file";
    const noteButton = toolbar.createEl("button", {
      cls: "hp-pill",
      text: isFile ? "月记" : "日记",
      attr: { type: "button", title: isFile ? "打开今天的月份笔记" : "打开今天的日记" }
    });
    noteButton.addEventListener("click", () => void openSourceNote(ctx, today));
    for (const range of ["week", "month", "year"] as HabitRange[]) {
      const button = toolbar.createEl("button", {
        cls: `hp-pill${config.range === range ? " is-active" : ""}`,
        text: range === "week" ? "周" : range === "month" ? "月" : "年",
        attr: { type: "button" }
      });
      button.addEventListener("click", () => {
        if (config.range === range) return;
        void ctx.saveConfig({ range }).then(() => ctx.rerender());
      });
    }

    if (isFile && !config.folder) {
      wrap.createDiv({ cls: "hp-habit-hint", text: "请先在卡片设置里选择「月份笔记文件夹」：每月一篇，文件名如 2026-10.md，日期写成标题，标题下的任务即打卡项。" });
      return;
    }

    const todayRow = wrap.createDiv({ cls: "hp-habit-today" });
    todayRow.createDiv({ cls: "hp-habit-today-label", text: "今日" });
    const todayDone = data.done.get(today) ?? new Set<string>();
    // 月份笔记模式只看今天这一节的任务；其他模式才用设置里的习惯列表。
    const todayTasks = isFile ? (data.tasks.get(today) ?? []) : data.habits;
    const editorHabits = isFile ? [] : data.habits;
    if (isFile && todayTasks.length === 0) {
      todayRow.createDiv({ cls: "hp-habit-today-empty", text: "今天还没有任务" });
    }
    for (const habit of todayTasks) {
      const done = todayDone.has(habit);
      const chip = todayRow.createEl("button", { cls: `hp-habit-chip${done ? " is-done" : ""}`, attr: { type: "button" } });
      setIcon(chip.createSpan({ cls: "hp-habit-chip-icon" }), done ? "check" : "circle");
      chip.createSpan({ text: habit });
      chip.addEventListener("click", () => {
        void mutateHabit(ctx, today, habit, done ? "uncheck" : "check").then((ok) => {
          if (ok) ctx.rerender();
        });
      });
    }
    if (isFile) {
      const addChip = todayRow.createEl("button", {
        cls: "hp-habit-chip hp-habit-chip-add",
        attr: { type: "button", title: "添加任务并写入今天的月份笔记" }
      });
      setIcon(addChip.createSpan({ cls: "hp-habit-chip-icon" }), "plus");
      addChip.createSpan({ text: "添加" });
      addChip.addEventListener("click", () => {
        openDayEditor(ctx, today, todayDone, todayTasks, addChip, editorHabits);
      });
    }

    renderCalendar(wrap, ctx, days, data, today, editorHabits);
  },

  renderSettings(container, ctx) {
    const { config } = ctx;
    addTextareaSetting(container, {
      name: "习惯列表",
      desc: "一行一个，最多 12 个。仅用于「本地记录」和「Daily Note」模式；月份笔记模式直接以当天标题下的任务为准。",
      value: config.habits.join("\n"),
      rows: 5,
      onChange: (value) => ctx.update({ habits: toStringList(value, 12) })
    });
    new Setting(container).setName("默认时间范围")
      .addDropdown((dropdown) => dropdown
        .addOptions({ week: "近 7 天", month: "近 30 天", year: "近一年" })
        .setValue(config.range)
        .onChange((value) => ctx.update({ range: value === "week" || value === "month" ? value : "year" })));
    new Setting(container).setName("数据存储位置")
      .setDesc("本地记录：保存在插件数据中，零配置。Daily Note：读写当天日记里的打卡任务块。月份笔记：读写所选文件夹里按月命名的笔记，日期标题下的任务就是打卡项。")
      .addDropdown((dropdown) => dropdown
        .addOptions({ plugin: "本地记录（插件数据）", daily: "Daily Note（每日日记）", file: "月份笔记（文件夹）" })
        .setValue(config.storage)
        .onChange((value) => {
          const storage: HabitStorage = value === "daily" ? "daily" : value === "file" ? "file" : "plugin";
          // 月份笔记按月一篇，默认先看当月，避免整年热力图几乎全是灰色占位。
          ctx.update(storage === "file" && config.range === "year" ? { storage, range: "month" } : { storage });
          ctx.refresh();
        }));
    addPathSetting(container, ctx.app, {
      name: "月份笔记文件夹",
      desc: "文件夹里每月一篇，文件名如 2026-10.md；文件内每个日期写成标题（## 2026-10-01| 星期四），标题下的 - [ ] 任务就是习惯。勾选、添加、删除都会直接写回笔记。",
      value: config.folder,
      placeholder: "例如：习惯打卡",
      suggest: { files: false, folders: true },
      onChange: (value) => ctx.update({ folder: value })
    });
    new Setting(container).setName("日记中的打卡标题").setDesc("Daily Note 模式下托管的标题行，标题下的 - [ ] 任务即为习惯。")
      .addText((text) => text.setValue(config.heading).onChange((value) => ctx.update({ heading: value.trim() || DEFAULTS.heading })));
    const count = Object.values(config.checkins).reduce((sum, list) => sum + list.length, 0);
    new Setting(container).setName("清空本地打卡记录").setDesc(`当前共 ${count} 条本地记录（不影响日记与月份笔记）。`)
      .addButton((button) => button.setButtonText("清空").setWarning().onClick(() => {
        ctx.update({ checkins: {} });
        ctx.refresh();
        new Notice("本地打卡记录已清空（保存后生效）");
      }));
  }
};

/** 截至今天的连续打卡天数；今天还没打卡时从昨天往回数，不算中断。 */
export function habitStreak(isDone: (iso: string) => boolean, today: string, limit = 3660): number {
  const cursor = parseIsoDate(today);
  if (!cursor) return 0;
  if (!isDone(today)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (streak < limit && isDone(toIsoDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ---- 数据加载 --------------------------------------------------------------

async function loadHabitData(ctx: WidgetContext<HabitConfig>, days: string[]): Promise<HabitSourceData> {
  const { config } = ctx;
  const empty: HabitSourceData = {
    done: new Map(),
    tasks: new Map(),
    present: new Set(),
    habits: [...config.habits]
  };
  if (config.storage === "file") {
    if (!config.folder) return empty;
    return loadFolderData(ctx.app, config.folder, days, config.habits);
  }
  const habitSet = new Set(config.habits);
  const done = new Map<string, Set<string>>();
  if (config.storage === "plugin") {
    for (const date of days) {
      done.set(date, new Set((config.checkins[date] ?? []).filter((name) => habitSet.has(name))));
    }
  } else {
    await mapWithConcurrency(days, 6, async (date) => {
      const file = findDailyNote(ctx.app, date);
      const checked = file ? await readDoneFromDaily(ctx.app, file, config.heading) : [];
      done.set(date, new Set(checked.filter((name) => habitSet.has(name))));
    });
  }
  return {
    done,
    tasks: new Map<string, string[]>(days.map((date): [string, string[]] => [date, [...config.habits]])),
    present: new Set(days),
    habits: [...config.habits]
  };
}

/** 读取范围内每个月的月份笔记（如 2026-10.md），按日期汇总任务。 */
async function loadFolderData(
  app: App,
  folder: string,
  days: string[],
  configured: string[]
): Promise<HabitSourceData> {
  const done = new Map<string, Set<string>>();
  const tasks = new Map<string, string[]>();
  const present = new Set<string>();
  const daySet = new Set(days);
  const months = [...new Set(days.map((date) => date.slice(0, 7)))];
  await mapWithConcurrency(months, 4, async (month) => {
    const file = findMonthFile(app, folder, month);
    if (!file) return;
    let source = "";
    try {
      source = await app.vault.cachedRead(file);
    } catch {
      return;
    }
    for (const [date, day] of parseMonthSource(source)) {
      if (!daySet.has(date)) continue;
      done.set(date, day.done);
      tasks.set(date, day.tasks);
      present.add(date);
    }
  });
  return { done, tasks, present, habits: [...configured] };
}

/** 文件夹里某个月（YYYY-MM）对应的笔记；文件名兼容 2026-10.md / 2026年10月.md / 202610.md。 */
export function findMonthFile(app: App, folder: string, month: string): TFile | null {
  const trimmed = folder.trim();
  const dir = normalizePath(trimmed || "/");
  const expected = normalizePath(trimmed ? `${trimmed}/${month}.md` : `${month}.md`);
  const direct = app.vault.getAbstractFileByPath(expected);
  if (direct instanceof TFile) return direct;
  const [year, mm] = month.split("-");
  const compact = `${year}${Number(mm)}`;
  const padded = `${year}${mm}`;
  for (const file of app.vault.getMarkdownFiles()) {
    if ((file.parent?.path ?? "/") !== dir) continue;
    const digits = file.basename.replace(/[^0-9]/g, "");
    if (digits === compact || digits === padded) return file;
  }
  return null;
}

// ---- 写入 ------------------------------------------------------------------

async function mutateHabit(
  ctx: WidgetContext<HabitConfig>,
  date: string,
  habit: string,
  action: TaskAction
): Promise<boolean> {
  const { config } = ctx;
  try {
    if (config.storage === "file") {
      const file = await ensureMonthFile(ctx.app, config.folder, date);
      await ctx.app.vault.process(file, (source) => updateDateTask(source, date, habit, action));
      return true;
    }
    if (config.storage === "daily") {
      if (action === "add" || action === "remove") return false;
      const file = await getOrCreateDailyNote(ctx.app, date);
      await ctx.app.vault.process(file, (source) => updateHabitBlock(source, config.heading, config.habits, habit, action === "check"));
      return true;
    }
    const checkins = { ...config.checkins };
    const current = new Set(checkins[date] ?? []);
    if (action === "check") current.add(habit);
    else current.delete(habit);
    checkins[date] = [...current];
    await ctx.saveConfig({ checkins });
    return true;
  } catch (error) {
    console.error("Home Pages: failed to write habit checkin", error);
    new Notice("写入打卡记录失败，请检查存储设置");
    return false;
  }
}

async function ensureMonthFile(app: App, folder: string, date: string): Promise<TFile> {
  const month = date.slice(0, 7);
  const existing = findMonthFile(app, folder, month);
  if (existing) return existing;
  const trimmed = folder.trim();
  if (trimmed) await ensureFolder(app, trimmed);
  const path = normalizePath(trimmed ? `${trimmed}/${month}.md` : `${month}.md`);
  return app.vault.create(path, "");
}

/** 把弹层里累积的改动一次性写回月份笔记；没有文件且只是取消勾选 / 删除时什么都不写。 */
async function flushDateTasks(
  ctx: WidgetContext<HabitConfig>,
  date: string,
  actions: Map<string, TaskAction>
): Promise<boolean> {
  if (actions.size === 0) return true;
  try {
    const existing = findMonthFile(ctx.app, ctx.config.folder, date.slice(0, 7));
    const needsCreate = [...actions.values()].some((action) => action === "check" || action === "add");
    if (!existing && !needsCreate) return true;
    const file = existing ?? (await ensureMonthFile(ctx.app, ctx.config.folder, date));
    await ctx.app.vault.process(file, (source) => {
      let next = source;
      for (const [task, action] of actions) next = updateDateTask(next, date, task, action);
      return next;
    });
    return true;
  } catch (error) {
    console.error("Home Pages: failed to write habit month note", error);
    new Notice("写入月份笔记失败，请检查文件夹设置");
    return false;
  }
}

async function openDaily(ctx: WidgetContext<HabitConfig>, date: string): Promise<void> {
  try {
    const file = await getOrCreateDailyNote(ctx.app, date);
    await ctx.openPath(file.path);
  } catch (error) {
    console.error("Home Pages: failed to open daily note", error);
    new Notice("打开日记失败");
  }
}

/** 工具栏的「日记 / 月记」按钮：Daily Note 打开当天日记，月份笔记打开当月文件。 */
async function openSourceNote(ctx: WidgetContext<HabitConfig>, date: string): Promise<void> {
  if (ctx.config.storage !== "file") {
    await openDaily(ctx, date);
    return;
  }
  const file = findMonthFile(ctx.app, ctx.config.folder, date.slice(0, 7));
  if (file) {
    await ctx.openPath(file.path);
    return;
  }
  if (ctx.config.folder) {
    await ctx.openPath(ctx.config.folder);
    return;
  }
  new Notice("还没有选择月份笔记文件夹");
}

// ---- 渲染 ------------------------------------------------------------------

function renderCalendar(
  wrap: HTMLElement,
  ctx: WidgetContext<HabitConfig>,
  days: string[],
  data: HabitSourceData,
  today: string,
  editorHabits: string[]
): void {
  const isFile = ctx.config.storage === "file";
  const fallbackTotal = Math.max(1, data.habits.length);
  const first = parseIsoDate(days[0]);
  const startDow = first ? first.getDay() : 0;
  const weeks = Math.ceil((startDow + days.length) / 7);
  const padded: Array<string | null> = [];
  for (let i = 0; i < startDow; i++) padded.push(null);
  for (const day of days) padded.push(day);
  while (padded.length < weeks * 7) padded.push(null);

  // 每列第一个有效日期落在新月份时标注月份。
  const monthLabels: string[] = Array.from({ length: weeks }, () => "");
  let lastMonth = -1;
  for (let week = 0; week < weeks; week++) {
    for (let row = 0; row < 7; row++) {
      const day = padded[week * 7 + row];
      if (!day) continue;
      const month = parseIsoDate(day)?.getMonth() ?? -1;
      if (month !== lastMonth) {
        monthLabels[week] = MONTH_LABELS[month] ?? "";
        lastMonth = month;
      }
      break;
    }
  }

  const cal = wrap.createDiv({ cls: "hp-habit-cal" });
  const dow = cal.createDiv({ cls: "hp-habit-dow" });
  for (const label of ["日", "一", "二", "三", "四", "五", "六"]) dow.createDiv({ cls: "hp-habit-dow-label", text: label });
  const right = cal.createDiv({ cls: "hp-habit-cal-right" });
  const monthRow = right.createDiv({ cls: "hp-habit-month-row" });
  monthRow.style.gridTemplateColumns = `repeat(${weeks}, var(--hp-cell))`;
  for (const label of monthLabels) monthRow.createDiv({ cls: "hp-habit-month-label", text: label });
  const grid = right.createDiv({ cls: "hp-habit-grid" });
  for (const day of padded) {
    if (!day) {
      grid.createDiv({ cls: "hp-habit-cell is-empty" });
      continue;
    }
    if (isFile && !data.present.has(day)) {
      // 笔记里没有这一天的标题：灰色占位，不参与打卡。
      grid.createDiv({ cls: "hp-habit-cell is-void", attr: { title: `${day} · 笔记中暂无内容` } });
      continue;
    }
    const done = data.done.get(day) ?? new Set<string>();
    const total = isFile ? (data.tasks.get(day)?.length ?? 0) : fallbackTotal;
    const level = done.size <= 0 || total <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((done.size / total) * 4)));
    const cell = grid.createDiv({
      cls: `hp-habit-cell level-${level}${day === today ? " is-today" : ""}`,
      attr: { title: `${day} · ${done.size}/${total}` }
    });
    if (ctx.config.storage === "daily") {
      cell.addEventListener("click", () => void openDaily(ctx, day));
    } else {
      cell.addEventListener("click", () => openDayEditor(ctx, day, done, data.tasks.get(day) ?? [], cell, editorHabits));
    }
  }
  window.requestAnimationFrame(() => {
    cal.scrollLeft = cal.scrollWidth;
  });

  // 热力图按卡片可用高度自适应：格子边长 = 剩余高度 / 7，卡片缩放时实时重算。
  // cal 是 flex 布局里的剩余高度区域，所以用它的高度反推格子大小即可。
  const fitCells = (): void => {
    const height = cal.clientHeight;
    if (height <= 0) return;
    // 预留：cal 上下 padding 8 + 月份行 14 + 月份行与网格间距 3 + 星期列顶部对齐 17 + 6 个行间距 18。
    const usable = height - 8 - 14 - 3 - 17 - 18;
    const size = Math.max(9, Math.min(64, Math.floor(usable / 7)));
    wrap.style.setProperty("--hp-cell", `${size}px`);
    // 格子变大后总宽度也变了，重新贴到最右端，保证默认看到的是最新日期。
    if (cal.scrollWidth > cal.clientWidth) cal.scrollLeft = cal.scrollWidth;
  };
  requestAnimationFrame(fitCells);
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => fitCells());
    observer.observe(cal);
    ctx.registerCleanup(() => observer.disconnect());
  }
}

/** 当前打开的面板；同一时间只保留一个，打开新的前先把旧的收尾（写回未保存的改动）。 */
let activePopover: { close: (mode: "refresh" | "discard") => void } | null = null;

/** 点热力图格子弹出的小面板：勾选打卡；月份笔记模式下还能新增 / 删除任务（直接写回笔记）。 */
function openDayEditor(
  ctx: WidgetContext<HabitConfig>,
  date: string,
  done: Set<string>,
  tasks: string[],
  anchor: HTMLElement,
  habits: string[]
): void {
  activePopover?.close("refresh");
  activePopover = null;
  const isFile = ctx.config.storage === "file";
  const popover = document.body.createDiv({ cls: "hp-habit-popover" });
  popover.createDiv({ cls: "hp-habit-popover-title", text: date });
  const list = popover.createDiv({ cls: "hp-habit-popover-list" });
  const checkedSet = new Set(done);
  const taskSet = new Set(tasks);
  // 月份笔记模式：先改本地状态，关闭面板时一次性写回，避免每次勾选都触发卡片重绘把面板关掉。
  const pending = new Map<string, TaskAction>();
  let dirty = false;
  // close 在下方定义，这里先占位，供「添加」按钮提前调用。
  let closePopover: (mode: "refresh" | "discard") => void = () => {};

  const queue = (habit: string, action: TaskAction): void => {
    dirty = true;
    if (!isFile) {
      void mutateHabit(ctx, date, habit, action);
      return;
    }
    pending.delete(habit);
    pending.set(habit, action);
  };

  const paint = (): void => {
    list.empty();
    const names = [...habits];
    for (const name of taskSet) {
      if (!names.includes(name)) names.push(name);
    }
    for (const habit of names) {
      const row = list.createDiv({ cls: "hp-habit-popover-row" });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = checkedSet.has(habit);
      const apply = (checked: boolean): void => {
        if (checked) checkedSet.add(habit);
        else checkedSet.delete(habit);
        queue(habit, checked ? "check" : "uncheck");
      };
      checkbox.addEventListener("change", () => apply(checkbox.checked));
      row.createSpan({ cls: "hp-habit-popover-name", text: habit });
      row.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        if (target === checkbox || target.closest("button")) return;
        checkbox.checked = !checkbox.checked;
        apply(checkbox.checked);
      });
      if (isFile && taskSet.has(habit)) {
        const remove = row.createEl("button", {
          cls: "clickable-icon hp-habit-popover-del",
          attr: { type: "button", title: "从笔记里删除这个任务", "aria-label": "删除任务" }
        });
        setIcon(remove, "trash-2");
        remove.addEventListener("click", (event) => {
          event.preventDefault();
          checkedSet.delete(habit);
          taskSet.delete(habit);
          queue(habit, "remove");
          paint();
        });
      }
    }
  };
  paint();

  if (isFile) {
    const addRow = popover.createDiv({ cls: "hp-habit-popover-add" });
    const input = addRow.createEl("input", { attr: { type: "text", placeholder: "新任务名称" } });
    const addButton = addRow.createEl("button", { cls: "hp-pill", text: "添加", attr: { type: "button" } });
    const submit = (): void => {
      const name = input.value.trim();
      if (!name) return;
      queue(name, "add");
      // 添加完直接收起面板，写入与刷新在 close 里完成。
      closePopover("refresh");
    };
    addButton.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      submit();
    });
  }

  let closed = false;
  // refresh=改过内容，收尾后刷新卡片；discard=卡片本来就要重绘，不再触发刷新。
  const close = (mode: "refresh" | "discard"): void => {
    if (closed) return;
    closed = true;
    if (activePopover === handle) activePopover = null;
    popover.remove();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    const actions = new Map(pending);
    pending.clear();
    const refresh = mode === "refresh" && dirty;
    if (actions.size > 0) {
      void flushDateTasks(ctx, date, actions).then((ok) => {
        if (ok && refresh) ctx.rerender();
      });
      return;
    }
    if (refresh) ctx.rerender();
  };
  const onDown = (event: MouseEvent): void => {
    if (!popover.contains(event.target as Node)) close("refresh");
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close("refresh");
  };
  const handle = { close };
  closePopover = close;
  activePopover = handle;
  window.setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  ctx.registerCleanup(() => close("discard"));
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 8));
  const below = rect.bottom + 6;
  const top = below + popover.offsetHeight > window.innerHeight - 8 ? rect.top - 8 - popover.offsetHeight : below;
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(8, top)}px`;
}

// ---- Daily Note 读写 --------------------------------------------------------

async function readDoneFromDaily(app: App, file: TFile, heading: string): Promise<string[]> {
  let source = "";
  try {
    source = await app.vault.cachedRead(file);
  } catch {
    return [];
  }
  const block = getHabitBlock(source, heading);
  if (block !== null) {
    const done: string[] = [];
    for (const line of block.split(/\r?\n/g)) {
      const item = parseHabitLine(line);
      if (item?.done) done.push(item.name);
    }
    return done;
  }
  // 兼容 frontmatter habits: [早起, 阅读] 或 habits: {早起: true}。
  const raw: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.habits;
  if (Array.isArray(raw)) return (raw as unknown[]).map((item) => String(item).trim()).filter(Boolean);
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value === true || value === "true" || value === 1)
      .map(([key]) => key);
  }
  return [];
}

function getHabitBlock(source: string, heading: string): string | null {
  const lines = source.split(/\r?\n/g);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex < 0) return null;
  const collected: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index++) {
    if (/^#{1,6}\s/.test(lines[index])) break;
    collected.push(lines[index]);
  }
  return collected.join("\n");
}

function parseHabitLine(line: string): { name: string; done: boolean } | null {
  const match = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/);
  if (!match) return null;
  const name = match[2].trim().split(/\s+[A-Za-z][\w-]*::/)[0]?.trim();
  if (!name) return null;
  return { name, done: match[1].toLowerCase() === "x" };
}

function habitLine(name: string, checked: boolean): string {
  return `- [${checked ? "x" : " "}] ${name}`;
}

/** 只改动标题下的任务块；没有块则在文末追加一个完整的块。 */
export function updateHabitBlock(source: string, heading: string, habits: string[], habit: string, checked: boolean): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/g);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex < 0) {
    const names = toStringList([...habits, habit], 20);
    const block = [heading, ...names.map((name) => habitLine(name, name === habit ? checked : false))].join(newline);
    const trimmed = lines.join(newline).replace(/\s+$/g, "");
    return `${trimmed ? `${trimmed}${newline}${newline}` : ""}${block}${newline}`;
  }
  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index++) {
    if (/^#{1,6}\s/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
  }
  let found = false;
  let lastTaskIndex = headingIndex;
  for (let index = headingIndex + 1; index < sectionEnd; index++) {
    const item = parseHabitLine(lines[index]);
    if (!item) continue;
    lastTaskIndex = index;
    if (item.name === habit) {
      lines[index] = habitLine(habit, checked);
      found = true;
    }
  }
  if (!found) lines.splice(lastTaskIndex + 1, 0, habitLine(habit, checked));
  return lines.join(newline);
}

// ---- 月份笔记解析 / 读写 ----------------------------------------------------

function parseHeading(line: string): { level: number; text: string } | null {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!match) return null;
  return { level: match[1].length, text: match[2] };
}

/** 从标题文字里取日期：2026-10-01 / 2026/10/1 / 2026年10月1日 都可。 */
function dateFromHeading(text: string): string | undefined {
  const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return undefined;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const iso = `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return parseIsoDate(iso) ? iso : undefined;
}

/** 解析一个月度笔记：日期标题下的 - [ ] 任务，按日期归组。 */
export function parseMonthSource(source: string): Map<string, HabitDay> {
  const result = new Map<string, HabitDay>();
  let current: HabitDay | null = null;
  let currentLevel = 0;
  for (const line of source.split(/\r?\n/g)) {
    const heading = parseHeading(line);
    if (heading) {
      const date = dateFromHeading(heading.text);
      if (date) {
        let day = result.get(date);
        if (!day) {
          day = { tasks: [], done: new Set<string>() };
          result.set(date, day);
        }
        current = day;
        currentLevel = heading.level;
      } else if (!current || heading.level <= currentLevel) {
        // 日期标题之外的普通标题：同级或更高级时结束当前日期段落，子标题则继续沿用。
        current = null;
        currentLevel = 0;
      }
      continue;
    }
    if (!current) continue;
    const item = parseHabitLine(line);
    if (!item || current.tasks.includes(item.name)) continue;
    current.tasks.push(item.name);
    if (item.done) current.done.add(item.name);
  }
  return result;
}

/** 在指定日期标题下勾选 / 新增 / 删除一个任务；没有该日期标题时在文末补一段。 */
export function updateDateTask(source: string, date: string, task: string, action: TaskAction): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/g);
  let headingIndex = -1;
  let sectionLevel = 0;
  for (let index = 0; index < lines.length; index++) {
    const heading = parseHeading(lines[index]);
    if (!heading) continue;
    if (dateFromHeading(heading.text) === date) {
      headingIndex = index;
      sectionLevel = heading.level;
      break;
    }
  }
  if (headingIndex < 0) {
    if (action === "remove") return source;
    const weekday = parseIsoDate(date)?.getDay() ?? 0;
    const block = [`${"#".repeat(2)} ${date}| 星期${WEEKDAY_CHARS[weekday]}`, habitLine(task, action === "check")];
    const trimmed = lines.join(newline).replace(/\s+$/g, "");
    return `${trimmed ? `${trimmed}${newline}${newline}` : ""}${block.join(newline)}${newline}`;
  }
  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index++) {
    const heading = parseHeading(lines[index]);
    if (heading && heading.level <= sectionLevel) {
      sectionEnd = index;
      break;
    }
  }
  let found = false;
  let lastTaskIndex = -1;
  const removed: number[] = [];
  for (let index = headingIndex + 1; index < sectionEnd; index++) {
    const item = parseHabitLine(lines[index]);
    if (!item) continue;
    lastTaskIndex = index;
    if (item.name !== task) continue;
    found = true;
    if (action === "remove") removed.push(index);
    else if (action === "check" || action === "uncheck") lines[index] = habitLine(task, action === "check");
  }
  if (action === "remove") {
    for (let index = removed.length - 1; index >= 0; index--) lines.splice(removed[index], 1);
    return lines.join(newline);
  }
  if (!found) {
    const insertAt = lastTaskIndex >= 0 ? lastTaskIndex + 1 : headingIndex + 1;
    lines.splice(insertAt, 0, habitLine(task, action === "check"));
  }
  return lines.join(newline);
}

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  }));
}

// ---- 供其他卡片（如番茄时钟）调用：跨卡片自动打卡 -------------------------------

/** 找到第一个包含指定习惯名的习惯打卡卡片；没传名字就返回第一个习惯卡片。 */
export function findHabitWidget(plugin: HomePagesPlugin, habitName?: string): WidgetInstance | undefined {
  for (const page of plugin.settings.pages) {
    for (const widget of page.widgets) {
      if (widget.kind !== "habit") continue;
      if (!habitName) return widget;
      const config = normalizeHabitConfig(widget.config ?? {});
      if (config.habits.includes(habitName)) return widget;
    }
  }
  return undefined;
}

/** 汇总所有习惯打卡卡片里的习惯名，去重后返回，用于设置面板的下拉选择。 */
export function listHabitNames(plugin: HomePagesPlugin): string[] {
  const names = new Set<string>();
  for (const page of plugin.settings.pages) {
    for (const widget of page.widgets) {
      if (widget.kind !== "habit") continue;
      const config = normalizeHabitConfig(widget.config ?? {});
      for (const name of config.habits) names.add(name);
    }
  }
  return [...names];
}

/** 让番茄时钟等其他卡片可以在专注结束时，替某个习惯自动勾上今天的打卡。 */
export async function checkHabitForDate(
  plugin: HomePagesPlugin,
  habitName: string,
  date: string
): Promise<boolean> {
  const widget = findHabitWidget(plugin, habitName);
  if (!widget) return false;
  const config = normalizeHabitConfig(widget.config ?? {});
  const app = plugin.app;
  try {
    if (config.storage === "file") {
      const file = await ensureMonthFile(app, config.folder, date);
      await app.vault.process(file, (source) => updateDateTask(source, date, habitName, "check"));
      return true;
    }
    if (config.storage === "daily") {
      const file = await getOrCreateDailyNote(app, date);
      await app.vault.process(file, (source) => updateHabitBlock(source, config.heading, config.habits, habitName, true));
      return true;
    }
    const checkins = { ...config.checkins };
    const current = new Set(checkins[date] ?? []);
    current.add(habitName);
    checkins[date] = [...current];
    widget.config = { ...(widget.config ?? {}), checkins };
    await plugin.saveSettings();
    return true;
  } catch (error) {
    console.error("Home Pages: failed to auto-check habit", error);
    return false;
  }
}
