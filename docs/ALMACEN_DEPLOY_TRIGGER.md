SNOOP warehouse + dispensary guarded pilot deployment. SQL migrations verified; 19 products zero stock differences at 0.001 precision. Isolated build success. No edits to JARVIS, SNOOP Socio, financial history, or existing stock totals. Stock transfer idempotence tested in rolled-back transaction.


## Corrective release — 2026-11-24
Preserve exact operator-entered euro amount in SNOOP orders (20.00 EUR must remain 20.00 EUR at 22 EUR/g), prevent merma changes from changing charged amount, and register the existing Finanzas route for TypeScript compilation. PR #64 merged as 54a72b11d9f46180760279bc2acf78d6900d968d. Publish only to the guarded SNOOP pilot; keep SNOOP Socio and REAL unchanged. No database schema or stock adjustments.
