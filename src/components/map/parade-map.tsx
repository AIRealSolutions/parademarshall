"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression, LatLngTuple } from "leaflet";
import { STATUS_COLORS, STATUS_LABELS, reservedLength, type GeoLine, type GeoPoint, type StagingLayout } from "@/lib/domain/staging";

export interface MapRoute {
  name: string;
  geometry: GeoLine;
}
export interface MapCheckpoint {
  code: string;
  name: string;
  geometry: GeoPoint;
  is_finish?: boolean;
  is_merge_point?: boolean;
}

export interface DrawState {
  mode: "line" | "point";
  points: LatLngTuple[];
  onChange: (points: LatLngTuple[]) => void;
}

export interface ParadeMapProps {
  layout?: StagingLayout;
  route?: MapRoute[];
  checkpoints?: MapCheckpoint[];
  selectedBlockId?: string | null;
  selectedZoneId?: string | null;
  onSelectBlock?: (blockId: string) => void;
  draw?: DrawState | null;
  className?: string;
  /** "staging" zooms to the staging streets; "all" shows the whole route. */
  fit?: "staging" | "all";
  /** One line drawn prominently, e.g. a participant's staging spot. */
  highlight?: { geometry: GeoLine; label: string } | null;
}

const toLatLngs = (g: GeoLine | null | undefined): LatLngTuple[] =>
  g ? g.coordinates.map(([lng, lat]) => [lat, lng] as LatLngTuple) : [];

const pointLatLng = (g: GeoPoint): LatLngTuple => [g.coordinates[1], g.coordinates[0]];

function FitBounds({ bounds }: { bounds: LatLngTuple[] }) {
  const map = useMap();
  const key = bounds.length;
  useEffect(() => {
    if (bounds.length > 1) map.fitBounds(bounds as LatLngBoundsExpression, { padding: [24, 24], maxZoom: 18 });
    // Fit once per geometry set, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

function DrawLayer({ draw }: { draw: DrawState }) {
  useMapEvents({
    click(e) {
      const p: LatLngTuple = [Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))];
      draw.onChange(draw.mode === "point" ? [p] : [...draw.points, p]);
    },
  });
  return (
    <>
      {draw.mode === "line" && draw.points.length > 1 && (
        <Polyline positions={draw.points} pathOptions={{ color: "#7c3aed", weight: 5, dashArray: "6 6" }} />
      )}
      {draw.points.map((p, i) => (
        <CircleMarker key={i} center={p} radius={5} pathOptions={{ color: "#7c3aed", fillOpacity: 1 }} />
      ))}
    </>
  );
}

export default function ParadeMap({
  layout,
  route = layout?.route ?? [],
  checkpoints = layout?.checkpoints ?? [],
  selectedBlockId,
  selectedZoneId,
  onSelectBlock,
  draw,
  className = "h-[28rem]",
  fit = "staging",
  highlight = null,
}: ParadeMapProps) {
  // Staging views zoom to the staging streets; route views show the whole route.
  const bounds = useMemo(() => {
    const pts: LatLngTuple[] = [];
    if (highlight) pts.push(...toLatLngs(highlight.geometry));
    layout?.zones.forEach((z) => pts.push(...toLatLngs(z.geometry)));
    if (fit === "staging" && pts.length > 1) return pts;
    route.forEach((r) => pts.push(...toLatLngs(r.geometry)));
    checkpoints.forEach((c) => pts.push(pointLatLng(c.geometry)));
    return pts;
  }, [route, checkpoints, layout, fit, highlight]);

  const center: LatLngExpression = bounds[0] ?? [33.9165, -78.0195];

  return (
    <div className={`overflow-hidden rounded-lg border border-border ${className} ${draw ? "cursor-crosshair" : ""}`}>
      <MapContainer center={center} zoom={16} className="h-full w-full" scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <FitBounds bounds={bounds} />

        {route.map((r) => (
          <Polyline key={r.name} positions={toLatLngs(r.geometry)} pathOptions={{ color: "#1d4ed8", weight: 6, opacity: 0.55 }}>
            <Tooltip sticky>{r.name}</Tooltip>
          </Polyline>
        ))}

        {layout?.zones.map((z) => (
          <Polyline
            key={z.id}
            positions={toLatLngs(z.geometry)}
            pathOptions={{ color: z.id === selectedZoneId ? "#7c3aed" : "#1c1f1d", weight: z.id === selectedZoneId ? 3 : 1, opacity: 0.6, dashArray: "2 6" }}
          />
        ))}

        {layout?.zones.flatMap((z) =>
          z.lanes.flatMap((l) =>
            l.blocks.map((b) => {
              const positions = toLatLngs(b.geometry);
              if (positions.length < 2) return null;
              const selected = b.id === selectedBlockId;
              const reserved = reservedLength(b);
              return (
                <Polyline
                  key={b.id}
                  positions={positions}
                  eventHandlers={onSelectBlock && !draw ? { click: () => onSelectBlock(b.id) } : undefined}
                  pathOptions={{
                    color: selected ? "#7c3aed" : STATUS_COLORS[b.effective_status],
                    weight: selected ? 10 : 6,
                    opacity: selected ? 1 : 0.85,
                    lineCap: "butt",
                  }}
                >
                  <Tooltip sticky>
                    <strong>
                      {z.street_name} · lane {l.lane_number} · block {b.block_number}
                    </strong>
                    <br />
                    {STATUS_LABELS[b.effective_status]} · {reserved}/{b.usable_length_ft} ft reserved
                    {b.assignments.length > 0 && (
                      <>
                        <br />
                        {b.assignments.map((a) => a.unit_name).join(", ")}
                      </>
                    )}
                  </Tooltip>
                </Polyline>
              );
            }),
          ),
        )}

        {checkpoints.map((c) => (
          <CircleMarker
            key={c.code}
            center={pointLatLng(c.geometry)}
            radius={8}
            pathOptions={{ color: "#fff", weight: 2, fillColor: c.is_finish ? "#b3261e" : "#1d4ed8", fillOpacity: 1 }}
          >
            <Tooltip direction="right">{c.name}</Tooltip>
          </CircleMarker>
        ))}

        {highlight && (
          <Polyline positions={toLatLngs(highlight.geometry)} pathOptions={{ color: "#7c3aed", weight: 10, opacity: 0.9 }}>
            <Tooltip permanent direction="top">
              {highlight.label}
            </Tooltip>
          </Polyline>
        )}

        {draw && <DrawLayer draw={draw} />}
      </MapContainer>
    </div>
  );
}
