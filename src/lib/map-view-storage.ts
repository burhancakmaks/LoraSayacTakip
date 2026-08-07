export type SavedMapView = { lat: number; lng: number; zoom: number };

const MAP_VIEW_KEY = "maski-map-view";

export function readSavedMapView(): SavedMapView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MAP_VIEW_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedMapView;
    if (
      typeof data.lat === "number" &&
      typeof data.lng === "number" &&
      typeof data.zoom === "number" &&
      Number.isFinite(data.lat) &&
      Number.isFinite(data.lng) &&
      Number.isFinite(data.zoom)
    ) {
      return data;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveMapView(lat: number, lng: number, zoom: number) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(MAP_VIEW_KEY, JSON.stringify({ lat, lng, zoom }));
}

export function clearSavedMapView() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(MAP_VIEW_KEY);
}
