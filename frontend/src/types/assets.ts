export type AssetType = "text" | "int" | "bool" | "credential" | "secret";

export interface Asset {
  id: number;
  name: string;
  type: AssetType;
  value: string; // may be masked (e.g., "***") for secret/credential
  username?: string | null; // for credential outputs only
  isSecret: boolean;
  credentialStoreId?: number | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}
