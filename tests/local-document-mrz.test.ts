import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mrzCheckDigit, parseMrzText } from "../src/lib/local-document-mrz.ts";
const pad = (s: string, size: number) => s.padEnd(size, "<");
function makeTD1() {
  const doc = pad("12345678Z", 9), born = "900513", expires = "300101";
  const a = "IDESP" + doc + mrzCheckDigit(doc) + "<".repeat(15);
  const bPrefix = born + mrzCheckDigit(born) + "F" + expires + mrzCheckDigit(expires) + "ESP" + "<".repeat(11);
  const overall = mrzCheckDigit(a.slice(5, 30) + bPrefix.slice(0, 7) + bPrefix.slice(8, 15) + bPrefix.slice(18, 29));
  return [a, bPrefix + overall, pad("GARCIA<PEREZ<<MARIA<JOSE", 30)].join("\n");
}
function makeTD3() {
  const doc = pad("PA123456", 9), born = "920102", expires = "310501";
  const a = pad("P<ESPLOPEZ<<ANA<MARIA", 44);
  const bPrefix = doc + mrzCheckDigit(doc) + "ESP" + born + mrzCheckDigit(born) + "F" + expires + mrzCheckDigit(expires) + "<".repeat(14) + "<";
  const overall = mrzCheckDigit(bPrefix.slice(0, 10) + bPrefix.slice(13, 20) + bPrefix.slice(21, 43));
  return [a, bPrefix + overall].join("\n");
}
test("Spanish TD1 returns validated member fields only", () => {
  const result = parseMrzText(makeTD1());
  assert.equal(result?.format, "TD1");
  assert.deepEqual(result?.fields, { first_name: "MARIA JOSE", last_name: "GARCIA PEREZ", birth_date: "1990-05-13", dni_number: "12345678Z", address: "", city: "", postal_code: "" });
});
test("passport TD3 returns validated fields", () => {
  const result = parseMrzText(makeTD3());
  assert.equal(result?.format, "TD3");
  assert.equal(result?.fields.birth_date, "1992-01-02");
  assert.equal(result?.fields.dni_number, "PA123456");
});
test("rejects invalid MRZ check digits and arbitrary OCR text", () => {
  const good = makeTD1();
  assert.equal(parseMrzText(good.replace("900513", "900514")), null);
  assert.equal(parseMrzText("Jane Doe 12345678Z, born 13/05/1990"), null);
});
test("check digit examples", () => {
  assert.equal(mrzCheckDigit("L898902C<"), "3");
});

test("accepts a passport MRZ with OCR spacing, angle quotes and missing trailing fillers", () => {
  const [name, numbers] = makeTD3().split("\n");
  const fragmentedName = name.slice(0, 30).replace(/</g, "«");
  const spacedNumbers = numbers.replace(/(.{11})/g, "$1 ");
  const result = parseMrzText(fragmentedName + "\n" + spacedNumbers);
  assert.equal(result?.format, "TD3");
  assert.equal(result?.fields.dni_number, "PA123456");
});
test("accepts MRZ passport with harmless margin characters", () => {
  const [a,b] = makeTD3().split("\n");
  const result = parseMrzText("XX" + a + "\n" + b + "<<");
  assert.equal(result?.fields.first_name, "ANA MARIA");
});
test("does not bypass ICAO checksums when OCR mistakes a birth-date digit", () => {
  assert.equal(parseMrzText(makeTD3().replace("920102", "920103")), null);
});
