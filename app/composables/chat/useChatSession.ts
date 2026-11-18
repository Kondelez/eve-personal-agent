import type { EveMessage } from "eve/vue";
import type { Answer } from "eve/events";
import type { UIMessage } from "ai";
import type { AccountChat } from "#shared/types/account-chat";
import { draftContent } from "~/utils/chat/attachments";
import type { ChatDraft } from "~/utils/chat/attachments";
import { clearAuthorizationChallenges, recordAuthorizationEvent } from "~/composables/chat/useAuthorizationChallenges";
import { recordStreamEvent } from "~/composables/chat/stream-log";
import { clearTurnFailure, isFailureEvent, recordTurnFailure, turnFailure } from "~/composables/chat/turn-errors";
import { toUIMessages } from "~/utils/chat/eve";

/** The four statuses the Nuxt UI chat components understand. */
export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

function lastUserMessageText(messages: readonly EveMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;

    const text = message.parts
      .filter(part => part.type === "text")
      .map(part => part.text)
      .join("\n")
      .trim();

    if (text) return text;
  }
}

/**
 * The bound session can no longer take messages: it ended (idle timeout, a
 * failure, an explicit end) or was built by an eve release this deployment
 * cannot continue. Retrying the same session can never succeed.
 *
 * Matched on eve's stable error codes rather than its error classes: importing
 * `eve/client` at runtime pulls in modules whose internal `#shared/*` imports
 * collide with Nuxt's own `#shared` alias and break the client build.
 */
function isSessionGone(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "session_stranded" || code === "session_expired" || code === "session_not_active";
}

/** Connect Nuxt's chat components to the account's shared Eve session. */
export function useChatSession(chat: AccountChat, recover: (draft: ChatDraft) => void) {
  const chatId = chat.sessionId;
  const smsDeliveries = new Set<string>();
  const smsTurns = shallowRef(new Set<string>());

  clearAuthorizationChallenges();

  const agent = useEveAgent({
    initialSession: { sessionId: chatId, streamIndex: 0 },
    resume: true,
    // Fires for replayed events too, so state derived here rebuilds on reload.
    onEvent: (event) => {
      recordAuthorizationEvent(event);

      if (event.type === "delivery.admitted" && event.data.source
        && "channel" in event.data.source && event.data.source.channel === "channel:sms") {
        smsDeliveries.add(event.data.deliveryId);
      }
      if (event.type === "delivery.consumed" && smsDeliveries.delete(event.data.deliveryId)) {
        smsTurns.value = new Set([...smsTurns.value, event.data.turnId]);
      }
      if (event.type === "delivery.settled") smsDeliveries.delete(event.data.deliveryId);

      // A later turn supersedes an earlier failure, live or replayed.
      if (event.type === "turn.started") clearTurnFailure(chatId);
      if (isFailureEvent(event)) recordTurnFailure(chatId, event);

      if (import.meta.dev) {
        // Only a completed part always names its kind (text, reasoning, …).
        recordStreamEvent(event.type === "content.completed" ? `${event.type}:${event.data.kind}` : event.type);
      }
    },
  });

  // Text held while a send waits for a replay to finish. eve only projects a
  // user message once the turn is handed over, so it is shown here instead —
  // in the transcript, where a sent message belongs.
  const queued = shallowRef<ChatDraft | null>();
  let lastWebDraft: ChatDraft | undefined;

  const messages = computed(() => {
    const replayed = toUIMessages(agent.messages.value);
    const sent: UIMessage[] = replayed.length ? replayed : chat.history.map(message => ({
      id: message.id,
      role: message.role,
      metadata: { historyId: message.id },
      parts: [{ type: "text", text: message.text }],
    }));
    if (!queued.value) return sent;

    return [...sent, {
      id: `pending:${chatId}`,
      role: "user",
      parts: [
        ...(queued.value.text ? [{ type: "text" as const, text: queued.value.text }] : []),
        ...queued.value.attachments.map(({ filename, mediaType }) => ({ type: "file" as const, filename, mediaType, url: "" })),
      ],
    } as UIMessage];
  });

  const status = computed<ChatStatus>(() => {
    if (queued.value !== undefined) return "submitted";
    // Replaying a stored session is not an in-flight turn.
    if (agent.status.value === "resuming") return "ready";

    // A dropped stream leaves eve "busy" on the last view it saw. Surface the
    // error instead of streaming forever, so the prompt offers a retry.
    if (agent.error.value && !turnFailure(chatId) && agent.status.value === "busy") return "error";

    if (agent.status.value === "busy") {
      const last = agent.messages.value.at(-1);
      const replying = last?.role === "assistant"
        && last.metadata?.status === "streaming"
        && last.parts.length > 0;
      return replying ? "streaming" : "submitted";
    }

    // A failure leaves eve idle; surface it so the prompt offers a retry.
    // A turn paused on a person (approval, question, sign-in) is idle too.
    return error.value ? "error" : "ready";
  });

  const error = computed(() => {
    // Both are set for a failed turn; the recorded one says what failed.
    const failure = turnFailure(chatId);
    return failure ? new Error(failure) : agent.error.value;
  });

  const isBusy = computed(() => status.value === "submitted" || status.value === "streaming");

  /** eve rejects sends while a session replays; wait rather than drop them. */
  async function whenSendable(draft?: ChatDraft) {
    if (agent.status.value !== "resuming") return;

    queued.value = draft ?? null;
    try {
      await new Promise<void>((resolve) => {
        const stop = watch(agent.status, (value) => {
          if (value === "resuming") return;
          stop();
          resolve();
        });
      });
    }
    finally {
      queued.value = undefined;
    }
  }

  async function deliver(draft: ChatDraft) {
    try {
      await agent.send(draftContent(draft));
      lastWebDraft = draft;
      return true;
    }
    catch (error) {
      if (!isSessionGone(error)) throw error;
      recover(draft);
      return false;
    }
  }

  async function send(draft: ChatDraft) {
    if (!draft.text && !draft.attachments.length) return false;

    clearTurnFailure(chatId);
    await whenSendable(draft);
    return deliver(draft);
  }

  async function respond(answers: readonly Answer[]) {
    clearTurnFailure(chatId);
    await whenSendable();
    await agent.respond(answers);
  }

  async function retry() {
    if (isBusy.value) return;

    // The turn is still running server-side; only the stream was lost.
    if (agent.status.value === "busy" && !turnFailure(chatId)) {
      await agent.resume();
      return;
    }

    if (lastWebDraft) {
      await send(lastWebDraft);
      return;
    }

    const text = lastUserMessageText(agent.messages.value);
    if (text) await send({ text, attachments: [] });
  }

  function isSms(message: UIMessage) {
    const meta = message.metadata as { turnId?: string; historyId?: string } | undefined;
    return Boolean((meta?.turnId && smsTurns.value.has(meta.turnId)) || meta?.historyId?.startsWith("sms:"));
  }

  return {
    messages,
    isSms,
    status,
    error,
    isBusy,
    send,
    respond,
    retry,
    cancel: agent.cancel,
  };
}
