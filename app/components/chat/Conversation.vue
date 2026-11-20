<script setup lang="ts">
import { CopilotChatAssistantMessage, CopilotChatInput, CopilotChatUserMessage, CopilotChatView } from "@copilotkit/vue/v2";
import type { AssistantMessage, Attachment, ToolsMenuItem, UserMessage } from "@copilotkit/vue/v2";
import "@copilotkit/vue/styles.css";
import type { UIMessage } from "ai";
import type { Component } from "vue";
import { authClient } from "~/lib/auth-client";
import type { AccountChat } from "#shared/types/account-chat";
import { chatMediaId } from "#shared/chat-media";
import { FILE_ACCEPT, MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, MAX_CHAT_TEXT_LENGTH, PHOTO_ACCEPT, prepareChatFile } from "~/utils/chat/attachments";
import type { ChatAttachment, ChatDraft } from "~/utils/chat/attachments";
import { useAuthorizationChallenges } from "~/composables/chat/useAuthorizationChallenges";
import { useChatSession } from "~/composables/chat/useChatSession";

const props = defineProps<{ chat: AccountChat; pendingMessage?: ChatDraft }>();
const emit = defineEmits<{ recover: [draft: ChatDraft]; sent: [] }>();
const searchOpen = defineModel<boolean>("searchOpen", { default: false });
const startOpen = defineModel<boolean>("startOpen", { default: false });

const {
  messages,
  status,
  error: chatError,
  isBusy,
  send,
  respond,
  cancel,
  retry,
  isSms,
  messageKey,
  originalPrompt,
  regenerate,
} = useChatSession(props.chat, draft => emit("recover", draft));

const { pendingChallenges, failedChallenges, tryResumeConnectedChallenges } = useAuthorizationChallenges();

const input = ref("");
const viewport = useTemplateRef("viewport");
const photosInput = useTemplateRef("photosInput");
const cameraInput = useTemplateRef("cameraInput");
const filesInput = useTemplateRef("filesInput");
const attachments = shallowRef<ChatAttachment[]>([]);
const preparingFiles = ref(false);
const submitting = ref(false);
const dictating = ref(false);
const draggingFiles = ref(false);
let dragDepth = 0;
const view = authClient.useSession();
const localHour = ref<number>();
onMounted(() => { localHour.value = new Date().getHours(); });

const greeting = computed(() => {
  const hour = localHour.value;
  if (hour === undefined) return "How can I help today?";

  const firstName = view.value?.data?.user?.name?.trim().split(/\s+/)[0];
  const time = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return firstName ? `${time}, ${firstName}` : `${time}`;
});
const attachmentError = ref("");
const composerDisabled = computed(() => preparingFiles.value || submitting.value || dictating.value || !!regenerating.value);
const hasDraft = computed(() => Boolean(input.value.trim() || attachments.value.length));
const canSend = computed(() => hasDraft.value && !isBusy.value && !composerDisabled.value);
const visibleMessages = computed(() => startOpen.value ? [] : messages.value.map((message) => {
  const role = message.role === "user" ? "user" : "assistant";
  const renderer: Component = role === "user" ? CopilotChatUserMessage : CopilotChatAssistantMessage;
  const preview: UserMessage | AssistantMessage = { id: message.id, role, content: textOf(message) };
  return { original: message, renderer, preview };
}));
const copilotMessages = computed(() => visibleMessages.value.map(({ preview }) => preview));
const copilotAttachments = computed<Attachment[]>(() => attachments.value.map(file => ({
  id: file.id,
  type: file.mediaType.startsWith("image/") ? "image" : "document",
  source: { type: "data", value: file.data.slice(file.data.indexOf(",") + 1), mimeType: file.mediaType },
  filename: file.filename,
  size: file.size,
  status: "ready",
})));

defineShortcuts({
  meta_u: {
    usingInput: true,
    handler: () => {
      if (!submitting.value && !dictating.value) filesInput.value?.click();
    },
  },
});
const attachmentOptions: ToolsMenuItem[] = [
  { label: "Photos", action: () => photosInput.value?.click() },
  { label: "Take photo", action: () => cameraInput.value?.click() },
  { label: "Files", action: () => filesInput.value?.click() },
];

