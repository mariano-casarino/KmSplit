import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Botón de volver reutilizable con chevron estilo iOS (SVG, más grande que
 * el viejo "<"). Si se pasa `link` navega con el router; si no, emite `tap`
 * para que el consumidor decida (cancelar edición, back() custom, etc.).
 */
@Component({
  selector: 'app-back-button',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './back-button.component.html',
  styleUrl: './back-button.component.scss',
})
export class BackButtonComponent {
  @Input() link: string | (string | number)[] | undefined;
  @Input() ariaLabel = 'Volver';
  @Output() tap = new EventEmitter<void>();
}