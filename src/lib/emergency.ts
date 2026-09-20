// NFR-11 / BR-17: emergency contacts are hard-coded static content. No fetch, no database,
// no feature flag — they render even when every API route is down.
//
// 1669 and 1323 are Thailand's national emergency-medical and mental-health lines.
// The campus entries are DEMO PLACEHOLDERS — replace with your university's real numbers.

export type EmergencyContact = { name: string; detail: string; phone: string; tel: string };

export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  { name: "Emergency medical services", detail: "Life-threatening emergency, 24 hours", phone: "1669", tel: "1669" },
  { name: "Mental health hotline", detail: "Department of Mental Health, 24 hours", phone: "1323", tel: "1323" },
  { name: "Campus security (demo placeholder)", detail: "On campus, 24 hours", phone: "0-0000-0000", tel: "000000000" },
  { name: "Campus counselling front desk (demo placeholder)", detail: "Weekdays 08:30–16:30", phone: "0-0000-0001", tel: "000000001" },
];

export const CANNOT_HELP_NOW =
  "This app cannot provide immediate help. If you or someone else is in danger or you feel unable to keep yourself safe, please contact one of these numbers now.";
