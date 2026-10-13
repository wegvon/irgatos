import { formatRelativeTime } from "../../inbox/model/githubTasks";

export function formatCardTime(ms: number, now = Date.now()): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (Math.abs(now - ms) < 45_000) return "just now";
  return formatRelativeTime(new Date(ms).toISOString(), now);
}
