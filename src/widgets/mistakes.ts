import { Component, MarkdownRenderer, Setting, TFile, setIcon } from "obsidian";
import { addPathSetting, addSectionHeading, addTextareaSetting } from "../ui/settingHelpers";
import { bindInternalLinks } from "../utils/plugins";
import { todayIso } from "../utils/date";
import { stripFrontmatter } from "../utils/vault";
import { WidgetDefinition, normalizeWith, toStringList } from "./types";

export interface MistakesConfig extends Record<string, unknown> {
  /** 错题根目录，其下的子文件夹各自是一类题（如"图推""资料分析"）。 */
  rootFolder: string;
  /** 只轮换这些子文件夹；留空 = 自动发现全部子文件夹。 */
  folders: string[];
  /** 默认先隐藏答案，点「看答案」才展开。 */
  hideAnswer: boolean;
  /** 是否显示题目来源文件。 */
  showSource: boolean;
  /** 内部状态：当天日期（跨天自动重置进度）。 */
  date: string;
  /** 内部状态：当天已点「确定」的题目路径。 */
  seen: string[];
}

const DEFAULTS: MistakesConfig = {
  rootFolder: "今知错题本/用户-3789",
  folders: [],
  hideAnswer: true,
  showSource: true,
  date: "",
  seen: []
};

interface MistakeItem {
  /** 所属子文件夹名（用于展示与轮换）。 */
  folder: string;
  /** 库内完整路径。 */
  path: string;
  /** 文件名（不含 .md），通常就是题干摘要。 */
  title: string;
}

const SECTION = { question: "题目", answer: "正确答案", solution: "我的解答", points: "知识点" } as const;

