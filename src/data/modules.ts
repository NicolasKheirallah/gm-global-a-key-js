export interface GMModule {
  id: string; // "7E0"
  name: string;
  description: string;
}

export const GM_MODULES: GMModule[] = [
  { id: "7E0", name: "ECM", description: "Engine Control Module" },
  { id: "7E1", name: "TCM", description: "Transmission Control Module" },
  { id: "7E2", name: "FPCM", description: "Fuel Pump Control Module" },
  { id: "241", name: "BCM", description: "Body Control Module" },
  { id: "243", name: "EBCM", description: "Electronic Brake Control Module" },
  {
    id: "244",
    name: "EBCM",
    description: "Electronic Brake Control Module (Alt)",
  }, // Some use 244
  { id: "248", name: "IPC", description: "Instrument Panel Cluster" },
  {
    id: "24A",
    name: "SDM",
    description: "Sensing and Diagnostic Module (Airbag)",
  },
  {
    id: "24C",
    name: "HVAC",
    description: "Heating, Ventilation, and Air Conditioning",
  },
  { id: "250", name: "EPS", description: "Electronic Power Steering" },
  { id: "254", name: "Radio", description: "Radio / Infotainment" },
  { id: "258", name: "HMI", description: "Human Machine Interface" },
  { id: "260", name: "PDM", description: "Passenger Door Module" },
  { id: "261", name: "DDM", description: "Driver Door Module" },
];
