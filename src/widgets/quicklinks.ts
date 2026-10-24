import { Notice, Setting, TFile, TFolder, requestUrl, setIcon } from "obsidian";
import { basenameOf } from "../utils/vault";
import { addIconSetting, addPathSetting, addSectionHeading } from "../ui/settingHelpers";
import { WidgetDefinition, clampInt, normalizeWith } from "./types";

export interface QuickLink {
  /** 库内路径，或 http(s) 网址。 */
  path: string;
  label: string;
  /** lucide 图标名；对网站留空则使用自动抓取的 favicon。 */
  icon: string;
  /** 网站 favicon 的完整 URL（自动抓取）。 */
  favicon?: string;
}

export interface QuicklinksConfig extends Record<string, unknown> {
  pins: QuickLink[];
  columns: number;
}

const DEFAULTS: QuicklinksConfig = { pins: [], columns: 2 };
const WEB_RE = /^https?:\/\//i;

function isWebPin(pin: { path: string }): boolean {
  return WEB_RE.test(pin.path);
}

/** 抓取网站标题与 favicon；失败时退回根域名的 /favicon.ico。 */
async function fetchSiteMeta(url: string): Promise<{ title: string; favicon: string } | null> {
  let base: URL;
  try {
    base = new URL(url);
  } catch {
    return null;
  }
  const fallback = { title: base.hostname, favicon: `${base.origin}/favicon.ico` };
  try {
    const response = await requestUrl({
      url,
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" }
    });
    const html = typeof response.text === "string" ? response.text : String(response.text ?? "");
    const doc = new DOMParser().parseFromString(html, "text/html");
    let favicon = "";
    for (const rel of ["icon", "shortcut icon", "apple-touch-icon", "apple-touch-icon-precomposed", "fluid-icon", "mask-icon"]) {
      const link = doc.querySelector(`link[rel="${rel}"]`);
      const href = link?.getAttribute("href");
      if (href) {
        try {
          favicon = new URL(href, base).href;
          break;
        } catch {
          /* 忽略非法 href */
        }
      }
    }
    const title = doc.querySelector("title")?.textContent?.trim() || base.hostname;
    return { title, favicon: favicon || fallback.favicon };
  } catch {
    return fallback;
  }
}

