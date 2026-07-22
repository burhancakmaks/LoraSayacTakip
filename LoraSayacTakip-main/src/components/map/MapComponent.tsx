"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import BuildingInfoModal from "./BuildingInfoModal";
import SayacModal from "./SayacModal";
import { useTheme } from "@/context/ThemeContext";

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
  excel_kayit_sayisi: number;
  excel_abone_sayisi: number;
  excel_sayac_sayisi: number;
  eksik_abone_sayisi: number;
  eksik_sayac_sayisi: number;
  excel_ada: string;
  excel_blok: string;
  excel_mahalle: string;
  excel_adres: string;
  has_meter_number: boolean;
}

interface SelectedBuilding {
  id: number;
  value: string | null;
  layer: string | null;
  oda_id: number | null;
  ada?: string;
  blok?: string;
  disKapiNo?: string;
}

interface MahalleListItem {
  name: string;
  center: [number, number];
}

type BuildingFilter = "metered" | "all" | "excel" | "active" | "missing" | "configured";

interface MapSummary {
  totalMeters: number;
  linkedMeters: number;
  pendingMeters: number;
  meteredBuildings: number;
}

interface BuildingLayerEntry {
  building: Building;
  layer: L.Path;
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
  const buildingLayersRef = useRef<BuildingLayerEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, activeSubscribers: 0, importedSubscribers: 0, excelRecords: 0 });
  const [mapSummary, setMapSummary] = useState<MapSummary>({ totalMeters: 0, linkedMeters: 0, pendingMeters: 0, meteredBuildings: 0 });
  const [buildingIndex, setBuildingIndex] = useState<Building[]>([]);
  const [buildingSearch, setBuildingSearch] = useState("");
  const [buildingFilter, setBuildingFilter] = useState<BuildingFilter>("all");
  const [filterPickerOpen, setFilterPickerOpen] = useState(false);

  // Layer switcher UI state
  const [activeLayer, setActiveLayer] = useState<TileKey>("standard");
  const [layerPickerOpen, setLayerPickerOpen] = useState(false);

  // Neighborhood UI state
  const [mahalleList, setMahalleList] = useState<MahalleListItem[]>([]);
  const [selectedMahalle, setSelectedMahalle] = useState<string>("🏘️ Mahalleler");
  const [mahallePickerOpen, setMahallePickerOpen] = useState(false);
  const [mahalleSearch, setMahalleSearch] = useState("");

  // Modals state
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding | null>(null);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [sayacModalOpen, setSayacModalOpen] = useState(false);

  const { theme } = useTheme();

  useEffect(() => {
    fetch("/api/map-summary")
      .then((response) => response.json())
      .then((summary: MapSummary) => setMapSummary(summary))
      .catch((summaryError) => console.error("Harita özeti alınamadı:", summaryError));
  }, []);

  // Stable callback refs for Leaflet events
  const openInfoModalRef = useRef<(b: SelectedBuilding) => void>(() => {});
  const openSayacModalRef = useRef<(b: SelectedBuilding) => void>(() => {});

  useEffect(() => {
    openInfoModalRef.current = (b: SelectedBuilding) => {
      setSelectedBuilding(b);
      setInfoModalOpen(true);
    };
    openSayacModalRef.current = (b: SelectedBuilding) => {
      setSelectedBuilding(b);
      setSayacModalOpen(true);
    };
  }, []);

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

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let cancelled = false;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      // Binlerce ayrı SVG düğümü yerine tek Canvas yüzeyi kullanılır.
      preferCanvas: true,
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

      const excelBtn = el.querySelector<HTMLButtonElement>(".bina-excel-btn");
      if (excelBtn) {
        excelBtn.onclick = () => {
          const id = parseInt(excelBtn.dataset.binaId || "0");
          if (id) window.location.href = `/abonelikler/bina/${id}`;
        };
      }
    });

    fetch("/api/binalar")
      .then((res) => {
        if (!res.ok) throw new Error("Veriler yüklenirken hata oluştu.");
        return res.json();
      })
      .then(async (data: Building[]) => {
        if (cancelled || !mapRef.current) return;

        // Altlık haritayı hemen göster; bina katmanları aşağıda parça parça eklenir.
        setLoading(false);
        const mapBuildings = data.filter(
          (building) => building.layer !== "MASKI_EXCEL_ABONELIK_YAKLASIK",
        );
        const importedSubscribers = data
          .filter((building) => building.layer === "MASKI_EXCEL_ABONELIK_YAKLASIK")
          .reduce((total, building) => total + (building.aktif_abone_sayisi || 0), 0);
        setBuildingIndex(mapBuildings);
        buildingLayersRef.current = [];

        let totalActive = 0;
        let totalExcelRecords = 0;
        // 75 bin LatLng nesnesini bellekte tutmadan sınırı adım adım genişlet.
        const bounds = L.latLngBounds([]);

        for (let buildingIndex = 0; buildingIndex < mapBuildings.length; buildingIndex += 1) {
          const building = mapBuildings[buildingIndex];
          if (cancelled || !mapRef.current) return;

          // Ana iş parçacığını uzun süre bloke etmemek için her 200 binada
          // tarayıcıya çizim ve kullanıcı etkileşimi fırsatı ver.
          if (buildingIndex > 0 && buildingIndex % 200 === 0) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
          totalActive += building.aktif_abone_sayisi || 0;
          totalExcelRecords += building.excel_kayit_sayisi || 0;
          const excelMissing = (building.eksik_abone_sayisi || 0) + (building.eksik_sayac_sayisi || 0);
          const shouldBeGreen = building.has_meter_number;

          // İlk sürümde yeşil olan binaları koru ve Excel verisi olanları ekle.
          const polyColor = shouldBeGreen ? "#10b981" : "#465fff";
          const polyOpacity = shouldBeGreen ? 0.48 : 0.18;
          const polyWeight = shouldBeGreen ? 3 : 1;

          building.coordinates.forEach((polygonCoords) => {
            const polygon = L.polygon(polygonCoords, {
              color: polyColor,
              fillColor: polyColor,
              fillOpacity: polyOpacity,
              weight: polyWeight,
            }).addTo(map);

            buildingLayersRef.current.push({ building, layer: polygon });

            polygonCoords.forEach(([lat, lng]) => {
              bounds.extend([lat, lng]);
            });

            const escValue = (building.value || "").replace(/"/g, "&quot;");
            const escLayer = (building.layer || "").replace(/"/g, "&quot;");
            const escapeHtml = (value: string) => value
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
            const excelAda = escapeHtml(building.excel_ada || "");
            const excelBlok = escapeHtml(building.excel_blok || "");
            const excelMahalle = escapeHtml(building.excel_mahalle || "");
            const excelAdres = escapeHtml(building.excel_adres || "");

            // Ağır popup HTML'i başlangıçta 5.000 kez değil, yalnızca tıklanan
            // bina için oluşturulur.
            const createPopupContent = () => `
              <div style="font-family: Outfit, sans-serif; font-size: 13px; color: #1c2434; padding: 4px; min-width: 210px;">
                <h4 style="margin: 0 0 6px 0; font-size: 14px; font-weight: 700; color: ${shouldBeGreen ? '#059669' : '#465fff'}; padding-bottom: 5px; border-bottom: 1px solid #e5e7eb;">
                  ${building.value || "Bilinmeyen Bina"}
                </h4>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span style="color: #64748b;">Aktif Abone:</span>
                  <span style="font-weight: 600; color: #10b981;">${building.aktif_abone_sayisi}</span>
                </div>
                ${building.excel_kayit_sayisi > 0 ? `
                  <div style="display:grid;grid-template-columns:1fr auto;gap:4px 10px;margin:7px 0 10px;padding:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;font-size:11px;">
                    <span style="color:#92400e;">Excel Kaydı</span><strong>${building.excel_kayit_sayisi}</strong>
                    <span style="color:#92400e;">Excel Abone</span><strong>${building.excel_abone_sayisi}</strong>
                    <span style="color:#92400e;">Excel Sayaç</span><strong>${building.excel_sayac_sayisi}</strong>
                    <span style="color:#92400e;">Eksik Alan</span><strong>${excelMissing}</strong>
                  </div>
                  <div style="margin:0 0 10px;padding:9px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:7px;font-size:11px;line-height:1.45;">
                    <div style="font-weight:700;color:#047857;margin-bottom:4px;">Excel Bina Bilgileri</div>
                    ${excelAda || excelBlok ? `<div><span style="color:#64748b;">Ada / Blok:</span> <strong>${excelAda || "-"} / ${excelBlok || "-"}</strong></div>` : ""}
                    ${excelMahalle ? `<div><span style="color:#64748b;">Mahalle:</span> <strong>${excelMahalle}</strong></div>` : ""}
                    ${excelAdres ? `<div style="margin-top:3px;color:#334155;overflow-wrap:anywhere;">${excelAdres}</div>` : ""}
                  </div>
                ` : ""}
                <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                  <span style="color: #64748b;">Oda ID:</span>
                  <span style="font-weight: 500;">${building.oda_id || "-"}</span>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  <button
                    class="bina-bilgi-btn"
                    data-bina-id="${building.id}"
                    data-value="${escValue}"
                    data-layer="${escLayer}"
                    data-oda-id="${building.oda_id ?? ""}"
                    style="width:100%;padding:8px 12px;background:${shouldBeGreen ? '#10b981' : '#465fff'};color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:Outfit,sans-serif;"
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
                  ${building.excel_kayit_sayisi > 0 ? `
                    <button
                      class="bina-excel-btn"
                      data-bina-id="${building.id}"
                      style="width:100%;padding:8px 12px;background:#7c3aed;color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:Outfit,sans-serif;"
                    >
                      Excel Kayıtlarının Tamamını Aç (${building.excel_kayit_sayisi})
                    </button>
                  ` : ""}
                </div>
              </div>
            `;

            polygon.on("click", () => {
              if (!polygon.getPopup()) {
                polygon.bindPopup(createPopupContent(), { minWidth: 230 });
              }
              polygon.openPopup();
            });

            polygon.on("mouseover", () => {
              polygon.setStyle({ fillColor: shouldBeGreen ? "#059669" : "#3c50e0", fillOpacity: shouldBeGreen ? 0.6 : 0.3, weight: polyWeight + 0.5 });
            });
            polygon.on("mouseout", () => {
              polygon.setStyle({ fillColor: polyColor, fillOpacity: polyOpacity, weight: polyWeight });
            });
          });
        }

        if (cancelled || !mapRef.current) return;

        const presentationBounds = L.latLngBounds([]);
        buildingLayersRef.current.forEach(({ building, layer }) => {
          if (building.has_meter_number && layer instanceof L.Polygon) {
            presentationBounds.extend(layer.getBounds());
          }
        });
        if (presentationBounds.isValid()) {
          map.fitBounds(presentationBounds, { padding: [55, 55], maxZoom: 16 });
        } else if (bounds.isValid()) {
          allBoundsRef.current = bounds;
          map.fitBounds(bounds, { padding: [20, 20] });
        }

        setStats({ total: mapBuildings.length, activeSubscribers: totalActive, importedSubscribers, excelRecords: totalExcelRecords });
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
        buildingLayersRef.current = [];
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const normalizedBuildingSearch = buildingSearch.trim().toLocaleLowerCase("tr-TR");
  const buildingSearchResults = normalizedBuildingSearch.length >= 2
    ? buildingIndex
        .filter((building) =>
          `${building.value || ""} ${building.oda_id || ""} ${building.id}`
            .toLocaleLowerCase("tr-TR")
            .includes(normalizedBuildingSearch)
        )
        .slice(0, 8)
    : [];

  const focusBuilding = (building: Building) => {
    const map = mapRef.current;
    const entry = buildingLayersRef.current.find((item) => item.building.id === building.id);
    if (!map || !entry) return;

    if (!map.hasLayer(entry.layer)) entry.layer.addTo(map);
    if (entry.layer instanceof L.CircleMarker) {
      map.setView(entry.layer.getLatLng(), 18, { animate: true });
    } else if (entry.layer instanceof L.Polygon) {
      map.fitBounds(entry.layer.getBounds(), { padding: [80, 80], maxZoom: 18, animate: true });
    }
    entry.layer.fire("click");
    setBuildingSearch("");
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const entry of buildingLayersRef.current) {
      const { building, layer } = entry;
      const visible = buildingFilter === "all"
        || (buildingFilter === "metered" && building.has_meter_number)
        || (buildingFilter === "excel" && building.excel_kayit_sayisi > 0)
        || (buildingFilter === "active" && building.aktif_abone_sayisi > 0)
        || (buildingFilter === "missing" && (building.eksik_abone_sayisi + building.eksik_sayac_sayisi) > 0)
        || (buildingFilter === "configured" && Boolean(building.is_configured));

      if (visible && !map.hasLayer(layer)) layer.addTo(map);
      if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
    }

    if (buildingFilter !== "all") {
      const visibleBounds = L.latLngBounds([]);
      for (const { building, layer } of buildingLayersRef.current) {
        const visible = buildingFilter === "metered" ? building.has_meter_number
          : buildingFilter === "excel" ? building.excel_kayit_sayisi > 0
          : buildingFilter === "active" ? building.aktif_abone_sayisi > 0
          : buildingFilter === "missing" ? (building.eksik_abone_sayisi + building.eksik_sayac_sayisi) > 0
          : Boolean(building.is_configured);
        if (visible && layer instanceof L.Polygon) visibleBounds.extend(layer.getBounds());
      }
      if (visibleBounds.isValid()) map.fitBounds(visibleBounds, { padding: [55, 55], maxZoom: 16 });
    }
  }, [buildingFilter]);

  const filterLabels: Record<BuildingFilter, string> = {
    metered: "Sayaçlı Binalar",
    all: "Tüm Binalar",
    excel: "Excel Verisi Olan",
    active: "Aktif Aboneli",
    missing: "Eksik Verili",
    configured: "Yapılandırılmış",
  };

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

      {/* Stats Widget */}
      {!loading && !error && (
        <div className="absolute top-4 left-4 z-999 hidden min-w-48 flex-col gap-2 rounded-xl border border-gray-100 bg-white/95 p-4 shadow-lg backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/95 lg:flex">
          <h3 className="font-bold text-gray-800 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-2 flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-brand-500 animate-ping inline-block"></span>
            Malatya Bina Verileri
          </h3>
          <div className="grid grid-cols-2 gap-3 text-center text-xs mt-1 sm:grid-cols-4">
            <div>
              <div className="font-bold text-xl text-emerald-500">{mapSummary.meteredBuildings.toLocaleString("tr-TR")}</div>
              <div className="text-gray-500 dark:text-gray-400 font-medium">Sayaçlı Bina</div>
            </div>
            <div>
              <div className="font-bold text-xl text-brand-500">{mapSummary.totalMeters.toLocaleString("tr-TR")}</div>
              <div className="text-gray-500 dark:text-gray-400 font-medium">Excel Sayaç</div>
            </div>
            <div>
              <div className="font-bold text-xl text-violet-500">{mapSummary.linkedMeters.toLocaleString("tr-TR")}</div>
              <div className="text-gray-500 dark:text-gray-400 font-medium">Eşleşen Kayıt</div>
            </div>
            <div>
              <div className="font-bold text-xl text-amber-500">{mapSummary.pendingMeters.toLocaleString("tr-TR")}</div>
              <div className="text-gray-500 dark:text-gray-400 font-medium">Eşleştirme Bekliyor</div>
            </div>
          </div>
        </div>
      )}

      {/* Professional building search */}
      {!loading && !error && (
        <div className="absolute top-4 left-1/2 z-1000 w-[min(92vw,25rem)] -translate-x-1/2">
          <div className="relative rounded-2xl border border-white/70 bg-white/95 shadow-xl shadow-slate-900/10 backdrop-blur-md dark:border-gray-700 dark:bg-gray-900/95">
            <div className="flex items-center gap-3 px-4 py-3">
              <svg className="shrink-0 text-gray-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                value={buildingSearch}
                onChange={(event) => setBuildingSearch(event.target.value)}
                placeholder="Bina, blok, ODA ID veya kayıt no ara..."
                aria-label="Haritada bina ara"
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-gray-800 outline-none placeholder:text-gray-400 dark:text-white"
              />
              {buildingSearch && (
                <button onClick={() => setBuildingSearch("")} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800" aria-label="Aramayı temizle">
                  ×
                </button>
              )}
            </div>
            {normalizedBuildingSearch.length >= 2 && (
              <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
                {buildingSearchResults.length ? buildingSearchResults.map((building) => (
                  <button
                    key={building.id}
                    onClick={() => focusBuilding(building)}
                    className="flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3 text-left transition last:border-0 hover:bg-brand-50 dark:border-gray-800 dark:hover:bg-brand-950/30"
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${building.has_meter_number ? "bg-emerald-500" : "bg-brand-500"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-800 dark:text-white">{building.value || `Bina #${building.id}`}</span>
                      <span className="block text-xs text-gray-400">ODA {building.oda_id || "—"} · {building.excel_kayit_sayisi} Excel kaydı</span>
                    </span>
                    <span className="text-xs font-semibold text-brand-500">Göster</span>
                  </button>
                )) : (
                  <div className="px-4 py-5 text-center text-sm text-gray-400">Eşleşen bina bulunamadı.</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Controls Container */}
      {!loading && !error && (
        <div className="absolute top-4 right-4 z-999 flex flex-col gap-2.5 items-end">
          {/* Data filter */}
          <div className="relative">
            <button
              onClick={() => {
                setFilterPickerOpen((value) => !value);
                setLayerPickerOpen(false);
                setMahallePickerOpen(false);
              }}
              className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white/95 px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-lg backdrop-blur-sm transition hover:bg-white dark:border-gray-800 dark:bg-gray-900/95 dark:text-gray-200"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">✓</span>
              {filterLabels[buildingFilter]}
              <span className={`text-xs transition-transform ${filterPickerOpen ? "rotate-180" : ""}`}>⌄</span>
            </button>
            {filterPickerOpen && (
              <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-gray-100 bg-white/98 shadow-xl backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/98">
                {(Object.keys(filterLabels) as BuildingFilter[]).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => { setBuildingFilter(filter); setFilterPickerOpen(false); }}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-gray-50 dark:hover:bg-gray-800 ${buildingFilter === filter ? "bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "text-gray-700 dark:text-gray-300"}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${buildingFilter === filter ? "bg-emerald-500" : "bg-gray-300"}`} />
                    {filterLabels[filter]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Layer Switcher */}
          <div className="relative">
            <button
              onClick={() => {
                setLayerPickerOpen((v) => !v);
                setMahallePickerOpen(false);
                setFilterPickerOpen(false);
              }}
              className="flex items-center gap-2 bg-white/95 dark:bg-gray-900/95 shadow-lg rounded-xl px-4 py-2.5 border border-gray-100 dark:border-gray-800 backdrop-blur-sm text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800 transition"
              title="Katman Seç"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
              {TILE_LAYERS[activeLayer].label}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${layerPickerOpen ? "rotate-180" : ""}`}>
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

          {/* Neighborhood (Mahalle) Switcher */}
          <div className="relative">
            <button
              onClick={() => {
                setMahallePickerOpen((v) => !v);
                setLayerPickerOpen(false);
                setFilterPickerOpen(false);
                setMahalleSearch(""); // Clear search when opening/closing
              }}
              className="flex items-center gap-2 bg-white/95 dark:bg-gray-900/95 shadow-lg rounded-xl px-4 py-2.5 border border-gray-100 dark:border-gray-800 backdrop-blur-sm text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800 transition"
              title="Mahalleye Odaklan"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {selectedMahalle}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${mahallePickerOpen ? "rotate-180" : ""}`}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {mahallePickerOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white/98 dark:bg-gray-900/98 shadow-xl rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden backdrop-blur-sm z-999 flex flex-col">
                {/* Search Box */}
                <div className="p-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
                  <input
                    type="text"
                    placeholder="Mahalle ara..."
                    value={mahalleSearch}
                    onChange={(e) => setMahalleSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()} // Stop closing dropdown on click
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
      )}

      {/* Map legend */}
      {!loading && !error && (
        <div className="absolute bottom-5 left-4 z-999 hidden min-w-52 rounded-2xl border border-white/70 bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur-md dark:border-gray-700 dark:bg-gray-900/95 sm:block">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-200">Harita Lejantı</h4>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-950/40">CANLI</span>
          </div>
          <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
            <div className="flex items-center gap-2.5"><span className="h-3 w-3 rounded-sm border border-emerald-600 bg-emerald-500/60" /> Verili / yapılandırılmış bina</div>
            <div className="flex items-center gap-2.5"><span className="h-3 w-3 rounded-sm border border-brand-600 bg-brand-500/25" /> Veri bekleyen bina</div>
            <div className="flex items-center gap-2.5"><span className="h-0 w-4 border-t-2 border-dashed border-orange-500" /> Seçili mahalle sınırı</div>
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
