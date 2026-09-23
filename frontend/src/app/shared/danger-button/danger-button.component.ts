import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Botón de acción destructiva: tiene la misma forma que el botón primario de
 * la app (.btn), pero con el texto y el borde en rojo, igual que el "Eliminar"
 * del detalle de la última liquidación. Se usa para "Cerrar sesión" y
 * "Abandonar este grupo".
 */
@Component({
  selector: 'app-danger-button',
  standalone: true,
  templateUrl: './danger-button.component.html',
  styleUrl: './danger-button.component.scss',
})
export class DangerButtonComponent {
  @Input({ required: true }) label = '';
  @Input() busyLabel = 'Esperá...';
  @Input() busy = false;
  @Input() disabled = false;

  @Output() clicked = new EventEmitter<void>();

  click(): void {
    this.clicked.emit();
  }
}