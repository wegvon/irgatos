import { CircleAlert } from "../../../shared/ui/icons";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import { QuestionForm } from "../../sessions/ui/QuestionForm";
import type { FleetRequest } from "../model/fleet";

/** An approval or question an agent waits on, answerable where it is listed. */
export function RequestCard({
  request,
  onApproval,
  onQuestionReply,
  onQuestionInteraction,
}: {
  request: FleetRequest;
  onApproval: (requestId: number, decision: "allow" | "deny") => void;
  onQuestionReply: (requestId: number, reply: UserQuestionReply) => void;
  onQuestionInteraction?: (requestId: number) => void;
}) {
  if (request.kind === "question") {
    return (
      <div
        data-fleet-request="question"
        className="border-t border-stroke px-3 py-2.5"
      >
        <QuestionForm
          prompt={request.prompt}
          onReply={onQuestionReply}
          onInteraction={onQuestionInteraction}
        />
      </div>
    );
  }
  return (
    <div
      data-fleet-request="approval"
      className="flex flex-col gap-2 border-t border-stroke px-3 py-2 sm:flex-row sm:items-center"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-content/80">
          <CircleAlert className="size-3.5 shrink-0 text-amber-400" strokeWidth={1.75} />
          <span className="min-w-0 truncate">{request.label}</span>
        </span>
        {request.detail ? (
          <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-content/5 px-2 py-1 font-mono text-[11px] leading-relaxed text-content/70 select-text">
            {request.detail}
          </code>
        ) : null}
      </span>
      <span className="flex shrink-0 gap-2">
        <button
          type="button"
          className="flex-1 rounded-md bg-content px-3 py-1 text-[12px] font-medium text-background-base hover:bg-content/80 sm:flex-none"
          onClick={() => onApproval(request.requestId, "allow")}
        >
          Allow
        </button>
        <button
          type="button"
          className="flex-1 rounded-md bg-content/10 px-3 py-1 text-[12px] font-medium text-content/70 hover:bg-content/20 sm:flex-none"
          onClick={() => onApproval(request.requestId, "deny")}
        >
          Deny
        </button>
      </span>
    </div>
  );
}
