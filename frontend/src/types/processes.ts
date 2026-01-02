export interface Process {
  id: number;
  name: string;
  description?: string | null;
  packageId?: number | null;
  scriptPath: string;
  entrypointName?: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  package?: import('./package').Package | null;
  latestVersion?: string | null;
  upgradeAvailable?: boolean;
}
