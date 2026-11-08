import { createFileRoute, redirect } from "@tanstack/react-router";
// Keep old links valid without exposing a second catalogue. Stored archive rows are untouched.
export const Route = createFileRoute("/_authenticated/geneticas")({
  beforeLoad: () => {
    throw redirect({ to: "/productos", replace: true });
  },
});