export const mistakesWidget: WidgetDefinition<MistakesConfig> = {
  kind: "mistakes",
  name: "错题本",
  description: "从错题文件夹里按科目轮番随机抽题，每天刷一遍，点「确定」自动翻下一题。",
  icon: "book-open-check",
  accent: "#dc2626",
  defaultSize: { w: 6, h: 8 },
  defaultConfig: () => ({ ...DEFAULTS }),
  normalizeConfig: (raw) => {
    const config = normalizeWith(DEFAULTS, raw);
    config.rootFolder = String(config.rootFolder ?? "").trim();
    config.folders = toStringList(config.folders, 24);
    config.hideAnswer = config.hideAnswer !== false;
    config.showSource = config.showSource !== false;
    config.seen = toStringList(config.seen, 2000);
    return config;
  },

  async render(body, ctx) {
    const { app, config } = ctx;
    const root = config.rootFolder.trim();
    const today = todayIso();
    // 跨天自动重置当天的刷题进度。
    const seen = config.date === today ? config.seen : [];
    const seenSet = new Set(seen);

    if (!root) {
      ctx.setSubtitle("");
      body.createDiv({ cls: "hp-empty", text: "点击右上角齿轮，设置错题本文件夹" });
      return;
    }

    const groups = collectMistakes(app, root, config.folders);
    const total = [...groups.values()].reduce((sum, list) => sum + list.length, 0);
    if (total === 0) {
      ctx.setSubtitle("0 题");
      const empty = body.createDiv({ cls: "hp-empty" });
      empty.createEl("p", { text: `「${root}」下没有找到 .md 错题。` });
      empty.createEl("p", {
        cls: "hp-mistakes-hint",
        text: "文件夹里每个 .md 文件应视为一道题；以 _ 或 . 开头的子文件夹会被忽略。"
      });
      return;
    }

    // 当天固定的随机顺序：每个子文件夹内按「日期 + 路径」哈希排序（等价于每日随机），
    // 再把各文件夹一轮一轮交替拼接，实现跨科目轮番出题。
    const queue = buildQueue(groups, today);
    const remaining = queue.filter((item) => !seenSet.has(item.path));
    const current = remaining[0] ?? null;
    const doneCount = queue.length - remaining.length;

    if (!current) {
      ctx.setSubtitle(`已完成 ${queue.length} 题`);
      renderDone(body, seen.length, () => ctx.saveConfig({ date: today, seen: [] }).then(() => ctx.rerender()));
      return;
    }

    ctx.setSubtitle(`${current.folder} · ${doneCount + 1}/${queue.length}`);

    const markdown = await readMistake(app, current.path);
    if (!ctx.isAlive()) return;

    const wrap = body.createDiv({ cls: "hp-mistakes" });
    const meta = wrap.createDiv({ cls: "hp-mistakes-meta" });
    const chip = meta.createSpan({ cls: "hp-mistakes-chip", text: current.folder });
    setIcon(chip.createSpan({ cls: "hp-mistakes-chip-icon" }), "folder");
    meta.createSpan({ cls: "hp-mistakes-progress", text: `${doneCount + 1} / ${queue.length}` });
    if (config.showSource) {
      const source = meta.createSpan({ cls: "hp-mistakes-source", text: current.title });
      source.setAttribute("title", `打开：${current.path}`);
      source.addEventListener("click", () => void ctx.openPath(current.path));
    }
    const openBtn = meta.createSpan({ cls: "hp-mistakes-open" });
    setIcon(openBtn, "external-link");
    openBtn.setAttribute("title", "打开这道错题的笔记");
    openBtn.addEventListener("click", () => void ctx.openPath(current.path));

    const scroll = wrap.createDiv({ cls: "hp-mistakes-scroll" });
    const questionEl = scroll.createDiv({ cls: "hp-mistakes-question markdown-rendered" });
    const answerEl = scroll.createDiv({ cls: "hp-mistakes-answer markdown-rendered" });
    if (config.hideAnswer) answerEl.addClass("is-hidden");

    // 每次渲染挂一个独立子 Component，重绘时随宿主卸载，避免渲染产物堆积。
    const child = new Component();
    ctx.component.addChild(child);
    ctx.registerCleanup(() => ctx.component.removeChild(child));

    await MarkdownRenderer.render(app, markdown.question, questionEl, current.path, child);
    bindInternalLinks(questionEl, app, current.path);
    if (markdown.answer) {
      await MarkdownRenderer.render(app, markdown.answer, answerEl, current.path, child);
      bindInternalLinks(answerEl, app, current.path);
    }
    bindImageZoom(scroll, ctx.registerCleanup);

    const actions = wrap.createDiv({ cls: "hp-mistakes-actions" });
    let revealed = !config.hideAnswer;
    answerEl.toggleClass("is-hidden", !revealed);
    if (markdown.answer) {
      const answerBtn = actions.createEl("button", { text: revealed ? "收起答案" : "看答案" });
      answerBtn.addClass("hp-mistakes-btn");
      answerBtn.addEventListener("click", () => {
        revealed = !revealed;
        answerEl.toggleClass("is-hidden", !revealed);
        answerBtn.setText(revealed ? "收起答案" : "看答案");
      });
    }

    const confirmBtn = actions.createEl("button", { text: "确定，下一题" });
    confirmBtn.addClass("hp-mistakes-btn", "mod-cta");
    confirmBtn.addEventListener("click", () => {
      confirmBtn.disabled = true;
      void ctx.saveConfig({ date: today, seen: [...seen, current.path] }).then(() => ctx.rerender());
    });

    // 底部细进度条：今天已确认的比例。
    const bar = wrap.createDiv({ cls: "hp-mistakes-bar" });
    bar.createDiv({ cls: "hp-mistakes-bar-fill" }).style.width = `${(doneCount / queue.length) * 100}%`;
  },

  renderSettings(container, ctx) {
    const { config } = ctx;
    addPathSetting(container, ctx.app, {
      name: "错题根文件夹",
      desc: "其下的每个子文件夹视为一个科目，文件夹里的每个 .md 文件视为一道题。",
      value: config.rootFolder,
      placeholder: "今知错题本/用户-3789",
      suggest: { folders: true },
      onChange: (value) => ctx.update({ rootFolder: value })
    });

    addTextareaSetting(container, {
      name: "参与轮换的子文件夹",
      desc: "一行一个文件夹名；留空表示自动发现全部子文件夹。以 _ 开头的（如 _附件）始终跳过。",
      value: config.folders.join("\n"),
      placeholder: "图推\n资料分析\n判断推理",
      rows: 4,
      onChange: (value) => ctx.update({ folders: toStringList(value, 24) })
    });

    addSectionHeading(container, "显示");
    new Setting(container).setName("默认隐藏答案")
      .setDesc("关闭后答案直接展开。")
      .addToggle((toggle) => toggle.setValue(config.hideAnswer).onChange((value) => ctx.update({ hideAnswer: value })));
    new Setting(container).setName("显示题目来源")
      .setDesc("在题头上显示该错题文件的文件名。")
      .addToggle((toggle) => toggle.setValue(config.showSource).onChange((value) => ctx.update({ showSource: value })));
  }
};

