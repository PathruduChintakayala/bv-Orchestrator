export interface Package {
  id: number;
  name: string;
  version: string; // "1.2.0"
  isActive: boolean;
  isBvpackage?: boolean;
  entrypoints?: Array<{ name: string; command: string; default: boolean }> | null;
  defaultEntrypoint?: string | null;
  scripts: string[];
  createdAt: string;
  updatedAt: string;
  downloadUrl?: string | null;
  downloadAvailable?: boolean;
  sizeBytes?: number | null;
}
