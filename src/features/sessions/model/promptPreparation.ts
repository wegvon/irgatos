import { applyFileMentionsToTurn } from "../../files/model/fileMentions";
import { applyNotesToTurn } from "../../notes";
import {
  applySkillsToTurn,
  warmNativeSkills,
  isNativeCommandPrompt,
  type SkillCatalogContext,
} from "../../skills/model/skills";
import { nativeCommandPrompt } from "../../../integrations/harness/core/nativeCommands";
import { applySessionReferencesToTurn } from "../data/sessionReferenceDirectory";
import { applyCooperativeBridgeToTurn } from "./sessionMessageRouter";
import { applyAppWindowToTurn } from "./appWindows";

export async function preparePrompt(
  text: string,
  context: SkillCatalogContext,
): Promise<string> {
  warmNativeSkills(context);
  if (isNativeCommandPrompt(text, context.harness))
    return nativeCommandPrompt(context.harness, text);
  const withFiles = await applyFileMentionsToTurn(text, context.cwd);
  const withNotes = await applyNotesToTurn(withFiles);
  const withSkills = await applySkillsToTurn(withNotes, context);
  const withReferences = await applySessionReferencesToTurn(
    text,
    withSkills,
    context,
  );
  const withWindow = await applyAppWindowToTurn(text, context.sessionId);
  return applyCooperativeBridgeToTurn(
    withReferences + withWindow.slice(text.length),
    context.sessionId,
  );
}
