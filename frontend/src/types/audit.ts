export interface AuditItem {
  id: number;
  timestamp: string;
  actorUsername?: string | null;
  action: string;
  actionType?: string;
  entityType?: string | null;
  entityDisplay?: string;
  entityId?: string | null;
  entityName?: string | null;
  message?: string;
  summary?: string | null;
}

export interface AuditDetail extends AuditItem {
  actorUserId?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  beforeData?: any | null;
  afterData?: any | null;
  metadata?: any | null;
}

export interface AuditListResponse {
  items: AuditItem[];
  total: number;
  page: number;
  page_size: number;
}
