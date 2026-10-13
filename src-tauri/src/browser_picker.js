// Selection picker for the in-app browser. It is evaluated in an isolated
// script world, so the page's own scripts can't see or call it. The app reads
// the result by evaluating `take()` in the same world; nothing is pushed.
(() => {
  const KEY = "__monocodePicker";
  globalThis[KEY]?.stop();
  const root = document.documentElement;
  if (!root) return;

  const TEXT_LIMIT = 300;
  const BRIEF_TEXT_LIMIT = 120;
  const MAX_ELEMENTS = 10;
  const DRAG_THRESHOLD = 4;
  const ATTRIBUTES = [
    "id",
    "role",
    "aria-label",
    "name",
    "type",
    "href",
    "src",
    "alt",
    "title",
    "placeholder",
    "for",
    "data-testid",
  ];
  // [property, values that add nothing]
  const STYLES = [
    ["display", []],
    ["position", ["static"]],
    ["top", ["auto"]],
    ["right", ["auto"]],
    ["bottom", ["auto"]],
    ["left", ["auto"]],
    ["z-index", ["auto"]],
    ["box-sizing", []],
    ["width", []],
    ["height", []],
    ["min-width", ["auto", "0px"]],
    ["max-width", ["none"]],
    ["min-height", ["auto", "0px"]],
    ["max-height", ["none"]],
    ["margin", ["0px"]],
    ["padding", ["0px"]],
    ["border-width", ["0px"]],
    ["border-style", ["none"]],
    ["border-color", []],
    ["border-radius", ["0px"]],
    ["color", []],
    ["background-color", ["rgba(0, 0, 0, 0)", "transparent"]],
    ["background-image", ["none"]],
    ["font-family", []],
    ["font-size", []],
    ["font-weight", []],
    ["line-height", []],
    ["letter-spacing", ["normal", "0px"]],
    ["text-align", ["start", "left"]],
    ["text-transform", ["none"]],
    ["text-decoration-line", ["none"]],
    ["white-space", ["normal"]],
    ["flex-direction", ["row"]],
    ["flex-wrap", ["nowrap"]],
    ["justify-content", ["normal"]],
    ["align-items", ["normal"]],
    ["gap", ["normal", "normal normal"]],
    ["grid-template-columns", ["none"]],
    ["grid-template-rows", ["none"]],
    ["flex", ["0 1 auto"]],
    ["align-self", ["auto"]],
    ["opacity", ["1"]],
    ["overflow", ["visible", "visible visible"]],
    ["box-shadow", ["none"]],
    ["transform", ["none"]],
    ["visibility", ["visible"]],
  ];
  const CONTAINER_ONLY = new Set([
    "flex-direction",
    "flex-wrap",
    "justify-content",
    "align-items",
    "gap",
    "grid-template-columns",
    "grid-template-rows",
  ]);
  const SIDES = ["top", "right", "bottom", "left"];
  const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];

  const clip = (value, limit) => {
    const text = String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  };
  const round = (n) => Math.round(n);
  const rectOf = (r) => ({
    x: round(r.left),
    y: round(r.top),
    width: round(r.width),
    height: round(r.height),
  });
  const boxShorthand = (values) => {
    const [t, r, b, l] = values;
    if (t === r && r === b && b === l) return t;
    if (t === b && r === l) return `${t} ${r}`;
    if (r === l) return `${t} ${r} ${b}`;
    return values.join(" ");
  };

  const styleValue = (style, name) => {
    switch (name) {
      case "margin":
      case "padding":
        return boxShorthand(
          SIDES.map((side) => style.getPropertyValue(`${name}-${side}`)),
        );
      case "border-width":
      case "border-style":
      case "border-color": {
        const part = name.slice("border-".length);
        return boxShorthand(
          SIDES.map((side) => style.getPropertyValue(`border-${side}-${part}`)),
        );
      }
      case "border-radius":
        return boxShorthand(
          CORNERS.map((c) => style.getPropertyValue(`border-${c}-radius`)),
        );
      case "overflow":
        return `${style.getPropertyValue("overflow-x")} ${style.getPropertyValue("overflow-y")}`;
      default:
        return style.getPropertyValue(name);
    }
  };

  const stylesOf = (el, names) => {
    const style = getComputedStyle(el);
    const display = style.getPropertyValue("display");
    const container = /flex|grid/.test(display);
    const positioned = style.getPropertyValue("position") !== "static";
    const bordered = styleValue(style, "border-style") !== "none";
    const out = [];
    for (const [name, defaults] of STYLES) {
      if (names && !names.includes(name)) continue;
      if (CONTAINER_ONLY.has(name) && !container) continue;
      if (
        ["top", "right", "bottom", "left", "z-index"].includes(name) &&
        !positioned
      )
        continue;
      if (name === "border-color" && !bordered) continue;
      const value = clip(styleValue(style, name), 160);
      if (!value || defaults.includes(value)) continue;
      out.push([name, value]);
    }
    return out;
  };

  const label = (el) => {
    let text = el.localName;
    if (el.id) return `${text}#${clip(el.id, 40)}`;
    const classes = [...el.classList].slice(0, 2).map((c) => clip(c, 30));
    if (classes.length) text += `.${classes.join(".")}`;
    return text;
  };

  const unique = (selector) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };

  const selectorOf = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        if (unique(parts.join(" > "))) return parts.join(" > ");
      } else {
        let part = node.localName;
        const classes = [...node.classList]
          .filter((c) => /^[A-Za-z_-][\w-]*$/.test(c) && c.length <= 40)
          .slice(0, 2);
        if (classes.length)
          part += classes.map((c) => `.${CSS.escape(c)}`).join("");
        const parent = node.parentElement;
        if (classes.length && unique([part, ...parts].join(" > ")))
          return [part, ...parts].join(" > ");
        if (parent) {
          const same = [...parent.children].filter(
            (c) => c.localName === node.localName,
          );
          if (same.length > 1)
            part += `:nth-of-type(${same.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        if (unique(parts.join(" > "))) return parts.join(" > ");
      }
      if (node === root) break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  // Form values can hold anything the user typed, passwords included.
  const textOf = (el, limit) =>
    /^(input|textarea|select|option)$/.test(el.localName)
      ? ""
      : clip(el.innerText ?? el.textContent, limit);

  const brief = (el) => ({
    label: label(el),
    selector: selectorOf(el),
    tag: el.localName,
    text: textOf(el, BRIEF_TEXT_LIMIT),
    rect: rectOf(el.getBoundingClientRect()),
  });

  const details = (el) => {
    const attributes = [];
    for (const name of ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value) attributes.push([name, clip(value, 200)]);
    }
    const parent = el.parentElement;
    const parentStyles =
      parent && parent !== root
        ? stylesOf(parent, [
            "display",
            "flex-direction",
            "flex-wrap",
            "justify-content",
            "align-items",
            "gap",
            "grid-template-columns",
            "grid-template-rows",
          ])
        : [];
    return {
      ...brief(el),
      text: textOf(el, TEXT_LIMIT),
      attributes,
      styles: stylesOf(el),
      parent:
        parent && parent !== root
          ? { label: label(parent), styles: parentStyles }
          : null,
    };
  };

  const host = document.createElement("monocode-picker");
  const important = (el, styles) => {
    for (const [name, value] of Object.entries(styles))
      el.style.setProperty(name, value, "important");
  };
  important(host, {
    all: "initial",
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    "z-index": "2147483647",
    cursor: "crosshair",
    "pointer-events": "auto",
    display: "block",
  });
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    .box { position: fixed; display: none; box-sizing: border-box; pointer-events: none;
      border: 2px solid #3b82f6; background: rgba(59, 130, 246, 0.12); border-radius: 2px; }
    .box.region { border-style: dashed; background: rgba(59, 130, 246, 0.08); }
    .tag { position: fixed; display: none; pointer-events: none; max-width: 70vw;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font: 500 11px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff; background: #1d4ed8; padding: 2px 6px; border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
    .tag b { font-weight: 600; }
    .tag span { opacity: 0.8; margin-left: 6px; }
  </style><div class="box"></div><div class="tag"></div>`;
  const box = shadow.querySelector(".box");
  const tag = shadow.querySelector(".tag");

  let pending = null;
  let finished = false;
  let hovered = null;
  let pointer = null;
  let drag = null;

  const show = (rect, name, region) => {
    box.className = region ? "box region" : "box";
    Object.assign(box.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${Math.max(rect.width, 1)}px`,
      height: `${Math.max(rect.height, 1)}px`,
    });
    tag.replaceChildren();
    const strong = document.createElement("b");
    strong.textContent = name;
    const size = document.createElement("span");
    size.textContent = `${round(rect.width)} × ${round(rect.height)}`;
    tag.append(strong, size);
    tag.style.display = "block";
    const above = rect.top - 22;
    tag.style.left = `${Math.max(2, Math.min(rect.left, innerWidth - 120))}px`;
    tag.style.top = `${above >= 2 ? above : Math.min(rect.bottom + 4, innerHeight - 22)}px`;
  };

  const hide = () => {
    box.style.display = "none";
    tag.style.display = "none";
  };

  const elementAt = (x, y) =>
    document
      .elementsFromPoint(x, y)
      .find((el) => el !== host && el !== root && el.localName !== "body") ??
    null;

  const hover = () => {
    if (!pointer || drag?.active) return;
    hovered = elementAt(pointer.x, pointer.y);
    if (hovered) show(hovered.getBoundingClientRect(), label(hovered), false);
    else hide();
  };

  const regionRect = () => {
    const left = Math.max(0, Math.min(drag.x, pointer.x));
    const top = Math.max(0, Math.min(drag.y, pointer.y));
    const right = Math.min(innerWidth, Math.max(drag.x, pointer.x));
    const bottom = Math.min(innerHeight, Math.max(drag.y, pointer.y));
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  };

  const regionElements = (rect) => {
    const found = new Set();
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) {
        const el = elementAt(
          rect.left + ((i + 0.5) * rect.width) / 5,
          rect.top + ((j + 0.5) * rect.height) / 5,
        );
        if (el) found.add(el);
      }
    const leaves = [...found].filter(
      (el) => ![...found].some((other) => other !== el && el.contains(other)),
    );
    leaves.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    let container = leaves[0]?.parentElement ?? null;
    while (container && !leaves.every((el) => container.contains(el)))
      container = container.parentElement;
    return { container, elements: leaves.slice(0, MAX_ELEMENTS) };
  };

  const viewport = () => ({ width: innerWidth, height: innerHeight });

  const teardown = () => {
    removeEventListener("keydown", onKey, true);
    removeEventListener("scroll", onScroll, true);
    host.remove();
  };

  const release = () => {
    if (globalThis[KEY] === api) delete globalThis[KEY];
  };

  const finish = (result) => {
    if (finished) return;
    finished = true;
    teardown();
    // Let the highlight leave the screen before the app takes its snapshot.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        pending = JSON.stringify(result);
      }),
    );
  };

  const pick = (selection) =>
    finish({
      state: "picked",
      selection: {
        title: clip(document.title, 200),
        viewport: viewport(),
        ...selection,
      },
    });

  const onKey = (event) => {
    if (event.key !== "Escape" || !event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    finished = true;
    teardown();
    pending = '{"state":"cancelled"}';
  };

  const onScroll = () => hover();

  const swallow = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  // Page scripts can see the overlay and dispatch events at it; only the
  // user's own input may move or make a selection.
  const fromUser = (event) => {
    swallow(event);
    return event.isTrusted;
  };

  host.addEventListener("pointermove", (event) => {
    if (!fromUser(event)) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (
      drag &&
      !drag.active &&
      Math.hypot(pointer.x - drag.x, pointer.y - drag.y) > DRAG_THRESHOLD
    )
      drag.active = true;
    if (drag?.active) show(regionRect(), "Region", true);
    else hover();
  });
  host.addEventListener("pointerdown", (event) => {
    if (!fromUser(event) || event.button !== 0) return;
    pointer = { x: event.clientX, y: event.clientY };
    drag = { x: pointer.x, y: pointer.y, active: false };
    host.setPointerCapture?.(event.pointerId);
  });
  host.addEventListener("pointerup", (event) => {
    if (!fromUser(event) || !drag) return;
    pointer = { x: event.clientX, y: event.clientY };
    const region = drag.active ? regionRect() : null;
    drag = null;
    if (region && region.width >= 4 && region.height >= 4) {
      const { container, elements } = regionElements(region);
      pick({
        kind: "region",
        rect: rectOf(region),
        container: container && container !== root ? brief(container) : null,
        elements: elements.map(brief),
      });
      return;
    }
    const el = elementAt(pointer.x, pointer.y);
    if (!el) return;
    pick({
      kind: "element",
      rect: rectOf(el.getBoundingClientRect()),
      element: details(el),
      elements: [],
    });
  });
  for (const type of [
    "click",
    "dblclick",
    "mousedown",
    "mouseup",
    "contextmenu",
    "auxclick",
  ])
    host.addEventListener(type, swallow);
  host.addEventListener("pointerleave", () => {
    if (!drag?.active) hide();
  });

  const api = {
    take() {
      if (pending === null) return '{"state":"active"}';
      const result = pending;
      pending = null;
      release();
      return result;
    },
    stop() {
      finished = true;
      teardown();
      release();
    },
  };

  addEventListener("keydown", onKey, true);
  addEventListener("scroll", onScroll, true);
  root.append(host);
  globalThis[KEY] = api;
})();
