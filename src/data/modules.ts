export interface GMModule {
  id: string; // "7E0"
  name: string;
  description: string;
}

/**
 * Comprehensive GM Global A Platform Module Database
 * Standard CAN IDs for diagnostic communication
 */
export const GM_MODULES: GMModule[] = [
  // Powertrain
  { id: "7E0", name: "ECM", description: "Engine Control Module" },
  { id: "7E1", name: "TCM", description: "Transmission Control Module" },
  { id: "7E2", name: "FPCM", description: "Fuel Pump Control Module" },
  { id: "7E3", name: "HPCM", description: "Hybrid Powertrain Control Module" },
  { id: "7E4", name: "TCCM", description: "Transfer Case Control Module" },

  // Body & Comfort
  { id: "241", name: "BCM", description: "Body Control Module" },
  {
    id: "242",
    name: "RCDLR",
    description: "Remote Control Door Lock Receiver",
  },
  { id: "244", name: "IMMO", description: "Immobilizer Module" },
  { id: "248", name: "IPC", description: "Instrument Panel Cluster" },
  {
    id: "24A",
    name: "SDM",
    description: "Sensing and Diagnostic Module (Airbag)",
  },
  { id: "24B", name: "ORC", description: "Occupant Restraint Controller" },
  {
    id: "24C",
    name: "HVAC",
    description: "Heating, Ventilation, Air Conditioning",
  },
  { id: "24D", name: "RRSM", description: "Rear Right Seat Module" },
  { id: "24E", name: "RLSM", description: "Rear Left Seat Module" },
  { id: "24F", name: "DSM", description: "Driver Seat Module" },

  // Chassis & Safety
  { id: "243", name: "EBCM", description: "Electronic Brake Control Module" },
  { id: "250", name: "EPS", description: "Electric Power Steering" },
  {
    id: "251",
    name: "ECAS",
    description: "Electronic Controlled Air Suspension",
  },
  { id: "252", name: "RDCM", description: "Real-Time Damping Control Module" },
  { id: "253", name: "TPMS", description: "Tire Pressure Monitoring System" },
  { id: "256", name: "PAS", description: "Park Assist System" },
  { id: "257", name: "ACC", description: "Adaptive Cruise Control" },
  { id: "25A", name: "FCM", description: "Forward Collision Mitigation" },
  { id: "25B", name: "LKA", description: "Lane Keep Assist" },

  // Infotainment & Telematics
  { id: "254", name: "Radio", description: "Radio / Infotainment Head Unit" },
  { id: "258", name: "HMI", description: "Human Machine Interface" },
  { id: "259", name: "AMP", description: "Audio Amplifier" },
  { id: "25C", name: "TCU", description: "Telematics Control Unit (OnStar)" },
  {
    id: "25D",
    name: "VCIM",
    description: "Vehicle Communication Interface Module",
  },
  { id: "25E", name: "RSE", description: "Rear Seat Entertainment" },
  { id: "25F", name: "NAV", description: "Navigation Module" },

  // Doors & Windows
  { id: "260", name: "PDM", description: "Passenger Door Module" },
  { id: "261", name: "DDM", description: "Driver Door Module" },
  { id: "262", name: "RLRDM", description: "Rear Left Rear Door Module" },
  { id: "263", name: "RRRDM", description: "Rear Right Rear Door Module" },
  { id: "264", name: "LGM", description: "Liftgate Module" },
  { id: "265", name: "SRM", description: "Sunroof Module" },

  // Lighting
  { id: "270", name: "FHLM", description: "Front Headlamp Module (Left)" },
  { id: "271", name: "FHRM", description: "Front Headlamp Module (Right)" },
  { id: "272", name: "RLTM", description: "Rear Lighting Module" },
  { id: "273", name: "AHL", description: "Adaptive Headlight Leveling" },
  { id: "274", name: "CHL", description: "Corner/High Beam Control" },

  // Vision & Cameras
  { id: "280", name: "RVC", description: "Rear Vision Camera" },
  { id: "281", name: "SVC", description: "Surround Vision Camera" },
  { id: "282", name: "FFC", description: "Forward Facing Camera" },
  { id: "283", name: "IRM", description: "Inside Rearview Mirror" },
  { id: "284", name: "HUD", description: "Head-Up Display" },
  { id: "285", name: "DMS", description: "Driver Monitoring System" },

  // Functional Addresses (ISO 14229)
  { id: "7DF", name: "FUNC", description: "Functional Broadcast (All ECUs)" },
];
