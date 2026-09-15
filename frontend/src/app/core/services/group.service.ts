import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Group, GroupMembership } from '../models/group.model';

/** Cuánto vive un grupo cacheado (evita dato stale si cambian miembros/roles). */
const CACHE_TTL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class GroupService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/groups`;

  private static readonly ACTIVE_GROUP_KEY = 'kmsplit_active_group';

  /** Cache simple en memoria: id -> { group, fetchedAt }. */
  private cache = new Map<number, { group: Group; fetchedAt: number }>();

  /** Cache de la lista de grupos del usuario. */
  private listCache: { groups: Group[]; fetchedAt: number } | null = null;

  list(): Observable<Group[]> {
    if (this.listCache && Date.now() - this.listCache.fetchedAt < CACHE_TTL_MS) {
      return of(this.listCache.groups);
    }
    return this.http.get<Group[]>(`${this.baseUrl}/`).pipe(
      tap((groups) => {
        this.listCache = { groups, fetchedAt: Date.now() };
      }),
    );
  }

  /** El id del grupo en el que el usuario está trabajando ahora. */
  getActiveGroupId(): number | null {
    const raw = localStorage.getItem(GroupService.ACTIVE_GROUP_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  setActiveGroupId(id: number): void {
    localStorage.setItem(GroupService.ACTIVE_GROUP_KEY, String(id));
  }

  clearActiveGroup(): void {
    localStorage.removeItem(GroupService.ACTIVE_GROUP_KEY);
  }

  get(id: number): Observable<Group> {
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
      return of(hit.group);
    }
    return this.http.get<Group>(`${this.baseUrl}/${id}/`).pipe(
      tap((group) => this.cache.set(id, { group, fetchedAt: Date.now() })),
    );
  }

  /** Limpia todos los caches de grupos (lista + detalles pedidos). Llamar
   *  después de crear/unirse/abandonar un grupo o cambiar miembros. */
  invalidate(): void {
    this.cache.clear();
    this.listCache = null;
  }

  create(name: string): Observable<Group> {
    return this.http.post<Group>(`${this.baseUrl}/`, { name }).pipe(
      tap(() => (this.listCache = null)),
    );
  }

  join(inviteCode: string): Observable<Group> {
    return this.http.post<Group>(`${this.baseUrl}/join/`, { invite_code: inviteCode }).pipe(
      tap(() => (this.listCache = null)),
    );
  }

  leave(groupId: number): Observable<{ detail: string }> {
    return this.http
      .post<{ detail: string }>(`${this.baseUrl}/${groupId}/leave/`, {})
      .pipe(tap(() => this.invalidate()));
  }

  updateMember(
    groupId: number,
    userId: number,
    data: { role?: string; remove?: boolean },
  ): Observable<GroupMembership> {
    return this.http
      .patch<GroupMembership>(`${this.baseUrl}/${groupId}/members/${userId}/`, data)
      .pipe(tap(() => this.invalidate()));
  }
}