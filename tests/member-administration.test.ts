import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCalendarDays,
  calendarDate,
  decodeMemberDraft,
  isAdult,
  madridToday,
  mergeUneditedValues,
  parseAdministrativeDictation,
} from "../src/lib/member-administration.ts";

test("dates reject rollover, impossible days, missing centuries and partial matches", () => {
  assert.equal(calendarDate("2024-02-29"), "2024-02-29");
  assert.equal(calendarDate("24/07/1995"), "1995-07-24");
  for (const value of [
    "2023-02-29",
    "31/04/2000",
    "2020-13-01",
    "2020-00-01",
    "2020-01-00",
    "1/2/99",
    "prefix 24/07/1995",
    "",
  ])
    assert.equal(calendarDate(value), null);
});
test("eighteenth birthday uses calendar age, including leap day and future dates", () => {
  assert.equal(isAdult("2008-11-05", "2026-11-05"), true);
  assert.equal(isAdult("2008-11-06", "2026-11-05"), false);
  assert.equal(isAdult("2008-02-29", "2026-02-28"), false);
  assert.equal(isAdult("2008-02-29", "2026-03-01"), true);
  assert.equal(isAdult("2030-01-01", "2026-11-05"), false);
  assert.equal(isAdult("2000-02-31", "2026-11-05"), false);
});
test("association date follows Madrid midnight and renewals cross DST and month boundaries", () => {
  assert.equal(madridToday(new Date("2026-07-01T22:30:00Z")), "2026-07-02");
  assert.equal(madridToday(new Date("2026-11-05T23:30:00Z")), "2026-11-06");
  assert.equal(addCalendarDays("2026-03-28", 2), "2026-03-30");
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  for (const days of [-1, NaN, Infinity, 1.5])
    assert.throws(() => addCalendarDays("2026-11-05", days));
});
test("Italian dictation preserves apostrophes, ISO dates, accents and known fee aliases", () => {
  assert.deepEqual(
    parseAdministrativeDictation(
      "Nome Persona cognome D'Amico nascita 2000-02-29 città Città Demo telefono +39 000 000 email demo@example.test documento DEMO123 quota mensile",
      ["Mensual"],
    ),
    {
      first_name: "Persona",
      last_name: "D'Amico",
      birth_date: "2000-02-29",
      city: "Città Demo",
      phone: "+39000000",
      email: "demo@example.test",
      dni_number: "DEMO123",
      plan_name: "Mensual",
    },
  );
});
test("Spanish dictation extracts only supplied values and refuses unknown fees/invalid dates", () => {
  assert.deepEqual(
    parseAdministrativeDictation(
      "Nombre Persona apellido Demo nacimiento 29/02/2000 ciudad Lugar Demo cuota Anual",
      ["Anual"],
    ),
    {
      first_name: "Persona",
      last_name: "Demo",
      birth_date: "2000-02-29",
      city: "Lugar Demo",
      plan_name: "Anual",
    },
  );
  assert.deepEqual(
    parseAdministrativeDictation("nacimiento 31/02/2000 cuota Desconocida", ["Mensual", ""]),
    { plan_name: "" },
  );
  assert.deepEqual(parseAdministrativeDictation("texto sin campos", ["Mensual"]), {});
});

test("temporary AI drafts expire and cannot inject roles or arbitrary form properties", () => {
  const raw = JSON.stringify({
    at: 1000,
    fields: { first_name: "Persona", role: "super_admin", club_id: "other" },
  });
  assert.deepEqual(decodeMemberDraft(raw, 1001), { first_name: "Persona" });
  assert.equal(decodeMemberDraft(raw, 121001), null);
  assert.equal(decodeMemberDraft(raw, 999), null);
  assert.equal(decodeMemberDraft("malformed", 1001), null);
});

test("late AI suggestions preserve manual edits and ignore blank or unrelated fields", () => {
  const original = { first_name: "", last_name: "", city: "Original" };
  const current = { ...original, first_name: "Manual edit" };
  const suggestions = { first_name: "AI name", last_name: "Demo", city: "", role: "admin" };
  assert.deepEqual(mergeUneditedValues(current, original, suggestions), {
    first_name: "Manual edit",
    last_name: "Demo",
    city: "Original",
  });
});
