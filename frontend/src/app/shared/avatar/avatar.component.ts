import { Component, Input, computed } from '@angular/core';
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
})
export class AvatarComponent {
  /** Apodo/nombre que se muestra (con primero+apellido si aplica). */
  @Input() display = '';
  /** Data URI o URL de la foto. Vacío/null = mostrar iniciales. */
  @Input() photoUrl: string | null | undefined = null;
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  /** Clave estable para el color (id del usuario): así todos los avatares de
   *  la misma persona tienen el mismo color, sin importar el texto del
   *  display (apodo, nombre real, etc.). Si no viene, se usa el display. */
  @Input() colorKey: string | number | null = null;

  protected readonly initials = computed(() => getInitials(this.display));
  protected readonly color = computed(() => {
    const key = this.colorKey != null ? String(this.colorKey) : this.display;
    return avatarColor(key);
  });
}