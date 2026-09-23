import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Diálogo de confirmación compartido (reemplaza el viejo window.confirm y la
 * copia duplicada que tenía vehicle-select). Variantes: 'danger' (rojo, para
 * acciones destructivas como salir del grupo) o 'confirm' (verde, para
 * acciones normales separadas por un selector).
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
  @Input({ required: true }) title = '';
  @Input({ required: true }) message = '';
  @Input() confirmLabel = 'Confirmar';
  @Input() cancelLabel = 'Cancelar';
  @Input() variant: 'danger' | 'confirm' = 'danger';
  /** Texto opcional de advertencia (panel ámbar, debajo del mensaje). */
  @Input() warning: string | null = null;
  /** Deshabilita los botones mientras hay una operación en vuelo. */
  @Input() busy = false;

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  confirm(): void {
    this.confirmed.emit();
  }

  cancel(): void {
    this.cancelled.emit();
  }
}