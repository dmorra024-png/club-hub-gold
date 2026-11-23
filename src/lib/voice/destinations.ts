/** Real routes only. These capabilities navigate; none writes or confirms data. */
export const voiceDestinations = {
  home: "/",
  member_create: "/soci/nuovo",
  members: "/soci/gestisci",
  products: "/productos",
  product_create: "/productos",
  categories: "/productos",
  stock: "/productos",
  cash: "/caja",
  cash_report: "/caja",
  reports: "/ajustes/informes",
  activity: "/actividades",
  profile: "/perfil",
  settings: "/ajustes",
  personalizations: "/ajustes/personalizaciones",
  general_settings: "/ajustes/generales",
  wallet_settings: "/ajustes/monedero",
  theme_settings: "/ajustes/tema-visual",
  collaborators: "/ajustes/colaboradores",
  membership_settings: "/ajustes/socios",
  membership_fees: "/ajustes/cuotas",
  devices: "/ajustes/dispositivos",
  member_import: "/soci/importar",
  access_control: "/control-acceso",
} as const;
export type VoiceDestination = keyof typeof voiceDestinations;
export const voiceDestinationNames = Object.keys(voiceDestinations) as [
  VoiceDestination,
  ...VoiceDestination[],
];
