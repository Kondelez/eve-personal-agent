<script setup lang="ts">
import { ACCOUNT_CHAT_PATH } from "#shared/types/account-chat";
import type { AccountChat } from "#shared/types/account-chat";
import type { ChatDraft } from "~/utils/chat/attachments";

const chat = shallowRef<AccountChat>();
const messageToSend = shallowRef<ChatDraft>();
const searchOpen = ref(false);
const startOpen = ref(false);

function openStart() {
  searchOpen.value = false;
  startOpen.value = true;
}

function openSearch() {
  if (!chat.value || error.value) return;
  startOpen.value = false;
  searchOpen.value = !searchOpen.value;
}

defineShortcuts({
  meta_k: { usingInput: true, handler: openSearch },
  meta_o: { usingInput: true, handler: openStart },
});
const loading = ref(false);
const error = ref(false);

async function openChat(draft?: ChatDraft) {
  if (loading.value) return;
  if (draft) messageToSend.value = draft;
  loading.value = true;
  error.value = false;
  try {
    const next = await $fetch<AccountChat>(ACCOUNT_CHAT_PATH, {
      method: "POST",
      body: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        closedSessionId: draft ? chat.value?.sessionId : undefined,
      },
    });
    if (draft && next.sessionId === chat.value?.sessionId) {
      error.value = true;
      return;
    }
    messageToSend.value = draft;
    chat.value = next;
  }
  catch {
    error.value = true;
  }
  finally {
    loading.value = false;
  }
}

onMounted(() => void openChat());
</script>

<template>
  <UDashboardPanel id="chat" class="min-h-0" :ui="{ body: 'p-0 sm:p-0 overflow-hidden gap-0' }">
    <template #header>
      <AppNavbar>
        <template #title>
          <div class="flex items-center gap-3">
            <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-800 ring-1 ring-teal-900/10 dark:bg-teal-950 dark:text-teal-200 dark:ring-teal-200/20">
              <AppLogo class="h-3.5 w-auto" />
            </span>
            <div class="min-w-0">
              <p class="text-sm font-semibold leading-tight text-highlighted">Eve</p>
              <p class="text-xs leading-tight text-muted">Web and SMS in one chat</p>
            </div>
          </div>
        </template>

        <UTooltip v-if="chat && !error" :text="startOpen ? 'Back to conversation' : 'Start screen'" :kbds="startOpen ? undefined : ['meta', 'O']">
          <UButton
            variant="ghost"
            color="neutral"
            :icon="startOpen ? 'i-lucide-messages-square' : 'i-lucide-house'"
            :aria-label="startOpen ? 'Back to conversation' : 'Start screen'"
            class="rounded-lg"
            @click="startOpen ? startOpen = false : openStart()"
          />
        </UTooltip>
        <UTooltip v-if="chat && !error" text="Find in conversation" :kbds="['meta', 'K']">
          <UButton
            type="button"
            :variant="searchOpen ? 'soft' : 'ghost'"
            color="neutral"
            icon="i-lucide-search"
            aria-label="Find in conversation"
            :aria-expanded="searchOpen"
            class="rounded-lg"
            @click="openSearch"
          >
            <span class="hidden sm:inline">Search</span>
          </UButton>
        </UTooltip>
        <UButton
          to="/settings/profile"
          variant="ghost"
          color="neutral"
          icon="i-lucide-smartphone"
          aria-label="SMS settings"
          title="SMS settings"
          class="rounded-lg"
        />
      </AppNavbar>
    </template>

    <template #body>
      <div v-if="error" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-sm">
        <p role="alert">Could not open your conversation.</p>
        <UButton color="neutral" variant="outline" @click="openChat(messageToSend)">Try again</UButton>
      </div>
      <ChatConversation
        v-else-if="chat"
        :key="chat.sessionId"
        v-model:search-open="searchOpen"
        v-model:start-open="startOpen"
        :chat="chat"
        :pending-message="messageToSend"
        @recover="openChat"
        @sent="messageToSend = undefined"
      />
      <p v-else class="m-auto text-sm text-muted" role="status">Loading chat…</p>
    </template>
  </UDashboardPanel>
</template>
