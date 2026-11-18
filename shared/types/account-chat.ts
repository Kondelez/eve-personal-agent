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