async function addFiles(files: readonly File[]) {
  if (!files.length || preparingFiles.value || submitting.value || dictating.value) return;
  preparingFiles.value = true;
  attachmentError.value = "";
  try {
    for (const file of files) {
      if (attachments.value.length >= MAX_CHAT_FILES) {
        attachmentError.value = `Choose up to ${MAX_CHAT_FILES} attachments per message.`;
        break;
      }

      const remaining = MAX_CHAT_FILE_BYTES - attachments.value.reduce((total, file) => total + file.size, 0);
      try {
        const attachment = await prepareChatFile(file, remaining);
        attachments.value = [...attachments.value, attachment];
      }
      catch (error) {
        attachmentError.value = error instanceof Error ? error.message : "Could not attach this file.";
      }
    }
  }
  finally {
    preparingFiles.value = false;
  }
}

function onPick(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files ?? []);
  target.value = "";
  void addFiles(files);
}

function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!files.length) return;
  if (!event.clipboardData?.getData("text/plain")) event.preventDefault();
  void addFiles(files);
}

function onDragEnter(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  draggingFiles.value = true;
  dragDepth += 1;
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) draggingFiles.value = false;
}

function onDragOver(event: DragEvent) {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
}

function onDrop(event: DragEvent) {
  draggingFiles.value = false;
  dragDepth = 0;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) return;
  event.preventDefault();
  void addFiles(files);
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter(file => file.id !== id);
  attachmentError.value = "";
}

const starters = [
  { label: "Plan my day", icon: "i-lucide-calendar-days", prompt: "Help me plan my day." },
  { label: "Draft a message", icon: "i-lucide-pen-line", prompt: "Help me draft a message." },
  { label: "What do you know about me?", icon: "i-lucide-user-round", prompt: "What do you know about me?" },
];

function insertTranscript(text: string) {
  input.value = [input.value.trimEnd(), text].filter(Boolean).join(" ").slice(0, MAX_CHAT_TEXT_LENGTH);
  focusComposer();
}

function chooseStarter(prompt: string) {
  input.value = prompt;
  focusComposer();
}

function focusComposer() {
  void nextTick(() => viewport.value?.querySelector("textarea")?.focus());
}

// Replay rebuilds pending sign-ins after mount; check each as it appears, in
// case the connector was connected from Settings in the meantime.
watch(() => pendingChallenges.value.length, (count, previous) => {
  if (import.meta.client && count > (previous ?? 0)) {
    void tryResumeConnectedChallenges({ skipIfBusy: isBusy.value });
  }
});

onMounted(() => {
  void tryResumeConnectedChallenges({ skipIfBusy: isBusy.value });
  const textarea = viewport.value?.querySelector("textarea");
  if (textarea) {
    textarea.maxLength = MAX_CHAT_TEXT_LENGTH;
    textarea.setAttribute("aria-label", "Message Eve");
  }

  if (import.meta.client) {
    const onFocus = () => {
      void tryResumeConnectedChallenges({ skipIfBusy: isBusy.value });
    };
    window.addEventListener("focus", onFocus);
    onUnmounted(() => window.removeEventListener("focus", onFocus));
  }

  if (props.pendingMessage) void submitDraft(props.pendingMessage);
});

const actionError = ref<Error>();
const copied = ref("");
const toast = useToast();

function jumpToLatest() {
  const element = viewport.value?.querySelector("[data-testid='copilot-chat-view-scroll']");
  if (element) element.scrollTop = element.scrollHeight;
}

watch(startOpen, (open) => {
  if (!open) jumpToLatest();
}, { flush: "post" });

async function submitDraft(draft: ChatDraft) {
  startOpen.value = false;
  submitting.value = true;
  actionError.value = undefined;
  jumpToLatest();
  try {
    if (await send(draft)) emit("sent");
  }
  catch (error) {
    actionError.value = error instanceof Error ? error : new Error("Could not send your message.");
    input.value = draft.text;
    attachments.value = [...draft.attachments];
  }
  finally {
    submitting.value = false;
  }
}

function handleSubmit(value = input.value) {
  const text = value.trim().slice(0, MAX_CHAT_TEXT_LENGTH);
  if (isBusy.value || composerDisabled.value || (!text && !attachments.value.length)) return;
  const draft = { text, attachments: attachments.value };
  input.value = "";
  attachments.value = [];
  attachmentError.value = "";
  void submitDraft(draft);
}

function sendAttachmentOnly(event: KeyboardEvent) {
  if (!(event.target instanceof HTMLTextAreaElement) || event.isComposing || event.shiftKey || input.value.trim() || !attachments.value.length) return;
  event.preventDefault();
  handleSubmit();
}

