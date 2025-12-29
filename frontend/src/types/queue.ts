export interface Queue {
  id: number;
  name: string;
  description?: string | null;
  maxRetries: number;
  enforceUniqueReference: boolean;
  createdAt: string;
  updatedAt: string;
}
