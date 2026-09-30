import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';

@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './bottom-nav.component.html',
  styleUrl: './bottom-nav.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BottomNavComponent {
  @Input({ required: true }) vehicleId!: number;
  private router = inject(Router);

  /** La URL activa, como signal. Antes leía `router.url` desde el template:
   *  eso no es reactivo, así que la tab activa se actualizaba por casualidad
   *  (cuando otro evento disparaba el change detection) y con OnPush no se
   *  actualizaba nunca. */
  private readonly urlActual = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  isResumenActive(): boolean {
    const url = this.urlActual();
    const segments = ['/resumen', '/historial', '/historial/semana'];
    return segments.some((s) => url.includes(s));
  }

  /**
   * El ítem "Carga" también engloba las liquidaciones, porque desde el form de
   * carga se accede a ellas. Marcamos activo en azul /carga y /liquidacion/:id.
   */
  isCargaActive(): boolean {
    const url = this.urlActual();
    return url.includes('/carga') || url.includes('/liquidacion');
  }
}
