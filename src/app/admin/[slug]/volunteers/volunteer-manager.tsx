"use client";

import { useState } from "react";
import { Badge, Card, EmptyState, Notice, buttonClass } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { formatDateTime } from "@/lib/format";
import { EVENT_ROLES, ROLE_LABELS, type EventRole } from "@/lib/domain/roles";
import { addVolunteerAssignment, grantRole, removeVolunteerAssignment, revokeRole } from "@/lib/actions/staff";

export interface StaffMember {
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roles: { id: string; role: string }[];
  assignments: { id: string; position: string; where: string | null; shift_start: string | null; shift_end: string | null; notes: string | null }[];
}

export function VolunteerManager({
  eventId,
  timezone,
  canGrant,
  canAssign,
  staff,
  checkpoints,
  zones,
}: {
  eventId: string;
  timezone: string;
  canGrant: boolean;
  canAssign: boolean;
  staff: StaffMember[];
  checkpoints: { id: string; name: string }[];
  zones: { id: string; street_name: string }[];
}) {
  const action = useAction();
  const [grant, setGrant] = useState({ email: "", role: "staging_marshal" });
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assign, setAssign] = useState({ position: "", location: "", shift_start: "", shift_end: "", notes: "" });

  return (
    <div className="space-y-6">
      {action.error && <Notice tone="bad">{action.error}</Notice>}
      {action.message && <Notice tone="good">{action.message}</Notice>}

      {canGrant && (
        <Card title="Add staff">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await action.run(() => grantRole(eventId, grant.email, grant.role), `${ROLE_LABELS[grant.role as EventRole]} role granted.`);
              if (ok) setGrant({ ...grant, email: "" });
            }}
          >
            <input className="input max-w-xs" type="email" required placeholder="Email they sign in with" value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.target.value })} />
            <select className="input max-w-xs" value={grant.role} onChange={(e) => setGrant({ ...grant, role: e.target.value })} aria-label="Role">
              {EVENT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button className={buttonClass()} disabled={action.pending}>
              Grant role
            </button>
          </form>
          <p className="mt-2 text-xs text-muted">The person must sign in once before a role can be granted.</p>
        </Card>
      )}

      <Card title={`Staff (${staff.length})`}>
        {staff.length === 0 ? (
          <EmptyState>No staff yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {staff.map((m) => (
              <li key={m.user_id} className="py-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{m.name}</p>
                    <p className="text-xs text-muted">
                      {m.email}
                      {m.phone && ` · ${m.phone}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {m.roles.map((r) => (
                      <span key={r.id} className="inline-flex items-center gap-1">
                        <Badge tone="info">{ROLE_LABELS[r.role as EventRole]}</Badge>
                        {canGrant && (
                          <button
                            className="text-xs text-muted hover:text-accent"
                            aria-label={`Remove ${ROLE_LABELS[r.role as EventRole]} role from ${m.name}`}
                            onClick={() => window.confirm(`Remove ${ROLE_LABELS[r.role as EventRole]} from ${m.name}?`) && action.run(() => revokeRole(r.id), "Role removed.")}
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
                {m.assignments.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {m.assignments.map((a) => (
                      <li key={a.id} className="flex flex-wrap gap-2">
                        <span className="font-medium">{a.position}</span>
                        {a.where && <span>@ {a.where}</span>}
                        {a.shift_start && (
                          <span className="text-muted">
                            {formatDateTime(a.shift_start, timezone)}
                            {a.shift_end && ` – ${formatDateTime(a.shift_end, timezone)}`}
                          </span>
                        )}
                        {canAssign && (
                          <button className="text-xs text-muted hover:text-accent" onClick={() => action.run(() => removeVolunteerAssignment(a.id), "Assignment removed.")}>
                            remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canAssign && (
                  <button className="mt-2 text-xs text-brand hover:underline" onClick={() => setAssignFor(assignFor === m.user_id ? null : m.user_id)}>
                    {assignFor === m.user_id ? "Cancel" : "+ Assign position"}
                  </button>
                )}
                {assignFor === m.user_id && (
                  <form
                    className="mt-2 grid gap-2 rounded-md bg-stone-50 p-3 sm:grid-cols-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const [kind, id] = assign.location.split(":");
                      const ok = await action.run(
                        () =>
                          addVolunteerAssignment({
                            event_id: eventId,
                            user_id: m.user_id,
                            position: assign.position,
                            checkpoint_id: kind === "cp" ? id : null,
                            zone_id: kind === "zone" ? id : null,
                            shift_start: assign.shift_start ? new Date(assign.shift_start).toISOString() : null,
                            shift_end: assign.shift_end ? new Date(assign.shift_end).toISOString() : null,
                            notes: assign.notes,
                          }),
                        "Assignment added.",
                      );
                      if (ok) {
                        setAssignFor(null);
                        setAssign({ position: "", location: "", shift_start: "", shift_end: "", notes: "" });
                      }
                    }}
                  >
                    <input className="input" required placeholder="Position (e.g. Lane marshal)" value={assign.position} onChange={(e) => setAssign({ ...assign, position: e.target.value })} />
                    <select className="input" value={assign.location} onChange={(e) => setAssign({ ...assign, location: e.target.value })} aria-label="Location">
                      <option value="">No fixed location</option>
                      {zones.map((z) => (
                        <option key={z.id} value={`zone:${z.id}`}>
                          Staging: {z.street_name}
                        </option>
                      ))}
                      {checkpoints.map((c) => (
                        <option key={c.id} value={`cp:${c.id}`}>
                          Checkpoint: {c.name}
                        </option>
                      ))}
                    </select>
                    <label className="text-xs">
                      Shift start
                      <input className="input mt-1" type="datetime-local" value={assign.shift_start} onChange={(e) => setAssign({ ...assign, shift_start: e.target.value })} />
                    </label>
                    <label className="text-xs">
                      Shift end
                      <input className="input mt-1" type="datetime-local" value={assign.shift_end} onChange={(e) => setAssign({ ...assign, shift_end: e.target.value })} />
                    </label>
                    <input className="input sm:col-span-2" placeholder="Notes (radio channel, vest color…)" value={assign.notes} onChange={(e) => setAssign({ ...assign, notes: e.target.value })} />
                    <button className={buttonClass()} disabled={action.pending}>
                      Save assignment
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
