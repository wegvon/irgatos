import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptySession } from "./EmptySession";

describe("empty session background", () => {
  it("renders the arcade when no chat background is selected", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, { cwd: "/work/demo" }),
    );

    expect(markup).toContain("<canvas");
  });

  it("does not render the arcade over a selected chat background", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        cwd: "/work/demo",
        hasChatBackground: true,
      }),
    );

    expect(markup).not.toContain("<canvas");
  });
});

describe("empty session starters", () => {
  const starters = createElement("div", { "data-starters": "" });

  it("shows the starters once a project is open", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        cwd: "/work/demo",
        composer: createElement("textarea"),
        starters,
      }),
    );
    expect(markup).toContain("data-starters");
  });

  it("shows the starters with a docked composer too", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, { cwd: "/work/demo", starters }),
    );
    expect(markup).toContain("data-starters");
  });
});
