export type TriggerType = 'TIME' | 'QUEUE';

export interface Trigger {
  id: string;
  name: string;
  type: TriggerType;
  processId: number;
  enabled: boolean;
  robotId?: number | null;
  cronExpression?: string | null;
  timezone?: string | null;
  lastFiredAt?: string | null;
  nextFireAt?: string | null;
  queueId?: number | null;
  batchSize?: number | null;
  pollingInterval?: number | null;
  lastProcessedItemId?: number | null;
  createdAt: string;
  updatedAt: string;
}
