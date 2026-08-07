export const SAYAC_GUNCELLENDI = "sayac-guncellendi";
export const MAP_NAV_RESET = "map-nav-reset";

export function notifySayacGuncellendi() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SAYAC_GUNCELLENDI));
  }
}

export function notifyMapNavReset() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MAP_NAV_RESET));
  }
}
