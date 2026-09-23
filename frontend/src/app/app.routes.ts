import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },

  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'registro',
    loadComponent: () =>
      import('./features/auth/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'recuperar-contrasena',
    loadComponent: () =>
      import('./features/auth/forgot-password/forgot-password.component').then(
        (m) => m.ForgotPasswordComponent,
      ),
  },

  {
    path: 'grupos/nuevo',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/groups/group-onboarding/group-onboarding.component').then(
        (m) => m.GroupOnboardingComponent,
      ),
  },
  {
    path: 'grupos/selector',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/groups/group-select/group-select.component').then(
        (m) => m.GroupSelectComponent,
      ),
  },
  {
    path: 'grupos/crear',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/groups/group-create/group-create.component').then(
        (m) => m.GroupCreateComponent,
      ),
  },
  {
    path: 'grupos/unirse',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/groups/group-join/group-join.component').then(
        (m) => m.GroupJoinComponent,
      ),
  },

  {
    path: 'perfil',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/profile/profile.component').then((m) => m.ProfileComponent),
  },

  {
    path: 'vehiculos',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/vehicles/vehicle-select/vehicle-select.component').then(
        (m) => m.VehicleSelectComponent,
      ),
  },
  {
    path: 'vehiculos/nuevo',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/vehicles/vehicle-create/vehicle-create.component').then(
        (m) => m.VehicleCreateComponent,
      ),
  },

  {
    path: 'vehiculo/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/vehicles/vehicle-home/vehicle-home.component').then(
        (m) => m.VehicleHomeComponent,
      ),
  },
  {
    path: 'vehiculo/:id/viaje',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/trips/trip-form/trip-form.component').then((m) => m.TripFormComponent),
  },
  {
    path: 'vehiculo/:id/carga',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/fuel-loads/fuel-load-form/fuel-load-form.component').then(
        (m) => m.FuelLoadFormComponent,
      ),
  },
  {
    path: 'vehiculo/:id/resumen',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/summary/summary.component').then((m) => m.SummaryComponent),
  },
  {
    path: 'vehiculo/:id/historial',
    canActivate: [authGuard],
    data: { scope: 'full' },
    loadComponent: () =>
      import('./features/history/history.component').then((m) => m.HistoryComponent),
  },
  {
    path: 'vehiculo/:id/historial/semana',
    canActivate: [authGuard],
    data: { scope: 'week' },
    loadComponent: () =>
      import('./features/history/history.component').then((m) => m.HistoryComponent),
  },
  {
    path: 'vehiculo/:id/admin',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin/admin.component').then((m) => m.AdminComponent),
  },
  {
    path: 'vehiculo/:id/liquidacion/:settlementId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settlements/settlement-detail/settlement-detail.component').then(
        (m) => m.SettlementDetailComponent,
      ),
  },

  { path: '**', redirectTo: 'login' },
];
