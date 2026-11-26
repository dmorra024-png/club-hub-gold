import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMRZ, parseVisibleText } from "../src/lib/document-ocr.ts";

test("Spanish document fields are mapped without inventing absent fields", () => {
  const fields = parseVisibleText("NOMBRE: ANA MARIA\nAPELLIDOS: GARCIA PEREZ\nFECHA DE NACIMIENTO: 07/04/1994\nDNI: 12345678Z\nDOMICILIO: CALLE MAYOR 5\nLOCALIDAD: PALMA\nCP: 07001");
  assert.equal(fields.first_name, "ANA MARIA");
  assert.equal(fields.last_name, "GARCIA PEREZ");
  assert.equal(fields.birth_date, "1994-04-07");
  assert.equal(fields.dni_number, "12345678Z");
  assert.equal(fields.address, "CALLE MAYOR 5");
  assert.equal(fields.city, "PALMA");
  assert.equal(fields.postal_code, "07001");
});

test("invalid date and unlabeled numbers are not treated as identity data", () => {
  const fields = parseVisibleText("FECHA DE NACIMIENTO: 32/13/1994\nCERTIFICADO 123456789\nNACIONALIDAD: ESPAÑOLA");
  assert.equal(fields.birth_date, undefined);
  assert.equal(fields.dni_number, undefined);
  assert.equal(fields.postal_code, undefined);
});

test("TD1 MRZ accepts checksum-verified birth date even when birth row has no filler", () => {
  const check = (input: string) => {
    const weights = [7, 3, 1];
    return String([...input].reduce((sum, ch, i) => sum + (ch === "<" ? 0 : /[0-9]/.test(ch) ? Number(ch) : ch.charCodeAt(0)-55) * weights[i%3], 0) % 10);
  };
  const id = "12345678<";
  const line1 = ("IDESP" + id + check(id)).padEnd(30, "<");
  const dob = "940407";
  const line2 = (dob + check(dob) + "F" + "300101" + check("300101") + "ESP").padEnd(30,"<");
  const line3 = "GARCIA<PEREZ<<ANA<MARIA".padEnd(30, "<");
  const fields = parseMRZ([line1, line2, line3].join("\n"));
  assert.equal(fields.birth_date, "1994-04-07");
  assert.equal(fields.first_name, "Ana Maria");
  assert.equal(fields.last_name, "Garcia Perez");
});
