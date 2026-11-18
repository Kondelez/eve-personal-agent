import { COMPLETE_PROFILE_PATH, safeSignInDestination } from "#shared/sign-in";

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === "/sms") return;

  const login = to.path === "/login";
  const onboarding = to.path === COMPLETE_PROFILE_PATH;
  const destination = safeSignInDestination(login || onboarding ? to.query.redirect : to.fullPath);
  const cookieHeader = import.meta.server ? useResponseHeader("set-cookie") : undefined;
  const response = await useRequestFetch().raw("/api/onboarding");
  const profile = response._data?.profile;

  if (cookieHeader) {
    const cookies = response.headers.getSetCookie();
    if (cookies.length) cookieHeader.value = cookies;
  }

  if (!profile) {
    if (!login) return navigateTo({ path: "/login", query: { redirect: destination } });
    return;
  }
  if (!profile.complete) {
    if (!onboarding) return navigateTo({ path: COMPLETE_PROFILE_PATH, query: { redirect: destination } });
    return;
  }
  if (login || onboarding) return navigateTo(destination);
});
