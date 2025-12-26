export type MachineMode = "dev" | "runner";
export type MachineStatus = "connected" | "disconnected";

export interface Machine {
  id: number;
  name: string;
  mode: MachineMode;
  status: MachineStatus;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  robotCount: number;

  // Returned only at creation time for runner machines
  machineKey?: string;
}
