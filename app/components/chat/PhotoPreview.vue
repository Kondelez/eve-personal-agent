<script setup lang="ts">
defineProps<{ url: string; name: string }>();
</script>

<template>
  <UModal :title="name" :ui="{ content: 'sm:max-w-5xl', body: 'flex items-center justify-center p-2 sm:p-4' }">
    <button
      type="button"
      class="my-1 block w-fit cursor-zoom-in overflow-hidden rounded-lg border border-default"
      :aria-label="`Enlarge ${name}`"
    >
      <img :src="url" :alt="name" class="max-h-64 max-w-full object-contain" loading="lazy">
    </button>
    <template #body>
      <img :src="url" :alt="name" class="max-h-[75dvh] max-w-full object-contain">
    </template>
  </UModal>
</template>
