import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap } from 'rxjs';

import { Group } from '../models/group.model';
import { GroupService } from './group.service';
import { VehicleService } from './vehicle.service';

/** Mismo mapa "último acceso por grupo" que mantiene GroupSelectComponent. */
const LAST_GROUP_ACCESS_KEY = 'kmsplit_last_group_access';

/**
 * Decide a dónde mandar al usuario después de iniciar sesión.
 *
 * Si ya venía trabajando en un grupo y vehículo, lo deja directo en su
 * último vehículo (salta la cadena grupos -> vehículos). Si no tiene grupos,
 * va al onboarding; si no puede reanudar, al selector de vehículos.
 */
@Injectable({ providedIn: 'root' })
export class SessionResumeService {
  private groupService = inject(GroupService);
  private vehicleService = inject(VehicleService);

  /** Ruta a la que navegar tras el login (los errores se propagan: el
   *  llamador decide el fallback). */
  resumeRoute(): Observable<string[]> {
    return this.groupService.list().pipe(
      switchMap((groups) => {
        if (groups.length === 0) {
          return of(['/grupos/nuevo']);
        }
        const picked = this.pickGroup(groups);
        this.groupService.setActiveGroupId(picked.id);

        return this.vehicleService.list().pipe(
          map((vehicles) => {
            const groupVehicles = vehicles.filter((v) => v.group === picked.id);
            const lastId = this.vehicleService.getLastVehicleId();
            if (lastId !== null && groupVehicles.some((v) => v.id === lastId)) {
              return ['/vehiculo', String(lastId)];
            }
            return ['/vehiculos'];
          }),
        );
      }),
    );
  }

  /** Grupo objetivo: el activo si sigue existiendo; si no, el de acceso más
   *  reciente; si no, el primero. */
  private pickGroup(groups: Group[]): Group {
    const activeId = this.groupService.getActiveGroupId();
    if (activeId !== null) {
      const active = groups.find((g) => g.id === activeId);
      if (active) return active;
    }
    const lastAccessId = this.lastAccessedGroupId(groups);
    const last = groups.find((g) => g.id === lastAccessId);
    return last ?? groups[0];
  }

  private lastAccessedGroupId(groups: Group[]): number | null {
    try {
      const raw = localStorage.getItem(LAST_GROUP_ACCESS_KEY);
      if (!raw) return null;
      const map = JSON.parse(raw) as Record<string, number>;
      let bestId: number | null = null;
      let bestTs = -1;
      for (const g of groups) {
        const ts = map[g.id];
        if (typeof ts === 'number' && ts > bestTs) {
          bestTs = ts;
          bestId = g.id;
        }
      }
      return bestId;
    } catch {
      return null;
    }
  }
}