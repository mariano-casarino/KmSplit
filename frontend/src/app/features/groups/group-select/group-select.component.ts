import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Group } from '../../../core/models/group.model';
import { User } from '../../../core/models/user.model';
import { AuthService } from '../../../core/services/auth.service';
import { GroupService } from '../../../core/services/group.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-group-select',
  standalone: true,
  imports: [CommonModule, RouterLink, ConfirmDialogComponent],
  templateUrl: './group-select.component.html',
  styleUrl: './group-select.component.scss',
})
export class GroupSelectComponent {
  private groupService = inject(GroupService);
  private auth = inject(AuthService);
  private router = inject(Router);

  /** Cuándo se entró por última vez a cada grupo: {"<groupId>": epochMs}. */
  private static readonly LAST_GROUP_ACCESS_KEY = 'kmsplit_last_group_access';

  groups = signal<Group[]>([]);
  loading = signal(true);
  errorMessage = signal<string | null>(null);
  selectingId = signal<number | null>(null);
  pendingLogout = signal(false);
  loggingOut = signal(false);

  /** Usuario reactivo: fetchMe corre en paralelo con la lista de grupos y
   *  puede terminar después (los roles se calculan sobre un signal). */
  private user = signal<User | null>(this.auth.getCurrentUser());

  constructor() {
    // fetchMe y la lista corren en paralelo: la lista no depende del usuario.
    this.auth.fetchMe().subscribe({
      next: (user) => this.user.set(user),
      error: () => {
        /* los roles quedan ocultos, no bloqueamos la lista */
      },
    });
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.groupService.list().subscribe({
      next: (groups) => {
        if (groups.length === 0) {
          // sin grupos todavía -> onboarding para crear o unirse
          this.router.navigate(['/grupos/nuevo']);
          return;
        }
        this.groups.set(groups);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('No pudimos cargar tus grupos.');
        this.loading.set(false);
      },
    });
  }

  isActive(group: Group): boolean {
    return group.id === this.groupService.getActiveGroupId();
  }

  /** Elige el grupo, lo deja como activo y va a la lista de sus vehículos. */
  selectGroup(group: Group): void {
    this.selectingId.set(group.id);
    this.errorMessage.set(null);
    this.groupService.setActiveGroupId(group.id);
    this.saveLastAccess(group.id);
    this.router.navigate(['/vehiculos']);
  }

  private saveLastAccess(groupId: number): void {
    try {
      const raw = localStorage.getItem(GroupSelectComponent.LAST_GROUP_ACCESS_KEY);
      const map = raw ? JSON.parse(raw) : {};
      map[groupId] = Date.now();
      localStorage.setItem(GroupSelectComponent.LAST_GROUP_ACCESS_KEY, JSON.stringify(map));
    } catch {
      /* localStorage no disponible: solo se pierde el "último acceso" */
    }
  }

  private lastAccessTs(groupId: number): number | null {
    try {
      const raw = localStorage.getItem(GroupSelectComponent.LAST_GROUP_ACCESS_KEY);
      if (!raw) return null;
      const map = JSON.parse(raw);
      return typeof map[groupId] === 'number' ? map[groupId] : null;
    } catch {
      return null;
    }
  }

  lastAccessLabel(group: Group): string {
    const ts = this.lastAccessTs(group.id);
    if (ts === null) return 'Último acceso';
    const days = Math.floor((Date.now() - ts) / 86_400_000);
    if (days <= 0) return 'Últ. acceso: hoy';
    if (days === 1) return 'Últ. acceso: ayer';
    return `Últ. acceso: hace ${days} días`;
  }

  memberCount(group: Group): number {
    return group.members.filter((m) => m.is_active).length;
  }

  myRole(group: Group): string {
    const userId = this.user()?.id;
    const membership = group.members.find((m) => m.user === userId);
    if (!membership) return '';
    if (membership.role === 'owner') return 'Owner';
    if (membership.role === 'admin') return 'Admin';
    return 'Member';
  }

  requestLogout(): void {
    this.pendingLogout.set(true);
  }

  cancelLogout(): void {
    this.pendingLogout.set(false);
  }

  confirmLogout(): void {
    this.loggingOut.set(true);
    // logout() llama al backend (invalida la cookie httpOnly del refresh
    // token), así que hay que esperar la respuesta antes de navegar.
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login']),
      complete: () => this.loggingOut.set(false),
    });
  }
}