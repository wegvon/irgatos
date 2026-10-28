import { useSyncExternalStore } from "react";
import {
  loadDecisionDeferrals,
  subscribeDecisionDeferrals,
} from "../model/decisionDeferrals";

/** Requests put off from their card, live across windows. */
export function useDecisionDeferrals() {
  return useSyncExternalStore(
    subscribeDecisionDeferrals,
    loadDecisionDeferrals,
    loadDecisionDeferrals,
  );
}
