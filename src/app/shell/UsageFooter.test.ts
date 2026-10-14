import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UsageFooter } from "./UsageFooter";

describe("UsageFooter terminal control", () => {
  it("replaces the generic terminal button with the live process control", () => {
    const markup = renderToStaticMarkup(
      createElement(UsageFooter, {
        providers: [],
        terminals: [
          {
            id: "terminal-1",
            process: "npm",
            cwd: "/repo",
            label: "repo",
          },
        ],
        terminalOpen: true,
        onToggleTerminal: vi.fn(),
        onNewTerminal: vi.fn(),
        onShowTerminal: vi.fn(),
        projectTerminalActive: true,
      }),
    );

    expect(markup).toContain(">npm</span>");
    expect(markup).not.toContain(">Terminal</span>");
    expect(markup.match(/<button/g)).toHaveLength(1);
  });

  it("keeps the generic terminal button when no process is running", () => {
    const markup = renderToStaticMarkup(
      createElement(UsageFooter, {
        providers: [],
        onNewTerminal: vi.fn(),
      }),
    );

    expect(markup).toContain(">Terminal</span>");
    expect(markup.match(/<button/g)).toHaveLength(1);
  });

  it("adds the ADHD mode switch only when asked to", () => {
    const without = renderToStaticMarkup(
      createElement(UsageFooter, { providers: [] }),
    );
    expect(without).not.toContain('aria-label="ADHD mode"');

    const markup = renderToStaticMarkup(
      createElement(UsageFooter, {
        providers: [],
        adhd: {},
        onToggleBrowser: vi.fn(),
      }),
    );
    expect(markup).toContain('aria-label="ADHD mode"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain(">ADHD</span>");
    expect(markup.indexOf("ADHD mode")).toBeLessThan(
      markup.indexOf("Show Browser"),
    );
  });

  it("shows the browser toggle with its open state", () => {
    const markup = renderToStaticMarkup(
      createElement(UsageFooter, {
        providers: [],
        browserOpen: true,
        onToggleBrowser: vi.fn(),
      }),
    );

    expect(markup).toContain(">Browser</span>");
    expect(markup).toContain('aria-label="Hide Browser"');
    expect(markup).toContain('aria-pressed="true"');
  });
});