async function retryLast() {
  if (submitting.value) return;
  submitting.value = true;
  actionError.value = undefined;
  try {
    await retry();
  }
  catch (error) {
    actionError.value = error instanceof Error ? error : new Error("Could not retry your message.");
  }
  finally {
    submitting.value = false;
  }
}

function textOf(message: UIMessage) {
  return message.parts.filter(part => part.type === "text").map(part => part.text).join("\n\n");
}

async function copyMessage(message: UIMessage) {
  const text = textOf(message);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = message.id;
  }
  catch {
    toast.add({ title: "Could not copy the message", color: "error" });
  }
}

type ChatVote = 1 | -1;
const { data: initialVotes, error: votesError } = useFetch<{ votes: { messageId: string; vote: ChatVote }[] }>("/api/chat/votes", {
  server: false,
});
const voteChanges = shallowRef<Record<string, ChatVote | null>>({});
const votePending = shallowRef(new Set<string>());
const regenerating = ref<string>();
const votes = computed(() => ({
  ...Object.fromEntries(initialVotes.value?.votes.map(({ messageId, vote }) => [messageId, vote]) ?? []),
  ...voteChanges.value,
}));

async function voteFor(message: UIMessage, value: ChatVote) {
  const key = messageKey(message);
  if (votePending.value.has(key)) return;
  const previous = votes.value[key] ?? null;
  const vote = previous === value ? null : value;
  votePending.value = new Set([...votePending.value, key]);
  voteChanges.value = { ...voteChanges.value, [key]: vote };
  try {
    await $fetch("/api/chat/votes", { method: "PUT", body: { messageId: key, vote } });
  }
  catch {
    voteChanges.value = { ...voteChanges.value, [key]: previous };
    toast.add({ title: "Could not save feedback", color: "error" });
  }
  finally {
    votePending.value = new Set([...votePending.value].filter(pending => pending !== key));
  }
}

function canRegenerate(message: UIMessage) {
  const prompt = originalPrompt(message.id);
  return prompt?.parts.some(part => part.type === "text" && part.text.trim() || part.type === "file" && chatMediaId(part.url));
}

async function regenerateReply(message: UIMessage) {
  if (regenerating.value || submitting.value || dictating.value || isBusy.value) return;
  regenerating.value = message.id;
  jumpToLatest();
  try {
    await regenerate(message.id);
    jumpToLatest();
  }
  catch (error) {
    toast.add({
      title: "Could not regenerate reply",
      description: error instanceof Error ? error.message : undefined,
      color: "error",
    });
  }
  finally {
    regenerating.value = undefined;
  }
}

const finder = useTemplateRef("finder");
const search = ref("");
const matchIndex = ref(0);
const matches = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  if (!needle) return [];
  return messages.value.filter(message => message.parts.some((part) => {
    const text = part.type === "text" ? part.text : part.type === "file" ? part.filename : undefined;
    return text?.toLocaleLowerCase().includes(needle);
  })).map(message => message.id);
});
const activeMatch = computed(() => searchOpen.value ? matches.value[matchIndex.value] : undefined);

watch(search, () => { matchIndex.value = 0; });
watch(matches, (results) => {
  if (matchIndex.value >= results.length) matchIndex.value = 0;
});
watch(searchOpen, async (open) => {
  if (open) {
    startOpen.value = false;
    await nextTick();
    finder.value?.inputRef?.focus();
  } else {
    search.value = "";
  }
});
watch(activeMatch, (id) => {
  if (!id) return;
  viewport.value?.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center" });
}, { flush: "post" });

function stepMatch(direction: number) {
  if (!matches.value.length) return;
  matchIndex.value = (matchIndex.value + direction + matches.value.length) % matches.value.length;
}

function handleInputResponses(responses: Parameters<typeof respond>[0]) {
  void respond(responses);
}
</script>

