import { createFileRoute, redirect } from "@tanstack/react-router";
// Existing receipts remain in the database; Caja is the single operational report.
export const Route = createFileRoute("/_authenticated/cuotas")({
  beforeLoad: () => {
    throw redirect({ to: "/caja", replace: true });
  },
});
