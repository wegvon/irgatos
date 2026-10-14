/**
 * Markup for the preview frame. An SVG is centered on its own page so it
 * fits the pane; an HTML page is shown as written.
 */
export function previewDocument(format: "html" | "svg", source: string): string {
  if (format === "svg") {
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:grid;place-items:center;padding:16px;box-sizing:border-box}svg{max-width:100%;max-height:calc(100vh - 32px);height:auto}</style></head><body>${source}</body></html>`;
  }
  return /<html[\s>]|<!doctype/i.test(source)
    ? source
    : `<!doctype html><html><head><meta charset="utf-8"></head><body>${source}</body></html>`;
}

/**
 * A page or graphic in a frame with `allow-scripts` and nothing else: no
 * same origin, so it cannot reach the app, its storage or its IPC, and no
 * forms, popups or top navigation.
 */
export function ArtifactPreviewFrame({
  format,
  source,
  title,
}: {
  format: "html" | "svg";
  source: string;
  title: string;
}) {
  return (
    <iframe
      data-artifact-preview-frame={format}
      title={`${title} preview`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={previewDocument(format, source)}
      className={`block h-full w-full border-0 ${
        format === "html" ? "bg-white" : "bg-transparent"
      }`}
    />
  );
}
