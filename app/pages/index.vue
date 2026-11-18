<script setup lang="ts">
import { ACCOUNT_CHAT_PATH } from "#shared/types/account-chat";
import type { AccountChat } from "#shared/types/account-chat";

const chat = shallowRef<AccountChat>();
const messageToSend = ref<string>();
const loading = ref(false);
const error = ref(false);

async function openChat(text?: string) {
  if (loading.value) return;
  if (text) messageToSend.value = text;
  loading.value = true;
  error.value = false;
  try {
    const next = await $fetch<AccountChat>(ACCOUNT_CHAT_PATH, {
      method: "POST",
      body: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        closedSessionId: text ? chat.value?.sessionId : undefined,
      },
    });
    if (text && next.sessionId === chat.value?.sessionId) {
      error.value = true;
      return;
    }
    messageToSend.value = text;
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
            <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-teal-800 text-white dark:bg-teal-300 dark:text-teal-950">
              <AppLogo class="h-3.5 w-auto" />
            </span>
            <div class="min-w-0">
              <p class="text-sm font-semibold leading-tight text-highlighted">Eve</p>
              <p class="text-xs leading-tight text-muted">Web and SMS in one chat</p>
            </div>
          </div>
        </template>

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
        :chat="chat"
        :pending-message="messageToSend"
        @recover="openChat"
        @sent="messageToSend = undefined"
      />
      <p v-else class="m-auto text-sm text-muted" role="status">Loading chat…</p>
    </template>
  </UDashboardPanel>
</template>
