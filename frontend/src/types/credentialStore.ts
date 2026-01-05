export type CredentialStoreType =
  | "INTERNAL_DB"
  | "AZURE_KEY_VAULT"
  | "CYBERARK"
  | "AWS_SECRETS_MANAGER"
  | "HASHICORP_VAULT";

export interface CredentialStore {
  id: number;
  name: string;
  type: CredentialStoreType;
  isDefault: boolean;
  isActive: boolean;
  statusLabel: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}
