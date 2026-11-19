import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parsePrintedDocumentText } from "../src/lib/local-document-visual.ts";

test("labeled Spanish identity fields from non-MRZ printed page", () => {
 const text = ["APELLIDOS: GARCIA PEREZ","NOMBRE: MARIA JOSE","FECHA DE NACIMIENTO: 13/05/1990","NUMERO DE PASAPORTE: PA123456","DOMICILIO: Calle Mayor 5","LOCALIDAD: Palma","CODIGO POSTAL: 07001"].join("\n");
 const result=parsePrintedDocumentText(text);
 assert.deepEqual(result,{last_name:"GARCIA PEREZ",first_name:"MARIA JOSE",birth_date:"1990-05-13",dni_number:"PA123456",address:"Calle Mayor 5",city:"Palma",postal_code:"07001"});
});
test("English bilingual labels, no MRZ needed", () => {
 const result=parsePrintedDocumentText("SURNAME: SMITH\nGIVEN NAMES: ALEX JAMES\nDATE OF BIRTH: 02/01/1985\nPASSPORT NO: 1234AB56");
 assert.equal(result.first_name,"ALEX JAMES");assert.equal(result.last_name,"SMITH");assert.equal(result.birth_date,"1985-01-02");assert.equal(result.dni_number,"1234AB56");
});
test("reject unlabeled random OCR text, impossible date, and suspicious number",()=>{
 const result=parsePrintedDocumentText("MARIA JOSE GARCIA 12345678Z\nNOMBRE: DOCUMENTO\nFECHA DE NACIMIENTO: 31/02/1990\nPASSPORT NO: 1234");
 assert.deepEqual(result,{});
});