<template>
  <div
    class="relative flex min-h-0 flex-1 flex-col bg-default"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <div
      v-if="draggingFiles"
      class="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-teal-600 bg-default/90"
      aria-hidden="true"
    >
      <span class="flex items-center gap-2 font-medium">
        <UIcon name="i-lucide-upload" />
        Drop files to attach
      </span>
    </div>
    <div v-if="searchOpen && !startOpen" class="shrink-0 border-b border-default bg-default px-4 py-2.5 sm:px-8">
      <form class="mx-auto flex w-full max-w-2xl items-center gap-1.5" role="search" @submit.prevent="stepMatch(1)" @keydown.esc="searchOpen = false">
        <UInput
          ref="finder"
          v-model="search"
          type="search"
          icon="i-lucide-search"
          placeholder="Find in conversation"
          aria-label="Find in conversation"
          class="min-w-0 flex-1"
        />
        <span v-if="search.trim()" aria-live="polite" class="shrink-0 px-1 text-xs text-muted">
          {{ matches.length ? `${matchIndex + 1} of ${matches.length}` : 'No matches' }}
        </span>
        <UButton type="button" icon="i-lucide-chevron-up" variant="ghost" color="neutral" aria-label="Previous match" :disabled="!matches.length" @click="stepMatch(-1)" />
        <UButton type="button" icon="i-lucide-chevron-down" variant="ghost" color="neutral" aria-label="Next match" :disabled="!matches.length" @click="stepMatch(1)" />
        <UButton type="button" icon="i-lucide-x" variant="ghost" color="neutral" aria-label="Close search" @click="searchOpen = false" />
      </form>
    </div>
    <div ref="viewport" class="min-h-0 flex-1">
      <CopilotChatView
        :messages="copilotMessages"
        :is-running="isBusy"
        :welcome-screen="false"
        :attachments="copilotAttachments"
        :on-remove-attachment="removeAttachment"
        auto-scroll="pin-to-bottom"
      >
        <template #message-view>
          <div v-if="!startOpen && (visibleMessages.length || isBusy)" class="space-y-2 px-1 pb-4 pt-2 sm:px-6">
            <component
              :is="renderer"
              v-for="{ original: message, preview, renderer } in visibleMessages"
              :key="message.id"
              :message="preview"
            >
              <template #message-renderer>
                <div
                  class="min-w-0 text-base"
                  :class="[
                    preview.role === 'user' ? 'max-w-[86%] rounded-2xl bg-muted px-4 py-2.5 sm:max-w-[78%]' : 'py-2',
                    activeMatch === message.id ? 'rounded-lg ring-2 ring-amber-500 ring-offset-4' : '',
                  ]"
                >
                  <p
                    v-if="isSms(message)"
                    class="mb-1 flex items-center gap-1 text-xs font-medium text-muted"
                  >
                    <UIcon name="i-lucide-smartphone" class="size-3.5" />
                    SMS
                  </p>
                  <ChatMessageContentEve
                    :message="message"
                    :status="status"
                    :is-last="message.id === messages.at(-1)?.id"
                    :can-respond="!isBusy"
                    @input-responses="handleInputResponses"
                  />
                  <div
                    v-if="textOf(message) && (message.id !== messages.at(-1)?.id || !isBusy)"
                    class="mt-1 flex flex-wrap items-center gap-0.5"
                    aria-label="Message actions"
                  >
                    <UTooltip :text="copied === message.id ? 'Copied' : 'Copy message'">
                      <UButton
                        type="button"
                        variant="ghost"
                        color="neutral"
                        size="xs"
                        :icon="copied === message.id ? 'i-lucide-check' : 'i-lucide-copy'"
                        :aria-label="copied === message.id ? 'Copied' : 'Copy message'"
                        class="text-muted"
                        @click="copyMessage(message)"
                      />
                    </UTooltip>
                    <template v-if="message.role === 'assistant'">
                      <UTooltip v-for="vote in ([1, -1] as const)" :key="vote" :text="vote === 1 ? 'Good reply' : 'Bad reply'">
                        <UButton
                          type="button"
                          size="xs"
                          :variant="votes[messageKey(message)] === vote ? 'soft' : 'ghost'"
                          :color="votes[messageKey(message)] === vote ? (vote === 1 ? 'success' : 'error') : 'neutral'"
                          :icon="vote === 1 ? 'i-lucide-thumbs-up' : 'i-lucide-thumbs-down'"
                          :aria-label="vote === 1 ? 'Good reply' : 'Bad reply'"
                          :aria-pressed="votes[messageKey(message)] === vote"
                          :disabled="!!votesError || votePending.has(messageKey(message))"
                          @click="voteFor(message, vote)"
                        />
                      </UTooltip>
                      <UTooltip v-if="canRegenerate(message)" text="Regenerate as a new reply">
                        <UButton
                          type="button"
                          variant="ghost"
                          color="neutral"
                          size="xs"
                          icon="i-lucide-rotate-cw"
                          aria-label="Regenerate reply"
                          :loading="regenerating === message.id"
                          :disabled="isBusy || !!regenerating || submitting || dictating"
                          @click="regenerateReply(message)"
                        />
                      </UTooltip>
                    </template>
              </div>
            </div>
              </template>
              <template #toolbar />
              <template #tool-calls-view />
            </component>
            <ChatActivityIndicator v-if="isBusy && visibleMessages.at(-1)?.preview.role !== 'assistant'" class="pt-3" />
          </div>
          <div v-else class="mx-auto w-full max-w-lg px-1 pb-10 pt-[min(20vh,8rem)] text-center">
            <span class="mx-auto grid size-12 place-items-center rounded-2xl bg-inverted text-inverted">
              <AppLogo class="h-5 w-auto" />
            </span>
            <h1 class="mt-5 text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">{{ greeting }}</h1>
            <div class="mt-6 flex flex-wrap justify-center gap-2">
              <UButton
                v-for="starter in starters"
                :key="starter.label"
                :label="starter.label"
                :icon="starter.icon"
                type="button"
                color="neutral"
                variant="outline"
                class="min-h-10 rounded-full bg-default px-3.5"
                :disabled="dictating"
                @click="chooseStarter(starter.prompt)"
              />
            </div>
          </div>
        </template>

        <template #input>
          <div class="space-y-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div class="mx-auto w-full max-w-3xl space-y-2 px-4 sm:px-8">
              <AgentAuthorizationRequest
                v-for="challenge in pendingChallenges"
                :key="`pending-${challenge.name}`"
                :challenge="challenge"
              />
              <AgentAuthorizationRequest
                v-for="challenge in failedChallenges"
                :key="`failed-${challenge.name}`"
                :challenge="challenge"
              />

              <input ref="photosInput" type="file" :accept="PHOTO_ACCEPT" multiple class="hidden" @change="onPick">
              <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="onPick">
              <input ref="filesInput" type="file" :accept="FILE_ACCEPT" multiple class="hidden" @change="onPick">
              <p v-if="attachmentError || actionError || chatError" role="alert" class="text-sm text-error">
                {{ attachmentError || actionError?.message || chatError?.message }}
              </p>
              <p v-if="preparingFiles" role="status" class="text-xs text-muted">Preparing attachments…</p>
            </div>
            <CopilotChatInput
              :model-value="input"
              :disabled="composerDisabled"
              :is-running="isBusy"
              :tools-menu="attachmentOptions"
              :auto-focus="false"
              :clear-on-submit="false"
              placeholder="Message Eve…"
              @update:model-value="input = $event.slice(0, MAX_CHAT_TEXT_LENGTH)"
              @submit-message="handleSubmit"
              @stop="cancel()"
              @keydown.enter.capture="sendAttachmentOnly"
              @paste="onPaste"
            >
              <template #start-transcribe-button>
                <div :class="dictating ? 'absolute inset-x-3 bottom-full mb-2 rounded-xl border border-default bg-default px-2 py-1 shadow-sm' : ''">
                  <ChatDictation
                    v-model:active="dictating"
                    :disabled="preparingFiles || submitting || !!regenerating || isBusy"
                    @transcript="insertTranscript"
                  />
                </div>
              </template>
              <template #send-button="{ onClick }">
                <UButton
                  v-if="!dictating && status === 'error' && !hasDraft && !isBusy"
                  type="button"
                  aria-label="Retry message"
                  title="Retry message"
                  icon="i-lucide-rotate-ccw"
                  variant="ghost"
                  color="neutral"
                  class="size-10 justify-center rounded-full"
                  :loading="submitting"
                  @click="retryLast"
                />
                <UButton
                  v-else-if="!dictating"
                  type="button"
                  :aria-label="isBusy ? 'Stop reply' : 'Send message'"
                  :title="isBusy ? 'Stop reply' : 'Send message'"
                  :icon="isBusy ? 'i-lucide-square' : 'i-lucide-arrow-up'"
                  variant="solid"
                  color="neutral"
                  class="size-10 justify-center rounded-full"
                  :disabled="!isBusy && !canSend"
                  @click="isBusy || input.trim() ? onClick() : handleSubmit()"
                />
              </template>
            </CopilotChatInput>
          </div>
        </template>
      </CopilotChatView>
    </div>
  </div>
</template>
