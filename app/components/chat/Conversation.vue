<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import type { AccountChat } from "#shared/types/account-chat";
import { FILE_ACCEPT, MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, MAX_CHAT_TEXT_LENGTH, PHOTO_ACCEPT, prepareChatFile } from "~/utils/chat/attachments";
import type { ChatAttachment, ChatDraft } from "~/utils/chat/attachments";
import { useAuthorizationChallenges } from "~/composables/chat/useAuthorizationChallenges";
import { useChatSession } from "~/composables/chat/useChatSession";

const props = defineProps<{ chat: AccountChat; pendingMessage?: ChatDraft }>();
const emit = defineEmits<{ recover: [draft: ChatDraft]; sent: [] }>();
const searchOpen = defineModel<boolean>("searchOpen", { default: false });

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
} = useChatSession(props.chat, draft => emit("recover", draft));

const { pendingChallenges, failedChallenges, tryResumeConnectedChallenges } = useAuthorizationChallenges();

const input = ref("");
const composer = useTemplateRef("composer");
const photosInput = useTemplateRef("photosInput");
const cameraInput = useTemplateRef("cameraInput");
const filesInput = useTemplateRef("filesInput");
const attachments = shallowRef<ChatAttachment[]>([]);
const preparingFiles = ref(false);
const submitting = ref(false);
const attachmentError = ref("");
const hasDraft = computed(() => Boolean(input.value.trim() || attachments.value.length));
const canSend = computed(() => hasDraft.value && !isBusy.value && !preparingFiles.value && !submitting.value);
const attachmentOptions: DropdownMenuItem[] = [
  { label: "Photos", icon: "i-lucide-images", onSelect: () => photosInput.value?.click() },
  { label: "Take photo", icon: "i-lucide-camera", onSelect: () => cameraInput.value?.click() },
  { label: "Files", icon: "i-lucide-file-up", onSelect: () => filesInput.value?.click() },
];

