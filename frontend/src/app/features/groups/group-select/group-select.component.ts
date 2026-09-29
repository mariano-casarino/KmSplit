import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Group } from '../../../core/models/group.model';
import { User } from '../../../core/models/user.model';
import { AuthService } from '../../../core/services/auth.service';
import { GroupService } from '../../../core/services/group.service';
import { AvatarComponent } from '../../../shared/avatar/avatar.component';
import { fileToCompressedDataUri } from '../../../shared/utils/image.util';

type Feedback = { type: 'success' | 'error'; text: string } | null;

@Component({
  selector: 'app-group-select',
  standalone: true,
  imports: [CommonModule, RouterLink, AvatarComponent],
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

  photoEditor = signal<Group | null>(null);
  photoPreview = signal<string | null>(null);
  photoSaving = signal(false);
  photoFeedback = signal<Feedback>(null);
  private photoTimer: ReturnType<typeof setTimeout> | null = null;

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

  openPhotoEditor(group: Group): void {
    this.photoEditor.set(group);
    this.photoPreview.set(null);
    this.photoFeedback.set(null);
    this.clearPhotoTimer();
  }

  closePhotoEditor(): void {
    if (this.photoSaving()) return;
    this.photoEditor.set(null);
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    this.photoSaving.set(true);
    this.photoFeedback.set(null);
    this.clearPhotoTimer();

    fileToCompressedDataUri(file)
      .then((dataUri) => {
        this.photoPreview.set(dataUri);
        this.savePhoto(dataUri);
      })
      .catch((err: Error) => {
        this.photoSaving.set(false);
        this.photoFeedback.set({ type: 'error', text: err.message });
      });
  }

  removeGroupPhoto(): void {
    this.photoSaving.set(true);
    this.photoFeedback.set(null);
    this.clearPhotoTimer();
    this.photoPreview.set(null);
    this.savePhoto('');
  }

  private savePhoto(avatarUrl: string): void {
    const group = this.photoEditor();
    if (!group) return;

    this.groupService.updateAvatarUrl(group.id, avatarUrl).subscribe({
      next: (updated) => {
        this.groups.update((groups) => groups.map((g) => (g.id === updated.id ? updated : g)));
        this.photoSaving.set(false);
        this.photoFeedback.set({
          type: 'success',
          text: avatarUrl ? 'Foto del grupo actualizada.' : 'Foto del grupo eliminada.',
        });
        // el mensaje de éxito se oculta solo tras 3 segundos
        this.clearPhotoTimer();
        this.photoTimer = setTimeout(() => this.photoFeedback.set(null), 3000);
      },
      error: (err) => {
        this.photoSaving.set(false);
        this.photoFeedback.set({
          type: 'error',
          text: err.error?.avatar_url?.[0] ?? 'No pudimos guardar la foto.',
        });
      },
    });
  }

  private clearPhotoTimer(): void {
    if (this.photoTimer) {
      clearTimeout(this.photoTimer);
      this.photoTimer = null;
    }
  }
}