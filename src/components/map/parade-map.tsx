"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L, { type LatLngBoundsExpression, type LatLngExpression, type LatLngTuple } from "leaflet";
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

// Draggable handles. Leaflet's default marker images don't bundle with Next,
// so handles are plain styled divs.
const vertexIcon = L.divIcon({
  className: "",
  html: '<div style="width:18px;height:18px;border-radius:9999px;background:#7c3aed;border:3px solid #fff;box-shadow:0 0 0 1px #7c3aed"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});
const midpointIcon = L.divIcon({
  className: "",
  html: '<div style="width:12px;height:12px;border-radius:9999px;background:#fff;border:2px solid #7c3aed;opacity:.85"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const round = (ll: L.LatLng): LatLngTuple => [Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6))];

/**
 * Editing layer: drag a purple point to move it, drag a white midpoint to add a
 * point between two others, tap a point to remove it, tap the map to extend the
 * line from its far end (or to place a checkpoint).
 */
function DrawLayer({ draw }: { draw: DrawState }) {
  const { points, onChange, mode } = draw;
  // Tapping "Remove point" also reaches the map as a click once the popup is
  // gone; ignore map taps briefly so it doesn't add a point where it was.
  const ignoreClicksUntil = useRef(0);
  useMapEvents({
    click(e) {
      if (Date.now() < ignoreClicksUntil.current) return;
      if ((e.originalEvent.target as Element | null)?.closest?.(".leaflet-popup")) return;
      onChange(mode === "point" ? [round(e.latlng)] : [...points, round(e.latlng)]);
    },
  });
  const move = (i: number, ll: L.LatLng) => onChange(points.map((p, j) => (j === i ? round(ll) : p)));
  const insert = (i: number, ll: L.LatLng) => onChange([...points.slice(0, i + 1), round(ll), ...points.slice(i + 1)]);
  const remove = (i: number) => {
    ignoreClicksUntil.current = Date.now() + 400;
    onChange(points.filter((_, j) => j !== i));
  };
  const midpoints =
    mode === "line"
      ? points.slice(1).map((p, i) => [(points[i][0] + p[0]) / 2, (points[i][1] + p[1]) / 2] as LatLngTuple)
      : [];
  return (
    <>
      {mode === "line" && points.length > 1 && (
        <Polyline positions={points} pathOptions={{ color: "#7c3aed", weight: 5, dashArray: "6 6" }} interactive={false} />
      )}
      {midpoints.map((m, i) => (
        <Marker
          key={`m${i}-${m[0]}-${m[1]}`}
          position={m}
          icon={midpointIcon}
          draggable
          title="Drag to add a point here"
          eventHandlers={{ dragend: (e) => insert(i, (e.target as L.Marker).getLatLng()) }}
        />
      ))}
      {points.map((p, i) => (
        <Marker
          key={`v${i}`}
          position={p}
          icon={vertexIcon}
          draggable
          title={`Point ${i + 1}: drag to move`}
          eventHandlers={{
            drag: (e) => move(i, (e.target as L.Marker).getLatLng()),
            dragend: (e) => move(i, (e.target as L.Marker).getLatLng()),
          }}
        >
          {mode === "line" && points.length > 2 && (
            <Popup>
              <button type="button" className="text-sm font-medium text-rose-700" onClick={() => remove(i)}>
                Remove point {i + 1}
              </button>
            </Popup>
          )}
        </Marker>
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
