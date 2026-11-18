import { chatMediaId } from "../../shared/chat-media";
import { CONNECT_USER_ISSUER } from "../../shared/connect";
import { getChatMedia } from "../../server/utils/chat-media";
import type { EveChannelConfig } from "eve/channels/eve";

export const fetchChatMedia: NonNullable<EveChannelConfig["fetchFile"]> = async (url, context) => {
  const id = chatMediaId(url);
  if (!id) return null;

  const caller = context?.session.auth.current;
  if (caller?.issuer !== CONNECT_USER_ISSUER || caller.principalType !== "user") {
    throw new Error("Attachment caller is unavailable.");
  }
  const file = await getChatMedia(caller.principalId, id);
  if (!file) throw new Error("Attachment is unavailable.");
  return file;
};
