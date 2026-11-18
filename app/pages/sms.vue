<script setup lang="ts">
useSeoMeta({ title: "Eve SMS | Kondelez" });
</script>

<template>
  <main class="mx-auto max-w-2xl space-y-8 px-6 py-12 text-sm leading-relaxed text-toned">
    <header>
      <h1 class="mb-2 text-2xl font-semibold text-highlighted">Eve by SMS</h1>
      <p>Kondelez Eve is a personal AI assistant operated by Burhan Halilov.</p>
    </header>

    <section id="terms" class="space-y-3">
      <h2 class="text-lg font-medium text-highlighted">SMS terms</h2>
      <p>To connect SMS, sign in to Eve, open Settings → Profile, enter your mobile number and verify it by text. SMS chat requires a separate, optional checkbox. Once SMS chat is available, Eve sends AI-generated replies when you text it.</p>
      <p>Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. You can also turn off SMS replies in Profile. Carriers are not liable for delayed or undelivered messages.</p>
      <p>For support, <a href="https://kondelez.com/contact" class="underline">contact Kondelez</a>.</p>
    </section>

    <section id="privacy" class="space-y-3">
      <h2 class="text-lg font-medium text-highlighted">SMS privacy</h2>
      <p>We use your phone number to verify ownership, connect texts to your Eve account, and deliver replies. We store your verification and SMS consent status in your account. Messages are processed by Eve and its delivery, hosting, and AI providers. Messages may be retained in Eve’s conversation history and used to respond with your account context.</p>
      <p>Mobile information is not shared with third parties or affiliates for marketing or promotional purposes. SMS opt-in data and consent are not shared with third parties.</p>
    </section>
  </main>
</template>
