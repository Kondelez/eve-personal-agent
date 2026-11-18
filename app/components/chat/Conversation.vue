<script setup lang="ts">
import type { AccountChat } from "#shared/types/account-chat";
import { useAuthorizationChallenges } from "~/composables/chat/useAuthorizationChallenges";
import { useChatSession } from "~/composables/chat/useChatSession";

const props = defineProps<{ chat: AccountChat; pendingMessage?: string }>();
const emit = defineEmits<{ recover: [text: string]; sent: [] }>();

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
} = useChatSession(props.chat, text => emit("recover", text));

const { pendingChallenges, failedChallenges, tryResumeConnectedChallenges } = useAuthorizationChallenges();

const input = ref("");

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

  if (props.pendingMessage) void submitText(props.pendingMessage);
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

async function submitText(text: string) {
  actionError.value = undefined;
  try {
    if (await send(text)) emit("sent");
  }
  catch (error) {
    actionError.value = error instanceof Error ? error : new Error("Could not send your message.");
    input.value = text;
  }
}

function handleSubmit(e: Event) {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || isBusy.value) return;
  input.value = "";
  void submitText(text);
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

function handleInputResponses(responses: Parameters<typeof respond>[0]) {
  void respond(responses);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div ref="viewport" class="min-h-0 flex-1 overflow-y-auto overscroll-contain" @scroll.passive="updateScroll">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-5 sm:px-8 sm:py-8">
        <UChatMessages
          v-if="messages.length || isBusy"
          :messages="messages"
          :status="status"
          :assistant="{ side: 'left', variant: 'naked' }"
          :user="{ side: 'right', variant: 'soft' }"
          class="min-w-0"
        >
          <template #indicator>
            <ChatActivityIndicator />
          </template>

          <template #content="{ message }">
            <div class="min-w-0">
              <p v-if="isSms(message)" class="mb-1 text-xs font-medium text-muted">SMS</p>
              <ChatMessageContentEve
                :message="message"
                :status="status"
                :is-last="message.id === messages.at(-1)?.id"
                :can-respond="!isBusy"
                @input-responses="handleInputResponses"
              />
              <UButton
                v-if="message.role === 'assistant' && !isBusy && message.parts.some(part => part.type === 'text' && part.text)"
                type="button"
                variant="ghost"
                color="neutral"
                size="xs"
                :icon="copied === message.id ? 'i-lucide-check' : 'i-lucide-copy'"
                :aria-label="copied === message.id ? 'Copied' : 'Copy reply'"
                class="mt-1 text-muted"
                @click="copyMessage(message)"
              />
            </div>
          </template>
        </UChatMessages>
        <div v-else class="my-auto py-12 text-center">
          <h1 class="text-xl font-semibold text-highlighted">What can I help with?</h1>
        </div>
      </div>
    </div>

    <div class="relative shrink-0 border-t border-default bg-default px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-8">
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

        <UChatPrompt
          v-model="input"
          :error="actionError ?? chatError"
          variant="soft"
          placeholder="Message Eve"
          aria-label="Message Eve"
          class="rounded-2xl"
          @submit="handleSubmit"
        >
          <template #footer>
            <UChatPromptSubmit
              class="ms-auto shrink-0 rounded-full"
              :status="status"
              color="neutral"
              @stop="cancel()"
              @reload="retry()"
            />
          </template>
        </UChatPrompt>
      </div>
    </div>
  </div>
</template>
