import { useRef, useState } from "react";
import type { ControlOutcome } from "../../features/orchestration/model/orchestration";
import {
  newSession,
  type Attachment,
  type Session,
} from "../../features/sessions/model/session";
import { findIrgat } from "../../features/irgats/model/irgat";
import { loadIrgatFiles } from "../../features/irgats/model/irgatFiles";
import {
  clearHabitRun,
  markHabitRun,
} from "../../features/irgats/model/irgatHabits";
import {
  IrgatGroupRunner,
  seatReply,
  type IrgatGroupHost,
} from "../../features/irgats/model/irgatGroupRunner";
import type { IrgatGroupMessage } from "../../features/irgats/model/irgatGroups";

export type IrgatGroupChatHost = {
  sessions(): Session[];
  /** The member's own conversation, opened or created, for its model. */
  memberSession(irgatId: string): Promise<Session | undefined>;
  /** Adds a hidden session to the app's state. */
  add(session: Session): void;
  /** Sends a turn and resolves once it settles. */
  run(
    sessionId: string,
    prompt: string,
    attachments: Attachment[],
  ): Promise<ControlOutcome>;
  stop(sessionId: string): Promise<void>;
  /** Stops a session if it is busy, then deletes it. */
  remove(sessionId: string): Promise<void>;
  onReply?(groupId: string, message: IrgatGroupMessage): void;
};

/**
 * One member's turn runs in a hidden seat with the member's provider, model
 * and permissions. It is registered as that Irgat's hidden run, the way a
 * habit's is, so it stays off the sidebar and its app CLI acts as the Irgat.
 */
export function groupRunnerHost(host: IrgatGroupChatHost): IrgatGroupHost {
  return {
    openSeat: async (irgatId, title) => {
      const own = await host.memberSession(irgatId);
      if (!own || !findIrgat(irgatId)) return undefined;
      const seat: Session = {
        ...newSession(
          own.harness,
          own.cwd,
          own.model,
          own.runtimeMode,
          own.modelSettings,
        ),
        title,
        ephemeral: true,
        ...(own.providerAccountId
          ? { providerAccountId: own.providerAccountId }
          : {}),
      };
      markHabitRun(seat.id, irgatId);
      host.add(seat);
      return { seatId: seat.id, harness: seat.harness, model: seat.model };
    },
    files: loadIrgatFiles,
    run: (seatId, prompt, attachments) => host.run(seatId, prompt, attachments),
    reply: (seatId) =>
      seatReply(host.sessions().find((session) => session.id === seatId)),
    stop: (seatId) => host.stop(seatId),
    close: async (seatId) => {
      try {
        await host.remove(seatId);
      } finally {
        clearHabitRun(seatId);
      }
    },
    onReply: (groupId, message) => host.onReply?.(groupId, message),
  };
}

/** The app's one runner for every group room. */
export function useIrgatGroupChat(host: IrgatGroupChatHost): IrgatGroupRunner {
  const hostRef = useRef(host);
  hostRef.current = host;
  const [runner] = useState(
    () => new IrgatGroupRunner(() => groupRunnerHost(hostRef.current)),
  );
  return runner;
}
