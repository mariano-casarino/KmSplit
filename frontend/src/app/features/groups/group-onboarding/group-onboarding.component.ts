import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-group-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './group-onboarding.component.html',
  styleUrl: './group-onboarding.component.scss',
})
export class GroupOnboardingComponent {}
