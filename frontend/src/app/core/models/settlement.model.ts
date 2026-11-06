export type SettlementStatus = 'pendiente' | 'pagado';

export interface SettlementDetail {
  id: number;
  user: number;
  user_name: string;
  registered_km: number;
  unassigned_km_share: number;
  km_driven: number;
  percentage: number;
  amount_owed: number;
  paid?: boolean;
  paid_at?: string | null;
  paid_by?: number | null;
  paid_by_name?: string | null;
}

export interface Settlement {
  id: number;
  vehicle: number;
  fuel_load: number;
  period_start_km: number;
  period_end_km: number;
  total_amount: number;
  unassigned_km: number;
  status: SettlementStatus;
  status_updated_by: number | null;
  load_date: string;
  loaded_by?: number | null;
  loaded_by_name: string;
  created_at: string;
  details: SettlementDetail[];
}
