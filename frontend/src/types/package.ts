export interface Package {
  id: number;
  name: string;
  version: string; // "1.2.0"
  isActive: boolean;
  scripts: string[];
  createdAt: string;
  updatedAt: string;
}
