export interface Queue {
  id: number;
  name: string;
  description?: string | null;
  isActive: boolean;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}
