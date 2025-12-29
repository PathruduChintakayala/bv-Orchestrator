export interface Queue {
  id: number;
  name: string;
  description?: string | null;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}
