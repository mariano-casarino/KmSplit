import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { avatarColor, getInitials } from './avatar.util';

/**
 * Avatar reutilizable para usuarios, vehículos y grupos: si hay foto la
 * muestra; si no, círculo de color con las iniciales. El tamaño se elige con
 * size, así el estilo de identidad (paleta + iniciales) queda en un solo
 * lugar.
 */
@Component({
  selector: 'app-avatar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './avatar.component.html',
  styleUrl: './avatar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvatarComponent {
  // Inputs de señal (y no @Input(): los @Input() son propiedades simples y no
  // disparan los computed que dependan de ellas, así que las iniciales y el
  // color se quedaban con los del primer render aunque cambiaran los datos).
  /** Apodo/nombre que se muestra (con primero+apellido si aplica). */
  readonly display = input('');
  /** Data URI o URL de la foto. Vacío/null = mostrar iniciales. */
  readonly photoUrl = input<string | null | undefined>(null);
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  /** Clave estable para el color (id del usuario): así todos los avatares de
   *  la misma persona tienen el mismo color, sin importar el texto del
   *  display (apodo, nombre real, etc.). Si no viene, se usa el display. */
  readonly colorKey = input<string | number | null>(null);

  protected readonly initials = computed(() => getInitials(this.display()));
  protected readonly color = computed(() => {
    const key = this.colorKey() != null ? String(this.colorKey()) : this.display();
    return avatarColor(key);
  });
}