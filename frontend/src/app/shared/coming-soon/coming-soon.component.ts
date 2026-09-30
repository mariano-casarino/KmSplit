import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

@Component({
  selector: 'app-coming-soon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="screen coming-soon">
      <p class="coming-soon-emoji">🚧</p>
      <p class="coming-soon-text">Esta pantalla todavía no está construida.</p>
      <button class="btn btn-secondary" type="button" (click)="back()">Volver</button>
    </div>
  `,
  styles: [
    `
      .coming-soon {
        align-items: center;
        justify-content: center;
        text-align: center;
        gap: 12px;
      }
      .coming-soon-emoji {
        font-size: 40px;
        margin: 0;
      }
      .coming-soon-text {
        color: var(--gray-700);
        font-size: 14px;
        margin: 0 0 12px;
      }
    `,
  ],
})
export class ComingSoonComponent {
  private location = inject(Location);

  back(): void {
    this.location.back();
  }
}
