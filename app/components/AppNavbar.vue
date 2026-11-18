<template>
  <UDashboardNavbar class="shrink-0 bg-default" :ui="{ left: 'min-w-0', right: 'gap-1' }">
    <template #left>
      <slot name="title">
        <NuxtLink to="/" aria-label="Eve conversation" class="flex items-center">
          <AppLogo class="h-5 w-auto text-highlighted" />
        </NuxtLink>
      </slot>
    </template>

    <template #right>
      <slot />
      <UserMenu />
      <UColorModeButton />
    </template>
  </UDashboardNavbar>
</template>