export const quicklinksWidget: WidgetDefinition<QuicklinksConfig> = {
  kind: "quicklinks",
  name: "快捷入口",
  description: "置顶常用笔记、文件夹、任意文件，或常用网站的图标磁贴。",
  icon: "pin",
  accent: "#0d9488",
  defaultSize: { w: 4, h: 6 },
  defaultConfig: () => ({ pins: [], columns: 2 }),
  normalizeConfig: (raw) => {
    const config = normalizeWith(DEFAULTS, raw);
    config.columns = clampInt(config.columns, 1, 4, 2);
    config.pins = (Array.isArray(config.pins) ? config.pins : [])
      .map((pin) => {
        const item = (pin ?? {}) as Partial<QuickLink>;
        const path = String(item.path ?? "").trim();
        return {
          path,
          label: String(item.label ?? "").trim(),
          icon: String(item.icon ?? "").trim(),
          favicon: isWebPin({ path }) ? String(item.favicon ?? "").trim() || undefined : undefined
        };
      })
      .filter((pin) => pin.path);
    return config;
  },

  render(body, ctx) {
    const { app, config } = ctx;
    ctx.setSubtitle(`${config.pins.length} 个入口`);
    const grid = body.createDiv({ cls: "hp-quicklinks" });
    grid.style.setProperty("--hp-cols", String(config.columns));
    if (config.pins.length === 0) {
      grid.createDiv({ cls: "hp-empty", text: "点击右上角齿轮添加入口" });
      return;
    }
    config.pins.forEach((pin, index) => {
      const web = isWebPin(pin);
      const file = web ? null : app.vault.getAbstractFileByPath(pin.path);
      const isFolder = file instanceof TFolder;
      const exists = web || file instanceof TFile || isFolder;
      const cell = grid.createDiv({
        cls: `hp-quicklink${exists ? " is-clickable" : " is-missing"} hp-tone-${index % 4}`,
        attr: { title: web ? pin.path : exists ? pin.path : `不存在：${pin.path}` }
      });

      const iconEl = cell.createSpan({ cls: `hp-quicklink-icon${web && !pin.icon ? " is-web" : ""}` });
      if (web) {
        if (pin.icon) {
          setIcon(iconEl, pin.icon);
        } else if (pin.favicon) {
          const img = iconEl.createEl("img", { attr: { src: pin.favicon, alt: "" } });
          img.addEventListener("error", () => {
            img.remove();
            setIcon(iconEl, "globe");
          });
        } else {
          setIcon(iconEl, "globe");
        }
      } else {
        setIcon(iconEl, pin.icon || (isFolder ? "folder" : "file-text"));
      }

      let label = pin.label;
      if (!label) {
        if (web) {
          try { label = new URL(pin.path).hostname; } catch { label = pin.path; }
        } else {
          label = basenameOf(pin.path);
        }
      }
      cell.createSpan({ cls: "hp-quicklink-label", text: label });

      if (exists) {
        cell.addEventListener("click", (event) => {
          if (web) {
            event.preventDefault();
            window.open(pin.path, "_blank");
          } else {
            void ctx.openPath(pin.path, { event });
          }
        });
      }
    });
  },

  renderSettings(container, ctx) {
    const { config } = ctx;
    new Setting(container).setName("每行列数")
      .addDropdown((dropdown) => dropdown
        .addOptions({ "1": "1", "2": "2", "3": "3", "4": "4" })
        .setValue(String(config.columns))
        .onChange((value) => ctx.update({ columns: clampInt(value, 1, 4, 2) })));

    addSectionHeading(container, "入口列表");
    const pins = config.pins.map((pin) => ({ ...pin }));
    const commit = (): void => ctx.update({ pins: pins.map((pin) => ({ ...pin })) });

    // 找到真正产生滚动的祖先元素，刷新设置面板后把滚动条还原到原位，避免跳回顶部。
    const findScrollParent = (el: HTMLElement | null): HTMLElement => {
      let node: HTMLElement | null = el;
      while (node) {
        const { overflowY } = window.getComputedStyle(node);
        if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 2) {
          return node;
        }
        node = node.parentElement;
      }
      return container;
    };
    const refreshPreservingScroll = (): void => {
      const scrollEl = findScrollParent(container);
      const top = scrollEl.scrollTop;
      ctx.refresh();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        findScrollParent(container).scrollTop = top;
      }));
    };

    pins.forEach((pin, index) => {
      const card = container.createDiv({ cls: "hp-pin-editor" });
      const head = card.createDiv({ cls: "hp-pin-editor-head" });
      head.createSpan({ cls: "hp-pin-editor-index", text: `#${index + 1}` });
      const actions = head.createDiv({ cls: "hp-pin-editor-actions" });
      const moveUp = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "上移", type: "button" } });
      setIcon(moveUp, "arrow-up");
      moveUp.disabled = index === 0;
      moveUp.addEventListener("click", () => {
        [pins[index - 1], pins[index]] = [pins[index], pins[index - 1]];
        commit();
        refreshPreservingScroll();
      });
      const moveDown = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "下移", type: "button" } });
      setIcon(moveDown, "arrow-down");
      moveDown.disabled = index === pins.length - 1;
      moveDown.addEventListener("click", () => {
        [pins[index + 1], pins[index]] = [pins[index], pins[index + 1]];
        commit();
        refreshPreservingScroll();
      });
      const remove = actions.createEl("button", { cls: "clickable-icon hp-danger", attr: { "aria-label": "删除", type: "button" } });
      setIcon(remove, "trash-2");
      remove.addEventListener("click", () => {
        pins.splice(index, 1);
        commit();
        refreshPreservingScroll();
      });

      // 类型切换：笔记 / 网站
      const typeRow = card.createDiv({ cls: "hp-pin-editor-type" });
      const fileBtn = typeRow.createEl("button", {
        cls: `hp-pill${isWebPin(pin) ? "" : " is-active"}`,
        text: "笔记 / 文件夹",
        attr: { type: "button" }
      });
      const webBtn = typeRow.createEl("button", {
        cls: `hp-pill${isWebPin(pin) ? " is-active" : ""}`,
        text: "网站",
        attr: { type: "button" }
      });
      const setMode = (web: boolean): void => {
        fileBtn.toggleClass("is-active", !web);
        webBtn.toggleClass("is-active", web);
        pin.path = web ? (pin.path.startsWith("http") ? pin.path : "https://") : "";
        pin.favicon = web ? pin.favicon : undefined;
        commit();
        refreshPreservingScroll();
      };
      fileBtn.addEventListener("click", () => { if (isWebPin(pin)) setMode(false); });
      webBtn.addEventListener("click", () => { if (!isWebPin(pin)) setMode(true); });

      if (isWebPin(pin)) {
        // 网站：URL 输入框 + 自动抓取 favicon 与标题
        const urlSetting = new Setting(card).setName("网址").setDesc("粘贴网址后会自动抓取图标与网页标题。");
        let inputEl: HTMLInputElement | null = null;
        urlSetting.addText((text) => {
          inputEl = text.inputEl;
          text.setValue(pin.path).setPlaceholder("https://example.com");
          text.onChange((value) => {
            pin.path = value.trim();
            commit();
          });
        });
        const fetchBtn = urlSetting.addButton((button) => button.setButtonText("抓取图标").onClick(async () => {
          await fetchAndApply(pin, inputEl, card);
          commit();
          refreshPreservingScroll();
        }));
        // 预览当前 favicon
        if (pin.favicon) {
          const preview = card.createDiv({ cls: "hp-pin-favicon-preview", attr: { title: "当前图标" } });
          const img = preview.createEl("img", { attr: { src: pin.favicon, alt: "" } });
          img.addEventListener("error", () => preview.remove());
        }
      } else {
        addPathSetting(card, ctx.app, {
          name: "路径",
          value: pin.path,
          placeholder: "笔记 / 文件夹 / 任意文件",
          suggest: { files: true, folders: true },
          onChange: (value) => {
            pin.path = value;
            commit();
          }
        });
      }

      new Setting(card).setName("显示名称").setDesc("留空使用文件名或域名。")
        .addText((text) => text.setValue(pin.label).onChange((value) => {
          pin.label = value.trim();
          commit();
        }));

      if (!isWebPin(pin) || pin.icon) {
        addIconSetting(card, {
          name: isWebPin(pin) ? "自定义图标" : "图标",
          value: pin.icon,
          onChange: (value) => {
            pin.icon = value;
            commit();
          }
        });
      }
    });

    new Setting(container).addButton((button) => button.setButtonText("＋ 添加入口").setCta().onClick(() => {
      pins.push({ path: "", label: "", icon: "" });
      commit();
      refreshPreservingScroll();
    }));

    /** 抓取当前 pin 的网站元信息并写回。 */
    async function fetchAndApply(pin: QuickLink, inputEl: HTMLInputElement | null, card: HTMLElement): Promise<void> {
      const url = pin.path.trim();
      if (!WEB_RE.test(url)) {
        new Notice("请先输入完整的网址（以 http:// 或 https:// 开头）");
        return;
      }
      const original = inputEl?.value;
      if (inputEl) {
        inputEl.value = url;
        inputEl.disabled = true;
      }
      const hint = card.createDiv({ cls: "hp-pin-fetching", text: "正在抓取图标…" });
      try {
        const meta = await fetchSiteMeta(url);
        if (meta) {
          pin.favicon = meta.favicon;
          if (!pin.label.trim()) pin.label = meta.title.slice(0, 60);
        }
      } catch (error) {
        console.warn("Home Pages: failed to fetch site meta", error);
        new Notice("抓取失败，已使用默认图标");
      } finally {
        hint.remove();
        if (inputEl) {
          if (original !== undefined) inputEl.value = original;
          inputEl.disabled = false;
        }
      }
    }
  }
};
