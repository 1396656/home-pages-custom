import { Setting, TFile, setIcon } from "obsidian";
import { addPathSetting } from "../ui/settingHelpers";
import { todayIso } from "../utils/date";
import { stripFrontmatter } from "../utils/vault";
import { WidgetDefinition, normalizeWith, toStringList } from "./types";

export interface IdiomsConfig extends Record<string, unknown> {
  /** 成语词典笔记的路径，一篇笔记里用 ## 标题分隔多个成语。 */
  notePath: string;
  /** 默认隐藏释义（自测模式），点「看释义」再展开。 */
  hideMeaning: boolean;
  /** 内部状态：当天日期（跨天自动重置进度）。 */
  date: string;
  /** 内部状态：当天已点「确定」的成语。 */
  seen: string[];
}

const DEFAULTS: IdiomsConfig = {
  notePath: "成语积累.md",
  hideMeaning: false,
  date: "",
  seen: []
};

interface IdiomItem {
  /** 成语本身（## 标题去掉末尾冒号）。 */
  name: string;
  /** 释义正文（多条 bullet 会合并成多行）。 */
  meaning: string;
}

export const idiomsWidget: WidgetDefinition<IdiomsConfig> = {
  kind: "idioms",
  name: "成语复盘",
  description: "从成语笔记里按天随机抽一个成语和释义，点「确定」翻下一个。",
  icon: "book-open",
  accent: "#7c3aed",
  defaultSize: { w: 4, h: 6 },
  defaultConfig: () => ({ ...DEFAULTS }),
  normalizeConfig: (raw) => {
    const config = normalizeWith(DEFAULTS, raw);
    config.notePath = String(config.notePath ?? "").trim();
    config.hideMeaning = config.hideMeaning === true;
    config.seen = toStringList(config.seen, 2000);
    return config;
  },

  async render(body, ctx) {
    const { app, config } = ctx;
    const notePath = config.notePath.trim();
    const today = todayIso();
    // 跨天自动重置当天的进度。
    const seen = config.date === today ? config.seen : [];
    const seenSet = new Set(seen);

    const file = notePath ? app.vault.getAbstractFileByPath(notePath) : null;
    if (!(file instanceof TFile)) {
      ctx.setSubtitle("");
      const empty = body.createDiv({ cls: "hp-empty" });
      empty.createEl("p", { text: notePath ? `找不到笔记「${notePath}」` : "点击右上角齿轮，选择成语笔记" });
      empty.createEl("p", { cls: "hp-mistakes-hint", text: "笔记里用 ## 成语名 分节，下面写 - 释义：…… 即可。" });
      return;
    }

    let raw = "";
    try {
      raw = await app.vault.cachedRead(file);
    } catch {
      raw = "";
    }
    if (!ctx.isAlive()) return;

    const items = parseIdioms(raw);
    if (items.length === 0) {
      ctx.setSubtitle("0 个");
      body.createDiv({ cls: "hp-empty", text: "这篇笔记里没有解析到成语（需要 ## 标题 + 释义）" });
      return;
    }

    // 当天固定的随机顺序：按「日期 + 成语」哈希排序，同一天内刷新不会乱跳。
    const queue = [...items].sort((left, right) => hashSeed(`${today}|${left.name}`) - hashSeed(`${today}|${right.name}`));
    const remaining = queue.filter((item) => !seenSet.has(item.name));
    const current = remaining[0] ?? null;
    const doneCount = queue.length - remaining.length;
    ctx.setSubtitle(`成语 ${Math.min(doneCount + 1, queue.length)}/${queue.length}`);

    if (!current) {
      renderDone(body, queue.length, () => ctx.saveConfig({ date: today, seen: [] }).then(() => ctx.rerender()));
      return;
    }

    const wrap = body.createDiv({ cls: "hp-idiom" });
    const meta = wrap.createDiv({ cls: "hp-idiom-meta" });
    meta.createSpan({ cls: "hp-idiom-progress", text: `${doneCount + 1} / ${queue.length}` });

    wrap.createDiv({ cls: "hp-idiom-word", text: current.name });

    const meaning = wrap.createDiv({ cls: "hp-idiom-meaning" });
    let revealed = !config.hideMeaning;
    meaning.toggleClass("is-hidden", !revealed);
    renderMeaning(meaning, current.meaning);

    const actions = wrap.createDiv({ cls: "hp-mistakes-actions" });
    const toggleBtn = actions.createEl("button", { text: revealed ? "收起释义" : "看释义" });
    toggleBtn.addClass("hp-mistakes-btn");
    toggleBtn.addEventListener("click", () => {
      revealed = !revealed;
      meaning.toggleClass("is-hidden", !revealed);
      toggleBtn.setText(revealed ? "收起释义" : "看释义");
    });

    const confirmBtn = actions.createEl("button", { text: "确定，下一个" });
    confirmBtn.addClass("hp-mistakes-btn", "mod-cta");
    confirmBtn.addEventListener("click", () => {
      confirmBtn.disabled = true;
      void ctx.saveConfig({ date: today, seen: [...seen, current.name] }).then(() => ctx.rerender());
    });

    const bar = wrap.createDiv({ cls: "hp-mistakes-bar" });
    bar.createDiv({ cls: "hp-mistakes-bar-fill" }).style.width = `${(doneCount / queue.length) * 100}%`;
  },

  renderSettings(container, ctx) {
    addPathSetting(container, ctx.app, {
      name: "成语词典笔记",
      desc: "用 ## 成语名 分节，每节下面写 - 释义：……。示例：成语积累.md",
      value: ctx.config.notePath,
      placeholder: "成语积累.md",
      suggest: { files: true },
      onChange: (value) => ctx.update({ notePath: value })
    });

    new Setting(container).setName("默认隐藏释义")
      .setDesc("开启后先只看成语，点「看释义」再展开，适合自测。")
      .addToggle((toggle) => toggle.setValue(ctx.config.hideMeaning).onChange((value) => ctx.update({ hideMeaning: value })));
  }
};

