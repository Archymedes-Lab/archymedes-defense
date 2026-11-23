"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { Params, SubseaModel } from "@/lib/subsea-model";
import { covered, segState } from "@/lib/subsea-model";

export type Layers = { satellite: boolean; depth: boolean; traffic: boolean; cables: boolean; fiber: boolean; ships: boolean };
export type Vessel = { mmsi: number; name: string | null; type: number | null; lon: number; lat: number; sog: number | null; cog: number | null;
  navStat: number | null; ageS: number; cableKm: number | null; cable: string | null; depthM: number | null; flag: "attention" | "over" | null };

// MapLibre's worker is copied to public/vendor at build time; bundlers cannot resolve its default URL.
maplibregl.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");

const S2 = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2017_3857/default/g/{z}/{y}/{x}.jpg";
const ATTRIB = [
  '<a href="https://s2maps.eu" target="_blank" rel="noopener noreferrer">Sentinel-2 cloudless 2017 by EOX</a> (CC BY 4.0, modified Copernicus Sentinel data 2017)',
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors (ODbL)',
  "EMODnet Bathymetry, EMODnet Human Activities", "AIS: Fintraffic Digitraffic (CC BY 4.0)",
].join(" · ");

const NAV: Record<number, string> = { 0: "under way", 1: "at anchor", 2: "not under command", 3: "restricted", 5: "moored", 7: "fishing", 8: "sailing", 15: "undefined" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function css(name: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function cableFeatures(m: SubseaModel, p: Params): FeatureCollection {
  const features: Feature[] = [];
  for (const c of m.cables) {
    for (const part of c.parts) {
      for (let i = 1; i < part.length; i++) {
        const a = part[i - 1]!, b = part[i]!, sa = segState(a, p, m.trafficP90), sb = segState(b, p, m.trafficP90);
        const state = sa === "exposed" || sb === "exposed" ? "exposed" : sa === "reach" || sb === "reach" ? "reach" : "deep";
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[a[0], a[1]], [b[0], b[1]]] },
          properties: { name: c.name ?? "Unnamed cable", kind: c.kind, named: c.named, state, covered: covered(a, p) && covered(b, p),
            depth: a[2], traffic: Math.max(a[3], b[3]), shore: a[5] } });
      }
    }
  }
  return { type: "FeatureCollection", features };
}