/** 扫描根文件夹（可递归），按「直接父文件夹名」分组；忽略 _ 与 . 开头的目录。 */
function collectMistakes(app: { vault: { getMarkdownFiles(): TFile[] } }, root: string, only: string[]): Map<string, MistakeItem[]> {
  const normalizedRoot = root.replace(/^\/+|\/+$/g, "");
  const prefix = `${normalizedRoot}/`;
  const allow = new Set(only.map((name) => name.trim()).filter(Boolean));
  const groups = new Map<string, MistakeItem[]>();
  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(prefix)) continue;
    const segments = file.path.slice(prefix.length).split("/");
    if (segments.length < 2) continue;
    const folder = segments[segments.length - 2];
    if (!folder || folder.startsWith("_") || folder.startsWith(".")) continue;
    if (segments.slice(0, -1).some((segment) => segment.startsWith("_") || segment.startsWith("."))) continue;
    if (allow.size > 0 && !allow.has(folder)) continue;
    const list = groups.get(folder) ?? [];
    list.push({ folder, path: file.path, title: file.basename });
    groups.set(folder, list);
  }
  return groups;
}

/** 各科目内按日期做稳定随机，再交替拼接成「轮番出题」的顺序。 */
function buildQueue(groups: Map<string, MistakeItem[]>, seed: string): MistakeItem[] {
  const folders = [...groups.keys()].sort((left, right) => left.localeCompare(right, "zh"));
  const shuffled = folders.map((folder) =>
    [...(groups.get(folder) ?? [])].sort((left, right) => hashSeed(`${seed}|${left.path}`) - hashSeed(`${seed}|${right.path}`))
  );
  const queue: MistakeItem[] = [];
  const rounds = shuffled.reduce((max, list) => Math.max(max, list.length), 0);
  for (let index = 0; index < rounds; index++) {
    for (const list of shuffled) {
      const item = list[index];
      if (item) queue.push(item);
    }
  }
  return queue;
}

/** FNV-1a：把字符串映射成稳定的 32 位整数，用作每日随机排序的键。 */
function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 读出题面与答案；没有 ## 题目 标题时退化为整篇正文。 */
async function readMistake(app: { vault: { getAbstractFileByPath(path: string): unknown; cachedRead(file: TFile): Promise<string> } }, path: string): Promise<{ question: string; answer: string }> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return { question: "（文件不存在）", answer: "" };
  let raw = "";
  try {
    raw = await app.vault.cachedRead(file);
  } catch {
    return { question: "（读取失败）", answer: "" };
  }
  const body = stripFrontmatter(raw);
  const sections = splitSections(body);
  const question = sections.get(SECTION.question);
  if (!question) return { question: body.trim(), answer: "" };

  const parts: string[] = [];
  const correct = sections.get(SECTION.answer);
  const solution = sections.get(SECTION.solution);
  const points = sections.get(SECTION.points);
  if (correct) parts.push(`**正确答案**：${correct.trim()}`);
  if (solution) parts.push(`**我的解答**\n\n${solution.trim()}`);
  if (points) parts.push(`**知识点**：${points.trim().replace(/\n+/g, "、").replace(/^[-\s]+/, "")}`);
  return { question: question.trim(), answer: parts.join("\n\n") };
}

