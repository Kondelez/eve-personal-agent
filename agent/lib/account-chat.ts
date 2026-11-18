import { SessionStrandedError } from "eve/channels";
import { SessionNotActiveError } from "eve/sessions";
import type { ChannelFrom, ChannelResolveSession } from "eve/channels";
import type { Session } from "eve/sessions";
import type { SessionStreamEvent } from "eve/client";
import { conversationOf } from "eve/client";
import { chatMediaId } from "../../shared/chat-media";
import { ATTACHMENT_HISTORY_TEXT, historyIdWithFiles, historyMessageId } from "../../shared/types/account-chat";
import type { HistoryFile } from "../../shared/types/account-chat";
import type { buildAppSessionAuth } from "../../shared/app-auth";
import { accountChatAddress, bindAccountChatSession, getAccountChatSessionId, getChatPhoneBinding, listChatHistorySources } from "../../server/utils/account-chat";

export function isClosedChat(error: unknown) {
  return SessionStrandedError.is(error) || SessionNotActiveError.is(error);
}

type ChatAuth = ReturnType<typeof buildAppSessionAuth>;
type ChatRoute = {
  from: ChannelFrom;
  resolveSession: ChannelResolveSession;
  attachSession: (id: string) => Session;
};

async function readHistory(session: Session, channel: "web" | "sms" = "web") {
  const events: SessionStreamEvent[] = [];
  try {
    for await (const event of session.stream({ follow: false, signal: AbortSignal.timeout(4_000) })) {
      events.push(event);
    }
  }
  catch {
    // The retention period of a legacy workflow may have elapsed.
    return [];
  }

  const smsDeliveries = new Set<string>();
  const smsTurns = new Set<string>();
  for (const event of events) {
    if (event.type === "delivery.admitted" && event.data.source
      && "channel" in event.data.source && event.data.source.channel === "channel:sms") {
      smsDeliveries.add(event.data.deliveryId);
    }
    if (event.type === "delivery.consumed" && smsDeliveries.delete(event.data.deliveryId)) {
      smsTurns.add(event.data.turnId);
    }
  }

  const messages = conversationOf(events).messages;
  const voiceTranscripts = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool" || part.name !== "transcribe_voice_note" || part.state !== "completed") continue;
      const id = (part.input as { id?: string } | undefined)?.id;
      const transcript = (part.output as { transcript?: string } | undefined)?.transcript;
      if (id && transcript) voiceTranscripts.set(id, transcript);
    }
  }

  return messages.flatMap((message) => {
    if (message.metadata?.status === "streaming") return [];
    const text = message.parts.filter(part => part.type === "text").map(part => part.text).join("\n").trim();
    const files = message.parts.flatMap((part): HistoryFile[] => {
      if (part.type !== "file" || !part.url) return [];
      const id = chatMediaId(part.url);
      return id ? [{ id, filename: part.filename ?? "Attachment", mediaType: part.mediaType }] : [];
    });
    if (!text && !files.length) return [];
    const voice = files.flatMap(file => {
      const transcript = voiceTranscripts.get(file.id);
      return transcript ? [`Voice note transcript: ${transcript}`] : [];
    });
    const messageText = [text, ...voice].filter(Boolean).join("\n\n");

    const sms = channel === "sms" || Boolean(message.metadata?.turnId && smsTurns.has(message.metadata.turnId));
    const id = message.metadata?.historyId ?? historyIdWithFiles(historyMessageId(session.id, message.id, sms), files);
    return [{ id, role: message.role, text: messageText.slice(0, 4_000) || ATTACHMENT_HISTORY_TEXT }];
  }).slice(-80);
}

async function earlierHistory(route: ChatRoute, userId: string, previous?: string) {
  if (previous) {
    const history = await readHistory(route.attachSession(previous));
    if (history.length) return history;
  }

  const [sources, link] = await Promise.all([listChatHistorySources(userId), getChatPhoneBinding(userId)]);
  const latestArchive = sources.find(source => source.id.startsWith("account-history:"))?.sessionId;
  if (latestArchive && latestArchive !== previous) {
    const history = await readHistory(route.attachSession(latestArchive));
    if (history.length) return history;
  }

  const legacySms = link?.verifiedAt ? await route.resolveSession(
    JSON.stringify([userId, link.phoneNumber, link.verifiedAt]),
  ) : undefined;
  const history = await Promise.all([
    ...sources.filter(source => !source.id.startsWith("account-history:") && source.sessionId)
      .reverse().map(source => readHistory(route.attachSession(source.sessionId!))),
    ...(legacySms ? [readHistory(legacySms, "sms")] : []),
  ]);
  return history.flat().slice(-80);
}

/** Both the web bootstrap and the Twilio route resolve the same account address. */
export async function openAccountChat(route: ChatRoute, auth: ChatAuth, { preview = false, closedSessionId }: { preview?: boolean; closedSessionId?: string } = {}) {
  const userId = auth.principalId;
  const address = accountChatAddress(userId);
  const source = route.from(address);
  const [previous, active] = await Promise.all([
    getAccountChatSessionId(userId),
    route.resolveSession(address),
  ]);

  if (active && active.id !== closedSessionId) {
    let activeTurn = false;
    let ended = false;
    try {
      // Check full snapshot when opening a browser to distinguish prewarm from
      // a used conversation. SMS dispatch checks the handle at send time.
      if (preview) {
        for await (const event of active.stream({ follow: false, signal: AbortSignal.timeout(3_000) })) {
          activeTurn ||= event.type === "delivery.consumed";
          ended ||= event.type === "session.ended";
        }
      }
    }
    catch {
      // Stream availability is independent of whether a live owner exists.
    }
    if (!ended) {
      await bindAccountChatSession(userId, active.id, previous);
      const history = preview && !activeTurn ? await earlierHistory(route, userId) : [];
      return { sessionId: active.id, session: active, history };
    }
  }

  const history = await earlierHistory(route, userId, previous);
  let result;
  try {
    result = await source.create({ auth, history, title: "Eve" });
  }
  catch (error) {
    if (!SessionStrandedError.is(error)) throw error;
    await source.end({ reason: "Continue this account conversation on the current Eve version" });
    result = await source.create({ auth, history, title: "Eve" });
  }

  await bindAccountChatSession(userId, result.session.id, previous);
  return { sessionId: result.session.id, session: result.session, history };
}
