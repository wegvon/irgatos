import { memo } from "react";
import { Streamdown } from "streamdown";
import { boundedCode } from "../../../files/editor/codeHighlightPlugin";

const CONTROLS = {
  code: { copy: true, download: false },
  table: false,
  mermaid: false,
} as const;
const PLUGINS = { code: boundedCode };
const LINKS = { enabled: false };

/** An agent reply, rendered the way the Mac renders it, at phone reading size. */
export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <Streamdown
      className="agent-markdown web-markdown min-w-0 font-sans"
      controls={CONTROLS}
      dir="auto"
      isAnimating={streaming}
      linkSafety={LINKS}
      plugins={PLUGINS}
    >
      {text}
    </Streamdown>
  );
});
