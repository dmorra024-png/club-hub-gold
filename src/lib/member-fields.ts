// Canonical list of configurable fields for the new-socio form.
// Some fields (first_name, last_name) are always required and not configurable.

export type MemberFieldKey =
  | "birth_date"
  | "dni_number"
  | "dni_photo"
  | "address"
  | "city"
  | "postal_code"
  | "phone"
  | "email"
  | "plan"
  | "signature";

export interface MemberFieldDef {
  key: MemberFieldKey;
  label: string;
  defaultVisible: boolean;
  defaultRequired: boolean;
  sort: number;
}

export const MEMBER_FIELDS: MemberFieldDef[] = [
  { key: "birth_date",  label: "Fecha de nacimiento", defaultVisible: true,  defaultRequired: true,  sort: 10 },
  { key: "dni_number",  label: "Número DNI / NIE",    defaultVisible: true,  defaultRequired: true,  sort: 20 },
  { key: "dni_photo",   label: "Foto del DNI",        defaultVisible: true,  defaultRequired: true,  sort: 30 },
  { key: "address",     label: "Dirección",           defaultVisible: false, defaultRequired: false, sort: 40 },
  { key: "city",        label: "Ciudad",              defaultVisible: true,  defaultRequired: true,  sort: 50 },
  { key: "postal_code", label: "Código postal",       defaultVisible: false, defaultRequired: false, sort: 60 },
  { key: "phone",       label: "Teléfono",            defaultVisible: true,  defaultRequired: true,  sort: 70 },
  { key: "email",       label: "Email",               defaultVisible: true,  defaultRequired: false, sort: 80 },
  { key: "plan",        label: "Cuota / Plan",        defaultVisible: true,  defaultRequired: true,  sort: 90 },
  { key: "signature",   label: "Firma y contrato",    defaultVisible: true,  defaultRequired: true,  sort: 100 },
];

export type FieldConfigMap = Record<MemberFieldKey, { visible: boolean; required: boolean }>;

export function defaultFieldConfig(): FieldConfigMap {
  const out = {} as FieldConfigMap;
  for (const f of MEMBER_FIELDS) out[f.key] = { visible: f.defaultVisible, required: f.defaultRequired };
  return out;
}

export function mergeFieldConfig(rows: Array<{ field_key: string; visible: boolean; required: boolean }>): FieldConfigMap {
  const base = defaultFieldConfig();
  for (const r of rows) {
    if (r.field_key in base) base[r.field_key as MemberFieldKey] = { visible: r.visible, required: r.required };
  }
  return base;
}
