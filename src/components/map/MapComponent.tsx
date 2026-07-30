"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import BuildingInfoModal from "./BuildingInfoModal";
import SayacModal from "./SayacModal";
import SayacSorunPanel, { type SayacSorunListeItem, type SorunListeFilter } from "./SayacSorunPanel";
import { useTheme } from "@/context/ThemeContext";
import { getTarifeColor } from "@/lib/tarife";
import { getSorunMarkerColor, type SayacSorunSeverity } from "@/lib/sayac-durum";
import MapNotificationBell from "./MapNotificationBell";
import { useNotifications } from "@/context/NotificationContext";

interface Building {
  id: number;
  oda_id: number | null;
  kml_id: number | null;
  id_2: number | null;
  value: string | null;
  layer: string | null;
  abone_sayisi: number;
  aktif_abone_sayisi: number;
  building_type_id: number | null;
  coordinates: [number, number][][];
  is_configured?: boolean;
  tarife_sinif?: string | null;
  tarife_etiket?: string | null;
  tarife_turu?: string | null;
  tarife_karma?: boolean;
  rezerv_abone_sayisi?: number;
  has_tarife?: boolean;
}

interface SelectedBuilding {
  id: number;
  value: string | null;
  layer: string | null;
  oda_id: number | null;
}

interface MahalleListItem {
  name: string;
  center: [number, number];
}

interface SayacSearchResult {
  bina_id: number;
  birim_no: number;
  blok_no: string;
  kat: string;
  kapi_no: string;
  sayac_id: string;
  abone_no: string;
  building_name: string;
  layer: string | null;
  oda_id: number | null;
  is_configured: boolean;
  coordinates: [number, number][][];
}

interface SayacSorunBina {
  bina_id: number;
  value: string;
  okunmadi: number;
  eksik: number;
  hatali: number;
  gecerli: number;
  severity: SayacSorunSeverity;
  center: [number, number] | null;
}

interface SayacSorunOzet {
  okunmadi: number;
  eksik: number;
  hatali: number;
  bina_sayisi: number;
  kritik_bina: number;
  eksik_bina: number;
}

function createSorunIcon(severity: Exclude<SayacSorunSeverity, null>) {
  const color = getSorunMarkerColor(severity);
  const symbol = severity === "kritik" ? "!" : "?";
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:white;font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:center;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);font-family:Outfit,sans-serif;line-height:1">${symbol}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

interface BuildingPolygonStyle {
  color: string;
  fillColor: string;
  fillOpacity: number;
  weight: number;
}

interface BuildingVisual extends BuildingPolygonStyle {
  headerColor: string;
  isConfigured: boolean;
  hasTarife: boolean;
}

function resolveBuildingVisual(building: Building): BuildingVisual {
  const isConfigured = !!building.is_configured;
  const hasTarife = !!building.has_tarife && !!building.tarife_sinif;
  const polyColor = isConfigured ? "#10b981" : "#465fff";

  return {
    color: polyColor,
    fillColor: polyColor,
    fillOpacity: isConfigured ? 0.38 : 0.25,
    weight: isConfigured ? 2.5 : 1.5,
    headerColor: polyColor,
    isConfigured,
    hasTarife,
  };
}