/** 按 `## 标题` 切分，值不含标题行本身。 */
function splitSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current) sections.set(current, buffer.join("\n"));
    buffer = [];
  };
  for (const line of markdown.split(/\r?\n/g)) {
    const heading = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      current = heading[1].trim();
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

function renderDone(body: HTMLElement, count: number, onReset: () => unknown): void {
  const wrap = body.createDiv({ cls: "hp-mistakes hp-mistakes-done" });
  const center = wrap.createDiv({ cls: "hp-done-center" });
  setIcon(center.createDiv({ cls: "hp-mistakes-done-icon" }), "check-check");
  center.createDiv({ cls: "hp-mistakes-done-title", text: "今天的错题刷完了" });
  center.createDiv({ cls: "hp-mistakes-done-desc", text: `共过了一遍 ${count} 道，明天会自动换一批。` });
  // 按钮贴在卡片底部，与常规状态的「确定，下一题」同一高度、同样宽度。
  const actions = wrap.createDiv({ cls: "hp-mistakes-actions" });
  const again = actions.createEl("button", { text: "再来一轮" });
  again.addClass("hp-mistakes-btn", "mod-cta");
  again.addEventListener("click", () => {
    again.disabled = true;
    void onReset();
  });
}

/** 单击题面/答案里的图片弹出大图：滚轮缩放、拖动平移、双击还原，点空白或 Esc 关闭。 */
function bindImageZoom(root: HTMLElement, registerCleanup: (cleanup: () => void) => void): void {
  let overlay: HTMLElement | null = null;
  let imgEl: HTMLImageElement | null = null;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  // 触屏：记录所有按下的手指，用于双指捏合与单指拖动
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchStartPanX = 0;
  let pinchStartPanY = 0;
  let pinchAnchorX = 0;
  let pinchAnchorY = 0;

  const pinchDistance = (): number => {
    const list = [...pointers.values()];
    if (list.length < 2) return 0;
    return Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
  };

  const pinchCenter = (): { x: number; y: number } => {
    const list = [...pointers.values()];
    if (list.length < 2) return { x: 0, y: 0 };
    return { x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2 };
  };

  const apply = (): void => {
    if (imgEl) imgEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  };

  const reset = (): void => {
    zoom = 1;
    panX = 0;
    panY = 0;
    apply();
  };

  const onMove = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      const dist = pinchDistance();
      if (pinchStartDist > 0) {
        const next = Math.min(8, Math.max(1, pinchStartZoom * (dist / pinchStartDist)));
        const ratio = next / pinchStartZoom;
        panX = pinchAnchorX - (pinchAnchorX - pinchStartPanX) * ratio;
        panY = pinchAnchorY - (pinchAnchorY - pinchStartPanY) * ratio;
        zoom = next;
        if (zoom === 1) {
          panX = 0;
          panY = 0;
        }
        overlay?.toggleClass("is-zoomed", zoom > 1);
        // 捏合过程中关掉过渡，避免跟手延迟
        if (imgEl) imgEl.style.transition = "none";
        apply();
      }
      dragging = false;
      moved = true;
      return;
    }

    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    panX = originX + dx;
    panY = originY + dy;
    apply();
  };

  const onUp = (event?: PointerEvent): void => {
    if (event) pointers.delete(event.pointerId);
    else pointers.clear();

    if (pointers.size === 1) {
      // 松开一根手指后，用剩下的那根继续单指拖动
      const [rest] = [...pointers.values()];
      dragging = true;
      startX = rest.x;
      startY = rest.y;
      originX = panX;
      originY = panY;
      pinchStartDist = 0;
      if (imgEl) imgEl.style.transition = "";
      return;
    }
    dragging = false;
    pinchStartDist = 0;
    if (imgEl) imgEl.style.transition = "";
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
    if (event.key === "0") reset();
  };

  const close = (): void => {
    onUp();
    overlay?.remove();
    overlay = null;
    imgEl = null;
    zoom = 1;
    panX = 0;
    panY = 0;
    document.removeEventListener("keydown", onKey);
  };

  // 捕获阶段先接管，避免 Obsidian 自带的嵌入图片点击行为抢先处理。
  const onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const image = target?.closest("img") as HTMLImageElement | null;
    if (!image || !root.contains(image)) return;
    event.preventDefault();
    event.stopPropagation();
    close();

    overlay = document.body.createDiv({ cls: "hp-lightbox" });
    imgEl = overlay.createEl("img", { attr: { src: image.src, alt: image.alt } });
    overlay.createDiv({ cls: "hp-lightbox-hint", text: "双指/滚轮缩放 · 拖动平移 · Esc 关闭" });

    // 滚轮：以光标为中心缩放（1x ~ 8x）
    overlay.addEventListener("wheel", (wheelEvent) => {
      wheelEvent.preventDefault();
      if (!overlay) return;
      const rect = overlay.getBoundingClientRect();
      const cx = wheelEvent.clientX - rect.left - rect.width / 2;
      const cy = wheelEvent.clientY - rect.top - rect.height / 2;
      const factor = wheelEvent.deltaY < 0 ? 1.15 : 1 / 1.15;
      const next = Math.min(8, Math.max(1, zoom * factor));
      if (next === zoom) return;
      panX = cx - (cx - panX) * (next / zoom);
      panY = cy - (cy - panY) * (next / zoom);
      zoom = next;
      if (zoom === 1) {
        panX = 0;
        panY = 0;
      }
      overlay.toggleClass("is-zoomed", zoom > 1);
      apply();
    }, { passive: false });

    // 拖动平移 + 触屏双指捏合（放大后才有意义，但允许直接拖）
    overlay.addEventListener("pointerdown", (downEvent) => {
      if ((downEvent.target as HTMLElement).closest(".hp-lightbox-hint")) return;
      pointers.set(downEvent.pointerId, { x: downEvent.clientX, y: downEvent.clientY });

      if (pointers.size === 1) {
        dragging = true;
        moved = false;
        startX = downEvent.clientX;
        startY = downEvent.clientY;
        originX = panX;
        originY = panY;
      } else if (pointers.size === 2) {
        // 第二根手指落下：以两指中点为中心开始捏合
        dragging = false;
        moved = true;
        pinchStartDist = pinchDistance();
        pinchStartZoom = zoom;
        pinchStartPanX = panX;
        pinchStartPanY = panY;
        const center = pinchCenter();
        const rect = (downEvent.currentTarget as HTMLElement).getBoundingClientRect();
        pinchAnchorX = center.x - rect.left - rect.width / 2;
        pinchAnchorY = center.y - rect.top - rect.height / 2;
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    // 点空白关闭；点图片时：1x 关闭，已放大则保持（方便继续拖）
    overlay.addEventListener("click", (clickEvent) => {
      const wasMoved = moved;
      moved = false;
      if (wasMoved) return;
      const onImage = (clickEvent.target as HTMLElement).tagName === "IMG";
      if (onImage && zoom > 1) return;
      close();
    });

    // 双击图片还原到 1x
    overlay.addEventListener("dblclick", (dblEvent) => {
      if ((dblEvent.target as HTMLElement).tagName !== "IMG") return;
      dblEvent.preventDefault();
      reset();
      overlay?.removeClass("is-zoomed");
    });

    document.addEventListener("keydown", onKey);
  };

  root.addEventListener("click", onClick, true);
  registerCleanup(() => {
    root.removeEventListener("click", onClick, true);
    close();
  });
}