async function addFiles(files: readonly File[]) {
  if (!files.length || preparingFiles.value || submitting.value) return;
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

function onDragOver(event: DragEvent) {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
}

function onDrop(event: DragEvent) {
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

function chooseStarter(prompt: string) {
  input.value = prompt;
  composer.value?.textareaRef?.focus();
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
const viewport = useTemplateRef("viewport");
const atLatest = ref(true);
const copied = ref("");
const toast = useToast();

function updateScroll() {
  const element = viewport.value;
  if (element) atLatest.value = element.scrollHeight - element.clientHeight - element.scrollTop < 100;
}

function jumpToLatest() {
  const element = viewport.value;
  if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
}

watch(messages, () => {
  if (atLatest.value && viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight;
}, { flush: "post" });

async function submitDraft(draft: ChatDraft) {
  submitting.value = true;
  actionError.value = undefined;
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

function handleSubmit(event: Event) {
  event.preventDefault();
  if (!canSend.value) return;
  const draft = { text: input.value.trim(), attachments: attachments.value };
  input.value = "";
  attachments.value = [];
  attachmentError.value = "";
  void submitDraft(draft);
}

function sendAttachmentOnly(event: KeyboardEvent) {
  if (event.isComposing || event.shiftKey || input.value.trim() || !attachments.value.length) return;
  handleSubmit(event);
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

async function copyMessage(message: (typeof messages.value)[number]) {
  const text = message.parts.filter(part => part.type === "text").map(part => part.text).join("\n\n");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = message.id;
  }
  catch {
    toast.add({ title: "Could not copy the message", color: "error" });
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
    await nextTick();
    finder.value?.inputRef?.focus();
  } else {
    search.value = "";
  }
});
watch(activeMatch, (id) => {
  if (!id) return;
  atLatest.value = false;
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
  <div class="flex min-h-0 flex-1 flex-col bg-[#f2f7f6] dark:bg-[#0e1718]">
    <div v-if="searchOpen" class="shrink-0 border-b border-default bg-default px-4 py-2.5 sm:px-8">
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
    <div ref="viewport" class="min-h-0 flex-1 overflow-y-auto overscroll-contain" @scroll.passive="updateScroll">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6 sm:px-8 sm:py-10">
        <UChatMessages
          v-if="messages.length || isBusy"
          :messages="messages"
          :status="status"
          :assistant="{
            side: 'left',
            variant: 'naked',
            avatar: { text: 'E', alt: 'Eve' },
            ui: {
              leadingAvatar: 'bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100',
              body: 'rounded-2xl rounded-tl-sm border border-default bg-default px-4 py-3 shadow-xs',
            },
          }"
          :user="{
            side: 'right',
            variant: 'naked',
            ui: { body: 'rounded-2xl rounded-tr-sm bg-teal-800 px-4 py-3 text-white dark:bg-teal-900' },
          }"
          class="min-w-0"
        >
          <template #indicator>
            <ChatActivityIndicator />
          </template>

          <template #content="{ message }">
            <div
              :data-message-id="message.id"
              class="min-w-0"
              :class="activeMatch === message.id ? 'rounded-lg ring-2 ring-amber-500 ring-offset-4' : ''"
            >
              <p
                v-if="isSms(message)"
                class="mb-1 flex items-center gap-1 text-xs font-medium"
                :class="message.role === 'user' ? 'text-teal-100' : 'text-muted'"
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
              <UButton
                v-if="!isBusy && message.parts.some(part => part.type === 'text' && part.text)"
                type="button"
                variant="ghost"
                color="neutral"
                size="xs"
                :icon="copied === message.id ? 'i-lucide-check' : 'i-lucide-copy'"
                :aria-label="copied === message.id ? 'Copied' : 'Copy message'"
                :class="message.role === 'user' ? 'mt-1 text-teal-100' : 'mt-1 text-muted'"
                @click="copyMessage(message)"
              />
            </div>
          </template>
        </UChatMessages>
        <div v-else class="mx-auto my-auto w-full max-w-lg px-1 py-10 text-center sm:py-16">
          <span class="mx-auto grid size-14 place-items-center rounded-2xl bg-teal-800 text-white shadow-sm dark:bg-teal-300 dark:text-teal-950">
            <AppLogo class="h-5 w-auto" />
          </span>
          <h1 class="mt-5 text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">How can I help today?</h1>
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
              @click="chooseStarter(starter.prompt)"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="relative shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-8 sm:pb-5">
      <UButton
        v-if="!atLatest"
        type="button"
        color="neutral"
        variant="outline"
        icon="i-lucide-arrow-down"
        aria-label="Jump to latest message"
        class="absolute -top-12 left-1/2 -translate-x-1/2 rounded-full bg-default shadow-sm"
        @click="jumpToLatest"
      />

      <div class="mx-auto w-full max-w-3xl space-y-2">
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
        <UChatPrompt
          ref="composer"
          v-model="input"
          :disabled="submitting"
          :maxlength="MAX_CHAT_TEXT_LENGTH"
          variant="outline"
          placeholder="Message Eve…"
          aria-label="Message Eve"
          class="rounded-3xl bg-default p-2.5 shadow-md ring-1 ring-default focus-within:ring-teal-600 sm:p-3"
          :ui="{ base: 'px-2.5 py-2 text-base' }"
          @submit="handleSubmit"
          @keydown.enter="sendAttachmentOnly"
          @paste="onPaste"
          @dragover="onDragOver"
          @drop="onDrop"
        >
          <template v-if="attachments.length" #header>
            <ul aria-label="Draft attachments" class="flex w-full flex-wrap gap-2 px-1">
              <li v-for="file in attachments" :key="file.id" class="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-default bg-muted py-1 ps-1 pe-1.5">
                <img
                  v-if="file.mediaType.startsWith('image/')"
                  :src="file.data"
                  alt=""
                  class="size-10 rounded-lg object-cover"
                >
                <span v-else class="grid size-10 shrink-0 place-items-center rounded-lg bg-elevated">
                  <UIcon name="i-lucide-file-text" class="size-5 text-muted" />
                </span>
                <span :title="file.filename" class="max-w-32 truncate text-xs font-medium text-default sm:max-w-48">{{ file.filename }}</span>
                <UButton
                  type="button"
                  icon="i-lucide-x"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  :aria-label="`Remove ${file.filename}`"
                  @click="removeAttachment(file.id)"
                />
              </li>
            </ul>
          </template>
          <template #footer>
            <UDropdownMenu :items="attachmentOptions" :content="{ align: 'start', side: 'top', sideOffset: 8 }">
              <UButton
                type="button"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                aria-label="Add attachment"
                title="Add attachment"
                :disabled="preparingFiles || submitting"
                class="size-10 justify-center rounded-full"
              />
            </UDropdownMenu>
            <span v-if="preparingFiles" role="status" class="text-xs text-muted">Preparing attachments…</span>

            <UChatPromptSubmit
              v-if="isBusy || (status === 'error' && !hasDraft)"
              class="ms-auto min-h-10 shrink-0 rounded-full px-4"
              :status="status"
              :label="isBusy ? 'Stop' : 'Retry'"
              :aria-label="isBusy ? 'Stop reply' : 'Retry message'"
              color="neutral"
              @stop="cancel()"
              @reload="retryLast"
            />
            <UButton
              v-else
              :type="input.trim() ? 'submit' : 'button'"
              label="Send"
              icon="i-lucide-arrow-up"
              aria-label="Send message"
              color="neutral"
              :loading="submitting"
              :disabled="!canSend"
              class="ms-auto min-h-10 shrink-0 rounded-full bg-teal-800 px-4 text-white hover:bg-teal-700 dark:bg-teal-300 dark:text-teal-950 dark:hover:bg-teal-200"
              @click="!input.trim() && handleSubmit($event)"
            />
          </template>
        </UChatPrompt>
      </div>
    </div>
  </div>
</template>
