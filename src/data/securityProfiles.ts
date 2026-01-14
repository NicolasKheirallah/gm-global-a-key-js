export type SecurityAlgorithm = "GMLAN" | "SA015" | "UNKNOWN";

export interface SecurityLevelProfile {
  level: number;
  algorithm: SecurityAlgorithm;
  algoId?: number;
  table?: "gmlan" | "others" | "class2";
  keyBytes?: number;
  session?: number;
  notes?: string;
}

export interface SecurityProfile {
  id: string;
  name: string;
  defaultLevel?: number;
  levels?: SecurityLevelProfile[];
  notes?: string;
}

// Populate this with verified internal ECU security mappings.
export const SECURITY_PROFILES: SecurityProfile[] = [
  {
    id: "7E0",
    name: "ECM (Engine Control Module)",
    defaultLevel: 0x01,
    levels: [{ level: 0x01, algorithm: "UNKNOWN" }],
  },
  {
    id: "7E1",
    name: "TCM (Transmission Control Module)",
    defaultLevel: 0x01,
    levels: [{ level: 0x01, algorithm: "UNKNOWN" }],
  },
  {
    id: "241",
    name: "BCM (Body Control Module)",
    defaultLevel: 0x01,
    levels: [{ level: 0x01, algorithm: "UNKNOWN" }],
  },
];

export function getSecurityProfile(id: string): SecurityProfile | undefined {
  return SECURITY_PROFILES.find((profile) => profile.id.toUpperCase() === id);
}
