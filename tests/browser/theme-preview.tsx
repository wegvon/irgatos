import { createRoot } from "react-dom/client";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import type { Block } from "../../src/features/sessions/model/session";
import {
  saveTranscriptAnchor,
  saveTranscriptLayout,
} from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

// A short chat with markdown, code and tool calls, for judging a theme.
// Add ?scheme=light for the light theme.
if (new URLSearchParams(location.search).get("scheme") === "light") {
  document.documentElement.classList.add("theme-light");
}
saveTranscriptAnchor(false);
saveTranscriptLayout("chat");

const answer = `Burada iki sorun var. **Önbellek** süresi dolmadan siliniyor ve \`resetAt\` yanlış hesaplanıyor.

### Düzeltme

\`\`\`ts
export function nextReset(now: number, windowMs: number): number {
  // Pencerenin başına hizala, sonra bir pencere ekle.
  const start = Math.floor(now / windowMs) * windowMs;
  return start + windowMs;
}
\`\`\`

| Dosya | Değişiklik |
| --- | --- |
| limiter.ts | +12 −4 |
| limiter.test.ts | +28 |

> Not: Testler artık saat dilimine bağlı değil.

1. Hesaplamayı düzelttim
2. Test ekledim
3. [Belgeyi](https://example.com) güncelledim`;

const blocks: Block[] = [
  { id: "u1", role: "user", text: "Rate limiter neden erken sıfırlanıyor? Bakıp düzeltir misin?" },
  {
    id: "t1",
    role: "tool",
    text: "Read limiter.ts",
    tool: { kind: "read", status: "completed", preview: { kind: "read", path: "/Users/demo/api/src/limiter.ts" } },
  },
  {
    id: "t2",
    role: "tool",
    text: "Run npm test",
    tool: { kind: "execute", status: "completed", preview: { kind: "shell", query: "npm test -- limiter" } },
  },
  { id: "a1", role: "assistant", text: answer },
  { id: "u2", role: "user", text: "Harika, teşekkürler." },
] as Block[];

createRoot(document.getElementById("root")!).render(
  <AgentTranscript blocks={blocks} initialTurns={5} visible parked={false} />,
);
