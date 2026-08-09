type DbRow = Record<string, unknown>;

export type HaritaExportFormat = "json" | "kml" | "geojson";

export interface HaritaExportPayload {
  format: string;
  version: number;
  exported_at: string;
  summary: {
    building_count: number;
    meter_record_count: number;
    building_info_count: number;
    tariff_record_count: number;
  };
  buildings: Array<Record<string, unknown>>;
}

function parseCoordinates(value: unknown): [number, number][][] {
  if (Array.isArray(value)) return value as [number, number][][];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as [number, number][][]) : [];
  } catch {
    return [];
  }
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ringToKml(ring: [number, number][]): string {
  return ring.map(([lat, lng]) => `${lng},${lat},0`).join(" ");
}

function coordinatesToKmlGeometry(coords: [number, number][][]): string {
  if (!coords.length) return "";
  if (coords.length === 1) {
    return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ringToKml(coords[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  }
  return `<MultiGeometry>${coords
    .map(
      (ring) =>
        `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ringToKml(ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
    )
    .join("")}</MultiGeometry>`;
}

export function buildHaritaExportPayload(
  buildings: DbRow[],
  buildingInfo: DbRow[],
  meters: DbRow[],
  tariffs: DbRow[],
  exportedAt: string
): HaritaExportPayload {
  const infoByBuilding = new Map(buildingInfo.map((row) => [Number(row.bina_id), row]));
  const tariffByBuilding = new Map(tariffs.map((row) => [Number(row.bina_id), row]));
  const metersByBuilding = new Map<number, DbRow[]>();

  for (const meter of meters) {
    const buildingId = Number(meter.bina_id);
    const current = metersByBuilding.get(buildingId) ?? [];
    current.push(meter);
    metersByBuilding.set(buildingId, current);
  }

  return {
    format: "LoraSayacTakip.HaritaExport",
    version: 1,
    exported_at: exportedAt,
    summary: {
      building_count: buildings.length,
      meter_record_count: meters.length,
      building_info_count: buildingInfo.length,
      tariff_record_count: tariffs.length,
    },
    buildings: buildings.map((building) => {
      const id = Number(building.id);
      return {
        ...building,
        coordinates: parseCoordinates(building.coordinates),
        building_info: infoByBuilding.get(id) ?? null,
        tariff: tariffByBuilding.get(id) ?? null,
        meters: metersByBuilding.get(id) ?? [],
      };
    }),
  };
}

export function buildHaritaKml(payload: HaritaExportPayload): string {
  const placemarks = payload.buildings
    .map((building) => {
      const coords = (building.coordinates as [number, number][][]) ?? [];
      const geometry = coordinatesToKmlGeometry(coords);
      if (!geometry) return "";

      const id = Number(building.id);
      const name = String(building.value ?? `Bina ${id}`);
      const odaId = building.oda_id ?? "";
      const layer = building.layer ?? "";
      const meters = building.meters as unknown[] | undefined;
      const sayacCount = building.sayac_count ?? meters?.length ?? 0;
      const tariff = building.tariff as Record<string, unknown> | null | undefined;

      return `<Placemark>
  <name>${escapeXml(name)}</name>
  <ExtendedData>
    <Data name="bina_id"><value>${id}</value></Data>
    <Data name="oda_id"><value>${escapeXml(odaId)}</value></Data>
    <Data name="layer"><value>${escapeXml(layer)}</value></Data>
    <Data name="sayac_count"><value>${escapeXml(sayacCount)}</value></Data>
    <Data name="aktif_abone_sayisi"><value>${escapeXml(building.aktif_abone_sayisi ?? "")}</value></Data>
    <Data name="tarife_sinif"><value>${escapeXml(tariff?.tarife_sinif ?? building.tarife_sinif ?? "")}</value></Data>
    <Data name="exported_at"><value>${escapeXml(payload.exported_at)}</value></Data>
  </ExtendedData>
  ${geometry}
</Placemark>`;
    })
    .filter(Boolean)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>LoraSayacTakip Harita Export</name>
  <description>MASKİ Lora Sayaç Takip — ${escapeXml(payload.exported_at)}</description>
  ${placemarks}
</Document>
</kml>`;
}

export function buildHaritaGeoJson(payload: HaritaExportPayload): string {
  const features = payload.buildings
    .map((building) => {
      const coords = (building.coordinates as [number, number][][]) ?? [];
      if (!coords.length) return null;

      const rings = coords.map((ring) => ring.map(([lat, lng]) => [lng, lat]));
      const geometry =
        rings.length === 1
          ? { type: "Polygon", coordinates: rings }
          : { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };

      const tariff = building.tariff as Record<string, unknown> | null | undefined;

      return {
        type: "Feature",
        properties: {
          bina_id: building.id,
          oda_id: building.oda_id,
          value: building.value,
          layer: building.layer,
          sayac_count: building.sayac_count,
          aktif_abone_sayisi: building.aktif_abone_sayisi,
          tarife_sinif: tariff?.tarife_sinif ?? building.tarife_sinif ?? null,
        },
        geometry,
      };
    })
    .filter(Boolean);

  return JSON.stringify({
    type: "FeatureCollection",
    exported_at: payload.exported_at,
    features,
  });
}

export function haritaExportFilename(format: HaritaExportFormat, exportedAt: string): string {
  const date = exportedAt.slice(0, 10);
  if (format === "kml") return `harita-verileri-${date}.kml`;
  if (format === "geojson") return `harita-verileri-${date}.geojson`;
  return `harita-verileri-${date}.json`;
}

export function haritaExportContentType(format: HaritaExportFormat): string {
  if (format === "kml") return "application/vnd.google-earth.kml+xml; charset=utf-8";
  if (format === "geojson") return "application/geo+json; charset=utf-8";
  return "application/json; charset=utf-8";
}

export function serializeHaritaExportBody(format: HaritaExportFormat, payload: HaritaExportPayload): string {
  if (format === "kml") return buildHaritaKml(payload);
  if (format === "geojson") return buildHaritaGeoJson(payload);
  // UTF-8 BOM helps Windows recognize plain-text JSON (avoids WinRAR mis-open).
  return `\uFEFF${JSON.stringify(payload, null, 2)}`;
}
