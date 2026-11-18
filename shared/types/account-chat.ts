import { CHAT_MEDIA_ID } from "../chat-media";

export interface ChatHistoryMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface AccountChat {
  sessionId: string;
  history: ChatHistoryMessage[];
}

export const ACCOUNT_CHAT_PATH = "/eve/v1/conversation";

export interface HistoryFile {
  id: string;
  filename: string;
  mediaType: string;
}

export const ATTACHMENT_HISTORY_TEXT = "[Attached files]";

export function historyMessageId(sessionId: string, messageId: string, sms: boolean) {
  return `${sms ? "sms" : "web"}:${sessionId}:${messageId}`;
}

export function historyIdWithFiles(id: string, files: HistoryFile[]) {
  // Eve imports plain text with an opaque application ID. Keep file display
  // metadata on that ID so replay can reconstruct photo-only messages too.
  return files.length ? `${id}\n${JSON.stringify(files)}` : id;
}

export function readHistoryId(historyId: string) {
  const [id = historyId, encoded] = historyId.split("\n", 2);
  let files: HistoryFile[] = [];
  if (encoded) {
    try {
      const entries: unknown = JSON.parse(encoded);
      if (Array.isArray(entries)) {
        files = entries.filter((file): file is HistoryFile => !!file
          && typeof file.id === "string" && CHAT_MEDIA_ID.test(file.id)
          && typeof file.filename === "string" && typeof file.mediaType === "string");
      }
    }
    catch { /* Entries from earlier releases may have no media metadata. */ }
  }
  return { id, files };
}
