import { PixelMascot } from "../../projects/ui/PixelMascot";
import type { IrgatStatus } from "../model/irgat";

/** The rail mascot and its status circle, shared by both rail layouts. */
export function IrgatRailMascot({
  name,
  color,
  status = "idle",
  className = "size-4 shrink-0",
}: {
  name: string;
  color: string;
  status?: IrgatStatus;
  className?: string;
}) {
  return (
    <span className={`relative grid place-items-center ${className}`}>
      <PixelMascot
        name={name}
        color={color}
        status={status}
        still={status === "idle"}
        className="size-full"
      />
      <IrgatStatusDot
        status={status}
        color={color}
        className="-top-0.5 -right-0.5 size-1.5"
      />
    </span>
  );
}

/** The status circle alone, for rails that dim the mascot but not its state. */
export function IrgatStatusDot({
  status,
  color,
  className,
}: {
  status: IrgatStatus;
  color: string;
  className: string;
}) {
  return (
    <span
      aria-hidden
      className={`absolute rounded-full ring-1 ring-background-base ${className} ${
        status === "working"
          ? "motion-safe:animate-pulse"
          : status === "needs-you"
            ? "bg-accent"
            : "bg-content/30"
      }`}
      style={status === "working" ? { backgroundColor: color } : undefined}
    />
  );
}
