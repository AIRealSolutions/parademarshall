import { describe, expect, it } from "vitest";
import {
  APPLICATION_STATUSES,
  availableTransitions,
  requiresNote,
  transitionActor,
} from "../applications";

describe("application transitions", () => {
  it("lets participants submit drafts and resubmit after a request for information", () => {
    expect(transitionActor("draft", "submitted")).toBe("owner");
    expect(transitionActor("needs_information", "submitted")).toBe("owner");
  });

  it("reserves approval for the director", () => {
    expect(transitionActor("under_review", "approved")).toBe("director");
    const coordinator = availableTransitions("under_review", { isOwner: false, isReviewer: true, isDirector: false });
    expect(coordinator).not.toContain("approved");
    expect(coordinator).toContain("needs_information");
  });

  it("never offers a transition out of terminal states", () => {
    const all = { isOwner: true, isReviewer: true, isDirector: true };
    for (const s of ["completed", "withdrawn", "rejected", "no_show"] as const) {
      expect(availableTransitions(s, all)).toEqual([]);
    }
  });

  it("does not let participants approve or skip review", () => {
    const owner = { isOwner: true, isReviewer: false, isDirector: false };
    for (const from of APPLICATION_STATUSES) {
      const offered = availableTransitions(from, owner);
      expect(offered.every((to) => to === "submitted" || to === "withdrawn")).toBe(true);
    }
  });

  it("keeps assignment out of the review buttons", () => {
    expect(availableTransitions("approved", { isOwner: false, isReviewer: true, isDirector: true })).not.toContain(
      "assigned",
    );
  });

  it("requires notes where the participant needs an explanation", () => {
    expect(requiresNote("under_review", "needs_information")).toBe(true);
    expect(requiresNote("under_review", "rejected")).toBe(true);
    expect(requiresNote("under_review", "approved")).toBe(false);
  });
});