function buildPopupContent(building: Building, visual: BuildingVisual): string {
  const escValue = (building.value || "").replace(/"/g, "&quot;");
  const escLayer = (building.layer || "").replace(/"/g, "&quot;");
  const tarifeAccent = getTarifeColor(building.tarife_sinif);
  const tarifeBlock = visual.hasTarife
    ? `<div style="margin:8px 0;padding:8px 10px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;">
        <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Rezerv Alan Tarifesi</div>
        <div style="font-weight:700;color:${tarifeAccent};font-size:13px;">${building.tarife_etiket || "—"}${building.tarife_karma ? " (Karma)" : ""}</div>
        ${building.tarife_turu ? `<div style="font-size:11px;color:#64748b;margin-top:3px;line-height:1.35;">${building.tarife_turu.length > 80 ? building.tarife_turu.slice(0, 80) + "…" : building.tarife_turu}</div>` : ""}
        ${building.rezerv_abone_sayisi ? `<div style="font-size:11px;color:#64748b;margin-top:4px;">Rezerv abone: <strong>${building.rezerv_abone_sayisi}</strong></div>` : ""}
      </div>`
    : "";

  return `
    <div style="font-family: Outfit, sans-serif; font-size: 13px; color: #1c2434; padding: 4px; min-width: 210px;">
      <h4 style="margin: 0 0 6px 0; font-size: 14px; font-weight: 700; color: ${visual.headerColor}; padding-bottom: 5px; border-bottom: 1px solid #e5e7eb;">
        ${building.value || "Bilinmeyen Bina"}
      </h4>
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span style="color: #64748b;">Aktif Abone:</span>
        <span style="font-weight: 600; color: #10b981;">${building.aktif_abone_sayisi}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span style="color: #64748b;">Oda ID:</span>
        <span style="font-weight: 500;">${building.oda_id || "-"}</span>
      </div>
      ${tarifeBlock}
      <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
        <button
          class="bina-bilgi-btn"
          data-bina-id="${building.id}"
          data-value="${escValue}"
          data-layer="${escLayer}"
          data-oda-id="${building.oda_id ?? ""}"
          style="width:100%;padding:8px 12px;background:${visual.isConfigured ? '#10b981' : '#465fff'};color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:Outfit,sans-serif;"
        >
          🏢 Bina Bilgileri Düzenle
        </button>
        <button
          class="bina-sayac-btn"
          data-bina-id="${building.id}"
          data-value="${escValue}"
          data-layer="${escLayer}"
          data-oda-id="${building.oda_id ?? ""}"
          style="width:100%;padding:8px 12px;background:#10b981;color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:Outfit,sans-serif;"
        >
          ⚡ Sayaç Ekle / Düzenle
        </button>
      </div>
    </div>
  `;
}

const TILE_LAYERS = {
  standard: {
    label: "🗺️ Standart",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    isDark: false,
  },
  light: {
    label: "☁️ Açık",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    isDark: false,
  },
  dark: {
    label: "🌙 Gece Modu",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    isDark: true,
  },
  satellite: {
    label: "🛰️ Uydu",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, GeoEye, Earthstar Geographics',
    isDark: false,
  },
  topo: {
    label: "🗾 Topoğrafik",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://opentopomap.org/">OpenTopoMap</a>',
    isDark: false,
  },
} as const;

type TileKey = keyof typeof TILE_LAYERS;

export default function MapComponent() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const activeTileRef = useRef<L.TileLayer | null>(null);
  const allBoundsRef = useRef<L.LatLngBounds | null>(null);
  const activeHighlightRef = useRef<L.Polygon | null>(null);
  const buildingPolygonsRef = useRef<Map<number, L.Polygon[]>>(new Map());
  const buildingStylesRef = useRef<Map<number, BuildingPolygonStyle>>(new Map());
  const highlightedBinaIdRef = useRef<number | null>(null);
  const sorunMarkersRef = useRef<L.Marker[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, activeSubscribers: 0, rezervClassified: 0 });
  const [sorunOzet, setSorunOzet] = useState<SayacSorunOzet | null>(null);
  const [sorunLayerEnabled, setSorunLayerEnabled] = useState(true);

  // Layer switcher UI state
  const [activeLayer, setActiveLayer] = useState<TileKey>("standard");
  const [layerPickerOpen, setLayerPickerOpen] = useState(false);

  // Neighborhood UI state
  const [mahalleList, setMahalleList] = useState<MahalleListItem[]>([]);
  const [selectedMahalle, setSelectedMahalle] = useState<string>("🏘️ Mahalleler");
  const [mahallePickerOpen, setMahallePickerOpen] = useState(false);
  const [mahalleSearch, setMahalleSearch] = useState("");

  // Sayaç search state
  const [sayacSearch, setSayacSearch] = useState("");
  const [sayacResults, setSayacResults] = useState<SayacSearchResult[]>([]);
  const [sayacSearchOpen, setSayacSearchOpen] = useState(false);
  const [sayacSearching, setSayacSearching] = useState(false);
  const [selectedSayacLabel, setSelectedSayacLabel] = useState<string | null>(null);

  // Modals state
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding | null>(null);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [sayacModalOpen, setSayacModalOpen] = useState(false);
  const [sorunPanelOpen, setSorunPanelOpen] = useState(false);
  const [sorunPanelFilter, setSorunPanelFilter] = useState<SorunListeFilter>("all");

  const { setPanelOpen: setNotifPanelOpen, refresh: refreshNotifications } = useNotifications();

  const { theme } = useTheme();

  // Stable callback refs for Leaflet events
  const openInfoModalRef = useRef<(b: SelectedBuilding) => void>(() => {});
  openInfoModalRef.current = (b: SelectedBuilding) => {
    setSelectedBuilding(b);
    setInfoModalOpen(true);
  };

  const openSayacModalRef = useRef<(b: SelectedBuilding) => void>(() => {});
  openSayacModalRef.current = (b: SelectedBuilding) => {
    setSelectedBuilding(b);
    setSayacModalOpen(true);
  };

  // Sync theme changes
  useEffect(() => {
    if (!mapRef.current) return;
    setActiveLayer((prev) => {
      if (prev === "standard" || prev === "light" || prev === "dark") {
        return theme === "dark" ? "dark" : "standard";
      }
      return prev;
    });
  }, [theme]);

  const renderSorunMarkers = (binalar: SayacSorunBina[], enabled: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    sorunMarkersRef.current.forEach((m) => map.removeLayer(m));
    sorunMarkersRef.current = [];
    if (!enabled) return;

    for (const b of binalar) {
      if (!b.center || !b.severity) continue;
      const marker = L.marker(b.center, { icon: createSorunIcon(b.severity), zIndexOffset: 1000 });
      const lines = [
        b.okunmadi ? `<div>🔴 Okunmadı: <strong>${b.okunmadi}</strong></div>` : "",
        b.hatali ? `<div>🔴 Hatalı: <strong>${b.hatali}</strong></div>` : "",
        b.eksik ? `<div>🟡 Eksik: <strong>${b.eksik}</strong></div>` : "",
      ].filter(Boolean).join("");
      marker.bindPopup(`
        <div style="font-family:Outfit,sans-serif;font-size:13px;min-width:180px">
          <div style="font-weight:700;margin-bottom:6px">${b.value}</div>
          ${lines}
          <div style="margin-top:8px;font-size:11px;color:#64748b">Geçerli sayaç: ${b.gecerli}</div>
        </div>
      `);
      marker.on("click", () => zoomToBuilding(b.bina_id));
      marker.addTo(map);
      sorunMarkersRef.current.push(marker);
    }
  };

  const refreshSorunData = useCallback(() => {
    fetch("/api/sayac/sorunlar")
      .then((r) => r.json())
      .then((data: { ozet: SayacSorunOzet; binalar: SayacSorunBina[] }) => {
        setSorunOzet(data.ozet);
        renderSorunMarkers(data.binalar, sorunLayerEnabled);
      })
      .catch(() => setSorunOzet(null));
    refreshNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorunLayerEnabled, refreshNotifications]);

  useEffect(() => {
    if (loading || error) return;
    refreshSorunData();
  }, [loading, error, refreshSorunData]);

  useEffect(() => {
    if (loading || error || !sorunOzet) return;
    fetch("/api/sayac/sorunlar")
      .then((r) => r.json())
      .then((data: { binalar: SayacSorunBina[] }) => renderSorunMarkers(data.binalar, sorunLayerEnabled))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorunLayerEnabled]);

  // Switch tile layer
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const def = TILE_LAYERS[activeLayer];

    if (activeTileRef.current) {
      map.removeLayer(activeTileRef.current);
    }

    const newTile = L.tileLayer(def.url, {
      attribution: def.attribution,
      maxZoom: 19,
    });

    newTile.addTo(map);
    newTile.bringToBack();
    activeTileRef.current = newTile;
  }, [activeLayer]);

  // Load neighborhood list from database
  useEffect(() => {
    fetch("/api/mahalleler")
      .then((res) => {
        if (!res.ok) throw new Error("Mahalle listesi alınamadı.");
        return res.json();
      })
      .then((data: MahalleListItem[]) => {
        setMahalleList(data);
      })
      .catch((err) => {
        console.error("Error loading neighborhood list:", err);
      });
  }, []);

  const clearBuildingHighlight = () => {
    highlightedBinaIdRef.current = null;
    buildingPolygonsRef.current.forEach((polygons, binaId) => {
      const style = buildingStylesRef.current.get(binaId);
      if (!style) return;
      polygons.forEach((polygon) => {
        polygon.setStyle({
          color: style.color,
          fillColor: style.fillColor,
          fillOpacity: style.fillOpacity,
          weight: style.weight,
        });
      });
    });
  };

  const highlightBuilding = (binaId: number) => {
    clearBuildingHighlight();
    highlightedBinaIdRef.current = binaId;
    const polygons = buildingPolygonsRef.current.get(binaId) || [];
    polygons.forEach((polygon) => {
      polygon.setStyle({
        color: "#f59e0b",
        fillColor: "#f59e0b",
        fillOpacity: 0.55,
        weight: 4,
      });
      polygon.bringToFront();
    });
    return polygons;
  };

  // Debounced sayaç search
  useEffect(() => {
    const q = sayacSearch.trim();
    if (q.length < 3) {
      setSayacResults([]);
      setSayacSearching(false);
      return;
    }

    setSayacSearching(true);
    const timer = setTimeout(() => {
      fetch(`/api/sayac/search?q=${encodeURIComponent(q)}`)
        .then((res) => {
          if (!res.ok) throw new Error("Arama başarısız");
          return res.json();
        })
        .then((data: SayacSearchResult[]) => {
          setSayacResults(data);
          setSayacSearchOpen(true);
        })
        .catch((err) => {
          console.error("Sayaç arama hatası:", err);
          setSayacResults([]);
        })
        .finally(() => setSayacSearching(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [sayacSearch]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let cancelled = false;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
    }).setView([38.3552, 38.3302], 14);

    mapRef.current = map;

    const initialLayerKey: TileKey = theme === "dark" ? "dark" : "standard";
    const initialDef = TILE_LAYERS[initialLayerKey];
    const initialTile = L.tileLayer(initialDef.url, {
      attribution: initialDef.attribution,
      maxZoom: 19,
    }).addTo(map);
    activeTileRef.current = initialTile;
    setActiveLayer(initialLayerKey);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Listen for popup buttons
    map.on("popupopen", (e) => {
      const el = e.popup.getElement();
      if (!el) return;

      const infoBtn = el.querySelector<HTMLButtonElement>(".bina-bilgi-btn");
      if (infoBtn) {
        infoBtn.onclick = () => {
          const id = parseInt(infoBtn.dataset.binaId || "0");
          const value = infoBtn.dataset.value || null;
          const layer = infoBtn.dataset.layer || null;
          const odaId = infoBtn.dataset.odaId ? parseInt(infoBtn.dataset.odaId) : null;
          map.closePopup();
          openInfoModalRef.current({ id, value, layer, oda_id: odaId });
        };
      }

      const sayacBtn = el.querySelector<HTMLButtonElement>(".bina-sayac-btn");
      if (sayacBtn) {
        sayacBtn.onclick = () => {
          const id = parseInt(sayacBtn.dataset.binaId || "0");
          const value = sayacBtn.dataset.value || null;
          const layer = sayacBtn.dataset.layer || null;
          const odaId = sayacBtn.dataset.odaId ? parseInt(sayacBtn.dataset.odaId) : null;
          map.closePopup();
          openSayacModalRef.current({ id, value, layer, oda_id: odaId });
        };
      }
    });

    fetch("/api/binalar")
      .then((res) => {
        if (!res.ok) throw new Error("Veriler yüklenirken hata oluştu.");
        return res.json();
      })
      .then((data: Building[]) => {
        if (cancelled || !mapRef.current) return;

        let totalActive = 0;
        let rezervClassified = 0;
        const boundsPoints: L.LatLng[] = [];

        data.forEach((building) => {
          totalActive += building.aktif_abone_sayisi || 0;
          if (building.has_tarife) rezervClassified++;

          const visual = resolveBuildingVisual(building);

          buildingStylesRef.current.set(building.id, {
            color: visual.color,
            fillColor: visual.fillColor,
            fillOpacity: visual.fillOpacity,
            weight: visual.weight,
          });

          const buildingPolygons: L.Polygon[] = [];

          building.coordinates.forEach((polygonCoords) => {
            const polygon = L.polygon(polygonCoords, {
              color: visual.color,
              fillColor: visual.fillColor,
              fillOpacity: visual.fillOpacity,
              weight: visual.weight,
            }).addTo(map);

            polygonCoords.forEach(([lat, lng]) => {
              boundsPoints.push(L.latLng(lat, lng));
            });

            polygon.bindPopup(buildPopupContent(building, visual), { minWidth: 230 });

            polygon.on("mouseover", () => {
              if (highlightedBinaIdRef.current === building.id) return;
              polygon.setStyle({
                fillColor: visual.isConfigured ? "#059669" : "#3c50e0",
                fillOpacity: 0.45,
                weight: visual.weight + 0.5,
              });
            });
            polygon.on("mouseout", () => {
              if (highlightedBinaIdRef.current === building.id) return;
              polygon.setStyle({
                fillColor: visual.fillColor,
                fillOpacity: visual.fillOpacity,
                weight: visual.weight,
              });
            });

            buildingPolygons.push(polygon);
          });

          if (buildingPolygons.length > 0) {
            buildingPolygonsRef.current.set(building.id, buildingPolygons);
          }
        });

        if (cancelled || !mapRef.current) return;

        if (boundsPoints.length > 0) {
          const bounds = L.latLngBounds(boundsPoints);
          allBoundsRef.current = bounds;
          if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
        }

        setStats({ total: data.length, activeSubscribers: totalActive, rezervClassified });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        activeTileRef.current = null;
        activeHighlightRef.current = null;
        buildingPolygonsRef.current.clear();
        buildingStylesRef.current.clear();
        highlightedBinaIdRef.current = null;
        sorunMarkersRef.current.forEach((m) => mapRef.current?.removeLayer(m));
        sorunMarkersRef.current = [];
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getBoundsFromCoords = (coordinates: [number, number][][]) => {
    const bounds = L.latLngBounds([]);
    coordinates.forEach((polygonCoords) => {
      polygonCoords.forEach(([lat, lng]) => bounds.extend([lat, lng]));
    });
    return bounds;
  };

  const zoomToBuilding = (binaId: number, coordinates?: [number, number][][]) => {
    if (!mapRef.current) return [];
    const map = mapRef.current;

    const polygons = highlightBuilding(binaId);
    let bounds: L.LatLngBounds | null = null;

    if (polygons.length > 0) {
      bounds = L.latLngBounds([]);
      polygons.forEach((polygon) => {
        const latLngs = polygon.getLatLngs();
        if (Array.isArray(latLngs[0])) {
          (latLngs as L.LatLng[][]).forEach((ring) => {
            ring.forEach((ll) => bounds!.extend(ll));
          });
        } else {
          (latLngs as L.LatLng[]).forEach((ll) => bounds!.extend(ll));
        }
      });
    } else if (coordinates?.length) {
      bounds = getBoundsFromCoords(coordinates);
    }

    if (bounds?.isValid()) {
      const center = bounds.getCenter();
      map.flyTo(center, 19, { duration: 0.7, animate: true });
      // Küçük binalar için fitBounds yeterli yakınlaşmayı vermeyebilir; merkeze sabit zoom uygula
      setTimeout(() => {
        if (mapRef.current && mapRef.current.getZoom() < 18) {
          mapRef.current.setView(center, 19);
        }
      }, 750);
    }

    if (polygons.length > 0) {
      polygons[0].openPopup();
    }

    return polygons;
  };

  const openSorunPanel = (filter: SorunListeFilter = "all") => {
    setSorunPanelFilter(filter);
    setSorunPanelOpen(true);
    setLayerPickerOpen(false);
    setMahallePickerOpen(false);
    setSayacSearchOpen(false);
  };

  const handleSorunListeSelect = (item: SayacSorunListeItem) => {
    if (!mapRef.current) return;
    setSorunPanelOpen(false);
    setLayerPickerOpen(false);
    setMahallePickerOpen(false);
    setSayacSearchOpen(false);

    if (activeHighlightRef.current) {
      mapRef.current.removeLayer(activeHighlightRef.current);
      activeHighlightRef.current = null;
    }
    setSelectedMahalle("🏘️ Mahalleler");

    zoomToBuilding(item.bina_id, item.coordinates);
    setSelectedBuilding({
      id: item.bina_id,
      value: item.building_name,
      layer: item.layer,
      oda_id: item.oda_id,
    });
    setSayacModalOpen(true);
  };

  const handleSayacSelect = (result: SayacSearchResult) => {
    if (!mapRef.current) return;

    setSayacSearchOpen(false);
    setSayacSearch(result.sayac_id);
    setSelectedSayacLabel(`${result.sayac_id} → ${result.building_name}`);
    setLayerPickerOpen(false);
    setMahallePickerOpen(false);

    if (activeHighlightRef.current) {
      mapRef.current.removeLayer(activeHighlightRef.current);
      activeHighlightRef.current = null;
    }
    setSelectedMahalle("🏘️ Mahalleler");

    zoomToBuilding(result.bina_id, result.coordinates);

    setSelectedBuilding({
      id: result.bina_id,
      value: result.building_name,
      layer: result.layer,
      oda_id: result.oda_id,
    });
    setSayacModalOpen(true);
  };

  const clearSayacSearch = () => {
    setSayacSearch("");
    setSayacResults([]);
    setSayacSearchOpen(false);
    setSelectedSayacLabel(null);
    clearBuildingHighlight();
    if (mapRef.current && allBoundsRef.current?.isValid()) {
      mapRef.current.fitBounds(allBoundsRef.current, { padding: [20, 20] });
    }
  };

  const handleMahalleSelect = (name: string, center: [number, number] | null) => {
    if (mapRef.current) {
      const map = mapRef.current;
      setMahallePickerOpen(false);
      setMahalleSearch(""); // Clear search value when selected

      // Clean up previous highlight
      if (activeHighlightRef.current) {
        map.removeLayer(activeHighlightRef.current);
        activeHighlightRef.current = null;
      }

      // If "Clear" is clicked
      if (!center) {
        setSelectedMahalle("🏘️ Mahalleler");
        if (allBoundsRef.current && allBoundsRef.current.isValid()) {
          map.fitBounds(allBoundsRef.current, { padding: [20, 20] });
        }
        return;
      }

      setSelectedMahalle(name);

      // Fetch dynamic neighborhood polygon from database API
      fetch(`/api/mahalleler?name=${encodeURIComponent(name)}`)
        .then((res) => {
          if (!res.ok) throw new Error("Mahalle sınırları yüklenemedi.");
          return res.json();
        })
        .then((data) => {
          if (!mapRef.current) return;

          map.setView(data.center, 16);

          // Draw official boundary polygon with click-through enabled (interactive: false)
          const highlight = L.polygon(data.coordinates, {
            color: "#f97316", // Orange boundary line
            fillColor: "#f97316",
            fillOpacity: 0.03, // Low opacity to keep building layers fully visible
            weight: 2.5,
            dashArray: "6, 10", // Dashed outline
            interactive: false, // Passes all clicks to underlying binalar
          }).addTo(mapRef.current);

          activeHighlightRef.current = highlight;
        })
        .catch((err) => {
          console.error(err);
        });
    }
  };

  // Filter neighborhood list dynamically based on search
  const filteredMahalleList = mahalleList.filter((m) =>
    m.name.toLocaleLowerCase("tr-TR").includes(mahalleSearch.toLocaleLowerCase("tr-TR"))
  );

  return (
    <div className="relative w-full h-full">
      {/* Loading */}
      {loading && (
        <div className="absolute inset-0 z-9999 flex flex-col items-center justify-center bg-white/80 dark:bg-gray-900/80 backdrop-blur-xs">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-500 border-t-transparent"></div>
          <p className="mt-4 font-semibold text-gray-700 dark:text-gray-200">
            SQLite veritabanından binalar yükleniyor...
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute inset-0 z-9999 flex flex-col items-center justify-center bg-white dark:bg-gray-900 p-4 text-center">
          <div className="text-red-500 font-bold text-lg mb-2">Hata Oluştu</div>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-md font-semibold transition">
            Yeniden Dene
          </button>
        </div>
      )}

      {/* Sol Panel: İstatistik + Sayaç Sorunları */}
      {!loading && !error && (
        <div className="absolute top-4 left-4 z-999 flex items-stretch gap-3 pointer-events-none h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)]">
          <div className="pointer-events-auto flex flex-col gap-3 w-52 shrink-0 overflow-y-auto max-h-full pr-1">
            {/* Stats Widget */}
            <div className="bg-white/95 dark:bg-gray-900/95 shadow-lg rounded-xl p-4 border border-gray-100 dark:border-gray-800 backdrop-blur-sm flex flex-col gap-2">
              <h3 className="font-bold text-gray-800 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-2 flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-brand-500 animate-ping inline-block"></span>
                Malatya Bina Verileri
              </h3>
              <div className="grid grid-cols-2 gap-4 text-center text-xs mt-1">
                <div>
                  <div className="font-bold text-xl text-brand-500">{stats.total.toLocaleString("tr-TR")}</div>
                  <div className="text-gray-500 dark:text-gray-400 font-medium">Toplam Bina</div>
                </div>
                <div>
                  <div className="font-bold text-xl text-emerald-500">{stats.activeSubscribers.toLocaleString("tr-TR")}</div>
                  <div className="text-gray-500 dark:text-gray-400 font-medium">Aktif Abone</div>
                </div>
              </div>
              {stats.rezervClassified > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-center">
                  <div className="font-bold text-lg text-violet-500">{stats.rezervClassified}</div>
                  <div className="text-gray-500 dark:text-gray-400 font-medium text-[11px]">Rezerv Tarife Sınıflı Bina</div>
                </div>
              )}
            </div>

            {/* Sayaç Sorunları Widget */}
            {sorunOzet && sorunOzet.bina_sayisi > 0 && (
              <div className="bg-white/95 dark:bg-gray-900/95 shadow-lg rounded-xl p-3 border border-gray-100 dark:border-gray-800 backdrop-blur-sm flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-gray-800 dark:text-white">Sayaç Sorunları</h4>
                  <span className="text-[10px] font-semibold text-gray-400">{sorunOzet.bina_sayisi} bina</span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => openSorunPanel("okuma")}
                    className="rounded-lg py-2 px-1.5 text-center bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition border border-red-100 dark:border-red-500/20"
                    title="OKUNMADI ve hatalı numara"
                  >
                    <div className="font-bold text-red-500 text-sm">{sorunOzet.okunmadi + sorunOzet.hatali}</div>
                    <div className="text-[9px] text-gray-500 leading-tight">Hatalı Okuma</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => openSorunPanel("eksik")}
                    className="rounded-lg py-2 px-1.5 text-center bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition border border-amber-100 dark:border-amber-500/20"
                    title="Boş veya girilmemiş sayaç no"
                  >
                    <div className="font-bold text-amber-500 text-sm">{sorunOzet.eksik}</div>
                    <div className="text-[9px] text-gray-500 leading-tight">Eksik</div>
                  </button>
                </div>

                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSorunLayerEnabled((v) => !v);
                      setLayerPickerOpen(false);
                      setMahallePickerOpen(false);
                      setSayacSearchOpen(false);
                    }}
                    className={`flex-1 text-[11px] font-semibold py-2 rounded-lg border transition ${
                      sorunLayerEnabled
                        ? "bg-red-500 text-white border-red-400"
                        : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    {sorunLayerEnabled ? "İşaretleri Gizle" : "İşaretleri Göster"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (sorunPanelOpen) setSorunPanelOpen(false);
                      else openSorunPanel("all");
                    }}
                    className={`flex-1 text-[11px] font-semibold py-2 rounded-lg border transition ${
                      sorunPanelOpen
                        ? "bg-brand-500 text-white border-brand-400"
                        : "bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-200 dark:border-brand-500/30 hover:bg-brand-100 dark:hover:bg-brand-500/20"
                    }`}
                  >
                    Rapor
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Sorun Raporu — yan çekmece */}
          {sorunPanelOpen && (
            <>
              <div
                className="fixed inset-0 z-998 bg-black/15 pointer-events-auto sm:hidden"
                onClick={() => setSorunPanelOpen(false)}
              />
              <SayacSorunPanel
                isOpen={sorunPanelOpen}
                onClose={() => setSorunPanelOpen(false)}
                initialFilter={sorunPanelFilter}
                onSelect={handleSorunListeSelect}
              />
            </>
          )}
        </div>
      )}

      {/* Controls Container */}
      {!loading && !error && (
        <div className="absolute top-4 right-4 z-999 flex flex-col gap-2.5 items-end">
          {/* Sayaç Search */}
          <div className="relative w-80">
            <div className="flex items-center gap-2 bg-white/95 dark:bg-gray-900/95 shadow-lg rounded-xl px-3 py-2 border border-gray-100 dark:border-gray-800 backdrop-blur-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="Sayaç veya abone no ara..."
                value={sayacSearch}
                onChange={(e) => {
                  setSayacSearch(e.target.value);
                  setSelectedSayacLabel(null);
                  if (e.target.value.trim().length >= 3) setSayacSearchOpen(true);
                }}
                onFocus={() => {
                  setLayerPickerOpen(false);
                  setMahallePickerOpen(false);
                  setNotifPanelOpen(false);
                  if (sayacSearch.trim().length >= 3) setSayacSearchOpen(true);
                }}
                className="flex-1 bg-transparent text-sm text-gray-800 dark:text-white placeholder:text-gray-400 focus:outline-none"
              />
              {sayacSearching && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent shrink-0" />
              )}
              {(sayacSearch || selectedSayacLabel) && (
                <button
                  onClick={clearSayacSearch}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs font-semibold shrink-0"
                  title="Temizle"
                >
                  ✕
                </button>
              )}
            </div>

            {selectedSayacLabel && (
              <div className="mt-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] font-semibold text-amber-700 dark:text-amber-300 truncate">
                {selectedSayacLabel}
              </div>
            )}

            {sayacSearchOpen && sayacSearch.trim().length >= 3 && (
              <div className="absolute right-0 mt-2 w-full bg-white/98 dark:bg-gray-900/98 shadow-xl rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden backdrop-blur-sm z-999">
                <div className="max-h-72 overflow-y-auto">
                  {sayacResults.length === 0 && !sayacSearching ? (
                    <div className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 text-center">
                      Eşleşen sayaç bulunamadı.
                    </div>
                  ) : (
                    sayacResults.map((result, idx) => (
                      <button
                        key={`${result.bina_id}-${result.birim_no}-${result.sayac_id}-${idx}`}
                        onClick={() => handleSayacSelect(result)}
                        className="w-full text-left px-4 py-3 text-sm border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                      >
                        <div className="font-bold text-brand-600 dark:text-brand-400 font-mono tracking-wide">
                          {result.sayac_id}
                        </div>
                        <div className="text-xs text-gray-700 dark:text-gray-300 mt-0.5 font-semibold truncate">
                          {result.building_name}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                          {result.blok_no && <span>Blok: {result.blok_no}</span>}
                          {result.kat && <span>Kat: {result.kat}</span>}
                          {result.kapi_no && <span>Kapı: {result.kapi_no}</span>}
                          {result.abone_no && <span>Abone: {result.abone_no}</span>}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Araç çubuğu: bildirim + katman + mahalle */}
          <div className="flex items-start gap-2 w-80">
            <Link
              href="/sayac-aktarim"
              className="shrink-0 flex items-center gap-1.5 rounded-xl bg-white/95 dark:bg-gray-900/95 shadow-lg border border-gray-100 dark:border-gray-800 backdrop-blur-sm px-3 py-2.5 text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10 transition"
              title="Excel'den sayaç verisi aktar"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16v10H4z" />
                <path d="M4 9h16M8 13h8M8 16h5" />
              </svg>
              Aktarım
            </Link>
            <MapNotificationBell
              onBinaClick={(binaId) => zoomToBuilding(binaId)}
              onToggle={(open) => {
                if (open) {
                  setLayerPickerOpen(false);
                  setMahallePickerOpen(false);
                  setSayacSearchOpen(false);
                }
              }}
            />

            <div className="relative flex-1 min-w-0">
            <button
              onClick={() => {
                setLayerPickerOpen((v) => !v);
                setMahallePickerOpen(false);
                setSayacSearchOpen(false);
                setNotifPanelOpen(false);
              }}
              className="flex w-full items-center gap-1.5 bg-white/95 dark:bg-gray-900/95 shadow-lg rounded-xl px-3 py-2.5 border border-gray-100 dark:border-gray-800 backdrop-blur-sm text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800 transition truncate"
              title="Katman Seç"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
              <span className="truncate">{TILE_LAYERS[activeLayer].label}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`shrink-0 ml-auto transition-transform ${layerPickerOpen ? "rotate-180" : ""}`}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {layerPickerOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-white/98 dark:bg-gray-900/98 shadow-xl rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden backdrop-blur-sm z-999">
                {(Object.entries(TILE_LAYERS) as [TileKey, typeof TILE_LAYERS[TileKey]][]).map(([key, def]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setActiveLayer(key);
                      setLayerPickerOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition hover:bg-gray-50 dark:hover:bg-gray-800 ${
                      activeLayer === key
                        ? "bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400 font-semibold"
                        : "text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    <span className="text-base">{def.label.split(" ")[0]}</span>
                    <span>{def.label.split(" ").slice(1).join(" ")}</span>
                    {activeLayer === key && (
                      <svg className="ml-auto" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
            </div>

            <div className="relative flex-1 min-w-0">
            <button
              onClick={() => {
                setMahallePickerOpen((v) => !v);
                setLayerPickerOpen(false);
                setSayacSearchOpen(false);
                setMahalleSearch("");
                setNotifPanelOpen(false);
              }}
              className="flex w-full items-center gap-1.5 bg-white/95 dark:bg-gray-900/95 shadow-lg rounded-xl px-3 py-2.5 border border-gray-100 dark:border-gray-800 backdrop-blur-sm text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800 transition"
              title="Mahalleye Odaklan"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="truncate">{selectedMahalle}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`shrink-0 ml-auto transition-transform ${mahallePickerOpen ? "rotate-180" : ""}`}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {mahallePickerOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white/98 dark:bg-gray-900/98 shadow-xl rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden backdrop-blur-sm z-999 flex flex-col">
                <div className="p-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
                  <input
                    type="text"
                    placeholder="Mahalle ara..."
                    value={mahalleSearch}
                    onChange={(e) => setMahalleSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs text-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>

                <div className="max-h-60 overflow-y-auto">
                  <button
                    onClick={() => handleMahalleSelect("🏘️ Mahalleler", null)}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition hover:bg-gray-50 dark:hover:bg-gray-850 text-red-500 font-semibold border-b border-gray-100 dark:border-gray-800"
                  >
                    <span>❌</span>
                    <span>Odaklanmayı Temizle</span>
                  </button>

                  {filteredMahalleList.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 text-center">
                      Eşleşen mahalle bulunamadı.
                    </div>
                  ) : (
                    filteredMahalleList.map((mahalle) => (
                      <button
                        key={mahalle.name}
                        onClick={() => handleMahalleSelect(mahalle.name, mahalle.center)}
                        className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition hover:bg-gray-50 dark:hover:bg-gray-800 ${
                          selectedMahalle === mahalle.name
                            ? "bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400 font-semibold"
                            : "text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        <span className="text-sm">🏘️</span>
                        <span>{mahalle.name}</span>
                        {selectedMahalle === mahalle.name && (
                          <svg className="ml-auto text-brand-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* Map Container */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Building Info Modal */}
      {infoModalOpen && (
        <BuildingInfoModal
          building={selectedBuilding}
          onClose={() => { setInfoModalOpen(false); setSelectedBuilding(null); }}
        />
      )}

      {/* Sayac Modal */}
      {sayacModalOpen && (
        <SayacModal
          building={selectedBuilding}
          onClose={() => { setSayacModalOpen(false); setSelectedBuilding(null); }}
        />
      )}

    </div>
  );
}
