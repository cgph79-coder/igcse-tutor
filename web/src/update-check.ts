/**
 * Phones (especially home-screen apps) can keep running an old copy of the site after an update.
 * When the app is opened or comes back to the foreground, check version.json and reload if a
 * newer build is live — but only when it's safe (not mid-reply, nothing waiting to be sent).
 */
declare const __BUILD_ID__: string;

export function startUpdateCheck(isSafeToReload: () => boolean) {
  if (import.meta.env.DEV) return;
  let checking = false;
  const check = async () => {
    if (checking || document.visibilityState !== "visible") return;
    checking = true;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store" });
      const { build } = (await res.json()) as { build: string };
      if (build && build !== __BUILD_ID__ && isSafeToReload()) location.reload();
    } catch {
      /* offline or not deployed yet — try again next time */
    } finally {
      checking = false;
    }
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);
  check();
}