/** 按 `## 成语名:` 切分；释义取 `- 释义：` 之后的正文，其余 bullet 一并保留。 */
function parseIdioms(markdown: string): IdiomItem[] {
  const body = stripFrontmatter(markdown);
  const items: IdiomItem[] = [];
  let name: string | null = null;
  let lines: string[] = [];

  const flush = () => {
    if (!name) return;
    const text = cleanMeaning(lines);
    if (text) items.push({ name, meaning: text });
    lines = [];
  };

  for (const line of body.split(/\r?\n/g)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      name = heading[1].replace(/\s*[:：]\s*$/, "").trim();
      continue;
    }
    if (name) lines.push(line);
  }
  flush();
  return items;
}

/** 去掉每行的 bullet 与「释义：」前缀，保留多行内容。 */
function cleanMeaning(lines: string[]): string {
  const result: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const normalized = line
      .replace(/^\s*[-*+]\s*/, "")
      .replace(/^\s*(释义|解释|含义)\s*[:：]\s*/, "")
      .trim();
    if (normalized) result.push(normalized);
  }
  return result.join("\n");
}

/** FNV-1a：稳定哈希，用作每日随机排序的键。 */
function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function renderMeaning(container: HTMLElement, meaning: string): void {
  for (const line of meaning.split("\n")) {
    container.createDiv({ cls: "hp-idiom-meaning-line", text: line });
  }
}

function renderDone(body: HTMLElement, count: number, onReset: () => unknown): void {
  const wrap = body.createDiv({ cls: "hp-idiom hp-idiom-done" });
  const center = wrap.createDiv({ cls: "hp-done-center" });
  setIcon(center.createDiv({ cls: "hp-mistakes-done-icon" }), "check-check");
  center.createDiv({ cls: "hp-mistakes-done-title", text: "今天的成语过完了" });
  center.createDiv({ cls: "hp-mistakes-done-desc", text: `共 ${count} 个，明天重新洗牌。` });
  // 按钮放在卡片最底部，与常规状态的「确定，下一个」同一高度、同样宽度。
  const actions = wrap.createDiv({ cls: "hp-mistakes-actions" });
  const again = actions.createEl("button", { text: "再来一轮" });
  again.addClass("hp-mistakes-btn", "mod-cta");
  again.addEventListener("click", () => {
    again.disabled = true;
    void onReset();
  });
}
