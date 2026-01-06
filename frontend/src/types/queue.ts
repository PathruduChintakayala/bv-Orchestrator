export interface Queue {
  // internalId should only be used for React keys; externalId is the public GUID
  internalId?: number | null;
  externalId: string;
  name: string;
  description?: string | null;
  maxRetries: number;
  enforceUniqueReference: boolean;
  createdAt: string;
  updatedAt: string;
}
