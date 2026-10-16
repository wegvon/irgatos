// Runs in the browser's isolated "irgat-agent" script world, so page scripts
// can't see or call it. It shares the page's DOM. Every entry point returns a
// JSON string; the app parses and bounds it. Refs from `read` live here and
// are dropped when the page navigates (a new document has a fresh world).
(() => {
  if (globalThis.__irgatAgent) return;

  const MAX_REFS = 80;
  let refs = [];

  const clean = (text) => (text || "").replace(/\s+/g, " ").trim();
  const clip = (text, max) =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;

  function visible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function inViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  }

  function label(el) {
    const aria = el.getAttribute("aria-label") || el.getAttribute("title");
    if (aria) return clean(aria);
    if (el.labels && el.labels.length) return clean(el.labels[0].innerText);
    if (el.tagName === "INPUT" && /^(submit|button|reset)$/i.test(el.type))
      return clean(el.value);
    if (el.tagName === "SELECT" || el.tagName === "INPUT" || el.tagName === "TEXTAREA")
      return clean(el.name || "");
    const alt = el.querySelector && el.querySelector("img[alt]");
    return clean(el.innerText || (alt && alt.alt) || "");
  }

  function describe(el, index) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    let kind = role || tag;
    if (tag === "a") kind = "link";
    if (el.isContentEditable && !role) kind = "textbox";
    if (tag === "input") kind = `input[${(el.type || "text").toLowerCase()}]`;
    const parts = [`[${index}] ${kind}`];
    const name = clip(label(el), 80);
    if (name) parts.push(JSON.stringify(name));
    if (tag === "input" || tag === "textarea" || el.isContentEditable) {
      if (el.placeholder) parts.push(`placeholder=${JSON.stringify(clip(el.placeholder, 60))}`);
      const value = el.isContentEditable ? el.innerText : el.value;
      if (value && el.type !== "password")
        parts.push(`value=${JSON.stringify(clip(clean(value), 60))}`);
    }
    if (tag === "select" && el.selectedOptions && el.selectedOptions[0])
      parts.push(`selected=${JSON.stringify(clip(clean(el.selectedOptions[0].text), 60))}`);
    if (tag === "a" && el.href) parts.push(`-> ${clip(el.href, 120)}`);
    if (el.disabled) parts.push("disabled");
    return parts.join(" ");
  }

  const INTERACTIVE =
    'a[href], button, input:not([type="hidden"]), textarea, select, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="option"], [role="textbox"], [role="combobox"], [onclick]';

  function collect() {
    const found = [];
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (!visible(el)) continue;
      found.push(el);
    }
    // Elements on screen first, then the rest in document order.
    found.sort((a, b) => Number(inViewport(b)) - Number(inViewport(a)));
    refs = found.slice(0, MAX_REFS);
    return refs.map((el, i) => describe(el, i + 1));
  }

  function mainText() {
    const root =
      document.querySelector("main, article, [role=main]") || document.body;
    if (!root) return "";
    const text = (root.innerText || "")
      .split("\n")
      .map((line) => line.replace(/[ \t ]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
    if (root !== document.body && text.length < 200 && document.body)
      return clean(document.body.innerText);
    return text;
  }

  function find(target) {
    if (target.ref != null) {
      const el = refs[Number(target.ref) - 1];
      if (!el || !el.isConnected)
        throw new Error("That ref is stale. Run browser.read again for fresh refs.");
      return el;
    }
    if (target.selector) {
      const el = document.querySelector(target.selector);
      if (!el) throw new Error(`No element matches ${target.selector}`);
      return el;
    }
    if (target.text) {
      const wanted = clean(target.text).toLowerCase();
      const candidates = [...document.querySelectorAll(INTERACTIVE)].filter(visible);
      const exact = candidates.find((el) => label(el).toLowerCase() === wanted);
      const partial =
        exact || candidates.find((el) => label(el).toLowerCase().includes(wanted));
      if (!partial) throw new Error(`No clickable element shows "${target.text}"`);
      return partial;
    }
    throw new Error("Give ref, selector or text");
  }

  function settle(el) {
    el.scrollIntoView({ block: "center", inline: "center" });
  }

  function click(target) {
    const el = find(target);
    settle(el);
    const rect = el.getBoundingClientRect();
    const at = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      const Event = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Event(type, at));
    }
    if (typeof el.focus === "function") el.focus();
    el.click();
    return { clicked: describe(el, refs.indexOf(el) + 1 || 0) };
  }

  function setValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : el.tagName === "SELECT"
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function type(target, text, options) {
    const el = find(target);
    settle(el);
    el.focus();
    if (el.isContentEditable) {
      if (options.clear !== false) {
        document.getSelection().selectAllChildren(el);
        document.execCommand("delete");
      }
      document.execCommand("insertText", false, text);
    } else if (el.tagName === "SELECT") {
      const option = [...el.options].find(
        (o) => o.value === text || clean(o.text).toLowerCase() === clean(text).toLowerCase(),
      );
      if (!option) throw new Error(`No option "${text}" in that list`);
      setValue(el, option.value);
    } else if ("value" in el) {
      setValue(el, options.clear === false ? el.value + text : text);
    } else {
      throw new Error("That element does not take text");
    }
    if (options.submit) {
      const key = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      const proceed = el.dispatchEvent(new KeyboardEvent("keydown", key));
      el.dispatchEvent(new KeyboardEvent("keyup", key));
      if (proceed && el.form) {
        if (typeof el.form.requestSubmit === "function") el.form.requestSubmit();
        else el.form.submit();
      }
    }
    return { typed: describe(el, refs.indexOf(el) + 1 || 0) };
  }

  function scroll(options) {
    if (options.ref != null || options.selector || options.text) {
      settle(find(options));
    } else {
      const amount = Number(options.amount) || 0.8;
      const step = amount <= 5 ? amount * innerHeight : amount;
      const sign = options.direction === "up" ? -1 : 1;
      if (options.direction === "top") scrollTo(0, 0);
      else if (options.direction === "bottom")
        scrollTo(0, document.documentElement.scrollHeight);
      else scrollBy(0, sign * step);
    }
    return {
      scrollY: Math.round(scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
    };
  }

  function read(options) {
    const offset = Math.max(0, Number(options.offset) || 0);
    const max = Math.min(Math.max(Number(options.maxChars) || 6000, 200), 40000);
    const text = mainText();
    const out = {
      url: location.href,
      title: document.title,
      text: text.slice(offset, offset + max),
      totalChars: text.length,
    };
    if (offset + max < text.length) out.nextOffset = offset + max;
    if (options.elements !== false) out.elements = collect();
    return out;
  }

  const run = (fn) => {
    try {
      return JSON.stringify({ ok: true, result: fn() });
    } catch (error) {
      return JSON.stringify({ ok: false, error: String((error && error.message) || error) });
    }
  };

  globalThis.__irgatAgent = {
    read: (options) => run(() => read(options || {})),
    click: (target) => run(() => click(target || {})),
    type: (target, text, options) => run(() => type(target || {}, String(text), options || {})),
    scroll: (options) => run(() => scroll(options || {})),
    page: () => run(() => ({ url: location.href, title: document.title })),
    // `fn` is the agent's script, wrapped by the app as a function body.
    evaluate: (fn) =>
      run(() => {
        const value = fn();
        return value === undefined ? null : JSON.parse(JSON.stringify(value));
      }),
  };
})();
