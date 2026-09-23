export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupMembership {
  id: number;
  user: number;
  user_name: string;
  user_email: string;
  user_avatar: string;
  role: GroupRole;
  is_active: boolean;
  joined_at: string;
}

export interface Group {
  id: number;
  name: string;
  avatar_url: string;
  invite_code: string;
  created_by: number;
  created_at: string;
  members: GroupMembership[];
}