function landings(m: SubseaModel): FeatureCollection {
  const seen = new Set<string>(), features: Feature[] = [];
  for (const c of m.cables) {
    if (!c.named) continue;
    for (const part of c.parts) for (const s of [part[0]!, part[part.length - 1]!]) {
      if (s[5] !== 0) continue;
      const k = `${s[0].toFixed(2)}:${s[1].toFixed(2)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [s[0], s[1]] }, properties: { name: c.name } });
    }
  }
  return { type: "FeatureCollection", features };
}

function vesselFeatures(vs: Vessel[]): FeatureCollection {
  return { type: "FeatureCollection", features: vs.map((v) => ({ type: "Feature", geometry: { type: "Point", coordinates: [v.lon, v.lat] },
    properties: { ...v, flag: v.flag ?? "none" } })) };
}

export function SubseaMap({ model, params, layers, vessels }: { model: SubseaModel; params: Params; layers: Layers; vessels: Vessel[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const latest = useRef({ model, params, layers, vessels });
  latest.current = { model, params, layers, vessels };

  useEffect(() => {
    if (!el.current) return;
    const [x0, y0, x1, y1] = model.bbox;
    const corners: [[number, number], [number, number], [number, number], [number, number]] = [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];
    const m = new maplibregl.Map({
      container: el.current, attributionControl: { compact: true, customAttribution: ATTRIB },
      bounds: [[x0, y0], [x1, y1]], maxBounds: [[x0 - 1.5, y0 - 0.6], [x1 + 1.5, y1 + 0.6]], minZoom: 5, maxZoom: 14,
      dragRotate: false, pitchWithRotate: false, cooperativeGestures: true,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": css("--bg") } }] },
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "top-left");
    m.on("load", () => {
      const accent = css("--accent"), critical = css("--critical"), good = css("--good"), fg3 = css("--fg-3"), warn = css("--warning");
      m.addSource("s2", { type: "raster", tiles: [S2], tileSize: 256, maxzoom: 14 });
      m.addLayer({ id: "s2", type: "raster", source: "s2", paint: { "raster-saturation": -0.35, "raster-brightness-max": 0.8 } });
      m.addSource("depth", { type: "image", url: "/subsea/depth.png", coordinates: corners });
      m.addLayer({ id: "depth", type: "raster", source: "depth", paint: { "raster-opacity": 0.85, "raster-resampling": "linear" } });
      m.addSource("traffic", { type: "image", url: "/subsea/density.png", coordinates: corners });
      m.addLayer({ id: "traffic", type: "raster", source: "traffic", paint: { "raster-opacity": 0.85, "raster-resampling": "nearest" } });
      m.addSource("cables", { type: "geojson", data: cableFeatures(model, latest.current.params) });
      m.addLayer({ id: "fiber", type: "line", source: "cables", filter: ["==", ["get", "covered"], true],
        paint: { "line-color": good, "line-opacity": 0.35, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 6, 11, 12] } });
      m.addLayer({ id: "cables", type: "line", source: "cables", layout: { "line-cap": "butt" },
        paint: { "line-color": ["match", ["get", "state"], "exposed", critical, "reach", accent, fg3],
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, ["case", ["get", "named"], 2, 0.8], 11, ["case", ["get", "named"], 4, 2]] } });
      m.addSource("landings", { type: "geojson", data: landings(model) });
      m.addLayer({ id: "landings", type: "circle", source: "landings",
        paint: { "circle-radius": 4, "circle-color": css("--bg"), "circle-stroke-color": accent, "circle-stroke-width": 2 } });
      m.addSource("ships", { type: "geojson", data: vesselFeatures(latest.current.vessels) });
      m.addLayer({ id: "ships", type: "circle", source: "ships",
        paint: { "circle-radius": ["match", ["get", "flag"], "attention", 6, "over", 4.5, 2.6],
          "circle-color": ["match", ["get", "flag"], "attention", critical, "over", warn, css("--fg")],
          "circle-opacity": ["match", ["get", "flag"], "none", 0.7, 1], "circle-stroke-color": css("--bg"), "circle-stroke-width": 1 } });
      ready.current = true;
      apply();
      // Start with the attribution collapsed to its (i) button on small screens; every source is also credited on the page.
      if (el.current && el.current.clientWidth < 640) el.current.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "sw-pop", maxWidth: "280px" });
      m.on("mousemove", "cables", (e) => {
        const f = e.features?.[0]?.properties;
        if (!f) return;
        m.getCanvas().style.cursor = "crosshair";
        const depth = f.depth === null || f.depth === "null" ? "n/a" : `${Math.round(-Number(f.depth))} m`;
        const shore = f.shore === null || f.shore === "null" ? "no landing station" : `${Number(f.shore).toFixed(0)} km`;
        popup.setLngLat(e.lngLat).setHTML(`<b>${esc(String(f.name))}</b><br>${esc(String(f.kind))} · depth ${depth}<br>cargo+tanker ${Number(f.traffic).toFixed(1)} h/km²/mo<br>to landing station ${shore}`).addTo(m);
      });
      m.on("mouseleave", "cables", () => { m.getCanvas().style.cursor = ""; popup.remove(); });
      m.on("click", "ships", (e) => {
        const v = e.features?.[0]?.properties;
        if (!v) return;
        const nav = NAV[Number(v.navStat)] ?? "unknown";
        new maplibregl.Popup({ className: "sw-pop", maxWidth: "280px" }).setLngLat(e.lngLat).setHTML(
          `<b>${esc(String(v.name && v.name !== "null" ? v.name : `MMSI ${v.mmsi}`))}</b><br>${v.sog === null || v.sog === "null" ? "?" : Number(v.sog).toFixed(1)} kn · ${nav}<br>` +
          `${v.cableKm === null || v.cableKm === "null" ? "no cable nearby" : `${Number(v.cableKm).toFixed(1)} km from ${esc(String(v.cable && v.cable !== "null" ? v.cable : "a mapped cable"))}`}<br>position ${Math.round(Number(v.ageS) / 60)} min old`).addTo(m);
      });
      m.on("mouseenter", "ships", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "ships", () => { m.getCanvas().style.cursor = ""; });
    });
    function apply() {
      if (!ready.current) return;
      const { layers: l } = latest.current;
      const vis = (id: string, on: boolean) => m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      vis("s2", l.satellite); vis("depth", l.depth); vis("traffic", l.traffic); vis("cables", l.cables); vis("landings", l.cables);
      vis("fiber", l.fiber); vis("ships", l.ships);
    }
    (m as MLMap & { __apply?: () => void }).__apply = apply;
    return () => { ready.current = false; m.remove(); map.current = null; };
  }, [model]);

  useEffect(() => { const m = map.current as (MLMap & { __apply?: () => void }) | null; m?.__apply?.(); }, [layers]);
  useEffect(() => {
    const m = map.current;
    if (m && ready.current) (m.getSource("cables") as GeoJSONSource | undefined)?.setData(cableFeatures(model, params));
  }, [model, params]);
  useEffect(() => {
    const m = map.current;
    if (m && ready.current) (m.getSource("ships") as GeoJSONSource | undefined)?.setData(vesselFeatures(vessels));
  }, [vessels]);

  return <div ref={el} className="h-[440px] w-full sm:h-[560px]" role="region" aria-label="Map of the Gulf of Finland with undersea assets, threat corridors, traffic density and AIS contacts" />;
}
