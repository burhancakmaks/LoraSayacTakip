export const SAYAC_GUNCELLENDI = "sayac-guncellendi";

export function notifySayacGuncellendi() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SAYAC_GUNCELLENDI));
  }
}
