export function buildGoogleMapsUrl(lat: number, lng: number, label?: string) {
  const coords = label
    ? `${lat},${lng}(${encodeURIComponent(label)})`
    : `${lat},${lng}`;
  return `https://www.google.com/maps?q=${coords}&z=19`;
}

export function openGoogleMaps(lat: number, lng: number, label?: string) {
  if (typeof window === "undefined") return;
  window.open(buildGoogleMapsUrl(lat, lng, label), "_blank", "noopener,noreferrer");
}
