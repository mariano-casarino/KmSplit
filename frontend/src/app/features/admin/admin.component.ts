import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { Group, GroupMembership, GroupRole } from '../../core/models/group.model';
import { FuelType, Vehicle } from '../../core/models/vehicle.model';
import { User } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';
import { GroupService } from '../../core/services/group.service';
import { VehicleService } from '../../core/services/vehicle.service';
import { BottomNavComponent } from '../../shared/bottom-nav/bottom-nav.component';
import { BackButtonComponent } from '../../shared/back-button/back-button.component';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, BottomNavComponent, BackButtonComponent],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  private vehicleService = inject(VehicleService);
  private groupService = inject(GroupService);
  private auth = inject(AuthService);

  vehicleId = Number(this.route.snapshot.paramMap.get('id'));

  vehicle = signal<Vehicle | null>(null);
  group = signal<Group | null>(null);
  loading = signal(true);
  errorMessage = signal<string | null>(null);
  savingToggle = signal(false);
  toggleSaved = signal(false);
  toggleError = signal<string | null>(null);
  codeCopied = signal(false);
  memberActionError = signal<string | null>(null);
  savingVehicle = signal(false);
  vehicleSaved = signal(false);

  fuelTypes: { value: FuelType; label: string }[] = [
    { value: 'nafta', label: 'Nafta' },
    { value: 'diesel', label: 'Diésel' },
    { value: 'gnc', label: 'GNC' },
    { value: 'electrico', label: 'Eléctrico' },
  ];

  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    fuel_type: ['' as FuelType],
    current_km: [null as number | null, [Validators.min(0)]],
  });

  confirmDialog = signal<boolean>(false);
  kmWarning = signal(false);

removeDialog = signal<boolean>(false);
memberToRemove = signal<GroupMembership | null>(null);

/** Perfil del integrante abierto al tocar su nombre (acceso rápido). */
profileMember = signal<GroupMembership | null>(null);
profileMemberUser = signal<User | null>(null);
loadingProfile = signal(false);

  currentUserId = 0;
  myRole = signal<GroupRole | null>(null);

  get canManage(): boolean {
    return this.myRole() === 'owner' || this.myRole() === 'admin';
  }

  get activeMembers(): GroupMembership[] {
    return (this.group()?.members ?? []).filter((m) => m.is_active);
  }

  ngOnInit(): void {
    // Velocidad: usuario y vehículo son independientes -> paralelo. fetchMe es
    // resiliente: si falla, la pantalla del vehículo igual se renderiza.
    forkJoin({
      user: this.auth.fetchMe().pipe(catchError(() => of(null))),
      vehicle: this.vehicleService.get(this.vehicleId),
    }).subscribe({
      next: ({ user, vehicle }) => {
        if (user) this.currentUserId = user.id;
        this.vehicle.set(vehicle);
        this.form.patchValue({
          name: vehicle.name,
          fuel_type: vehicle.fuel_type,
          current_km: vehicle.current_km,
        });
        this.loadGroup(vehicle.group);
      },
      error: () => {
        this.errorMessage.set('No pudimos cargar este vehículo.');
        this.loading.set(false);
      },
    });
  }

  private loadGroup(groupId: number): void {
    this.groupService.get(groupId).subscribe({
      next: (group) => {
        this.group.set(group);
        const membership = group.members.find((m) => m.user === this.currentUserId);
        this.myRole.set(membership?.role ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('No pudimos cargar el grupo.');
        this.loading.set(false);
      },
    });
  }

  toggleSplit(): void {
    const vehicle = this.vehicle();
    if (!vehicle) return;

    if (!this.canManage) {
      this.toggleError.set(
        'Solo el administrador del grupo puede cambiar esta opción.',
      );
      return;
    }

    this.savingToggle.set(true);
    this.toggleSaved.set(false);
    this.toggleError.set(null);

    this.vehicleService
      .update(vehicle.id, {
        split_unassigned_km_all_members: !vehicle.split_unassigned_km_all_members,
      })
      .subscribe({
        next: (updated) => {
          this.vehicle.set(updated);
          this.savingToggle.set(false);
          this.toggleSaved.set(true);
        },
        error: () => {
          this.savingToggle.set(false);
          this.toggleError.set('No pudimos guardar el cambio.');
        },
      });
  }

  requestSaveVehicle(): void {
    const vehicle = this.vehicle();
    if (!vehicle || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // detectamos qué cambió para decidir el aviso del diálogo
    const { name, fuel_type, current_km } = this.form.getRawValue();
    const kmChanged =
      current_km !== null && Number(current_km) !== vehicle.current_km;

    this.kmWarning.set(kmChanged);
    this.confirmDialog.set(true);
  }

  confirmSaveVehicle(): void {
    const vehicle = this.vehicle();
    if (!vehicle) return;

    this.confirmDialog.set(false);
    this.savingVehicle.set(true);
    this.vehicleSaved.set(false);
    this.errorMessage.set(null);

    const { name, fuel_type, current_km } = this.form.getRawValue();

    this.vehicleService
      .update(vehicle.id, {
        name,
        fuel_type: fuel_type || undefined,
        // solo reenviamos km si el usuario lo cambió
        ...(current_km !== null
          ? { current_km: current_km }
          : {}),
      })
      .subscribe({
        next: (updated) => {
          this.vehicle.set(updated);
          this.savingVehicle.set(false);
          this.vehicleSaved.set(true);
        },
        error: (err) => {
          this.savingVehicle.set(false);
          this.errorMessage.set(
            err.error?.detail ?? 'No pudimos guardar los cambios.',
          );
        },
      });
  }

  cancelSaveVehicle(): void {
    this.confirmDialog.set(false);
  }

  fuelLabel(value: FuelType): string {
    return this.fuelTypes.find((f) => f.value === value)?.label ?? 'Sin especificar';
  }

  copyInviteCode(): void {
    const code = this.group()?.invite_code;
    if (!code) return;
    navigator.clipboard?.writeText(code);
    this.codeCopied.set(true);
    setTimeout(() => this.codeCopied.set(false), 2000);
  }

  canModify(member: GroupMembership): boolean {
    const role = this.myRole();
    if (member.user === this.currentUserId) return false;
    if (role === 'owner') return true;
    if (role === 'admin') return member.role === 'member';
    return false;
  }

  canPromote(member: GroupMembership): boolean {
    return this.canModify(member) && member.role === 'member';
  }

  canDemote(member: GroupMembership): boolean {
    return this.myRole() === 'owner' && member.role === 'admin';
  }

  canRemove(member: GroupMembership): boolean {
    return this.canModify(member);
  }

  changeRole(member: GroupMembership, newRole: 'admin' | 'member'): void {
    const group = this.group();
    if (!group) return;

    this.memberActionError.set(null);

    this.groupService.updateMember(group.id, member.user, { role: newRole }).subscribe({
      next: () => this.loadGroup(group.id),
      error: (err) => {
        this.memberActionError.set(err.error?.detail ?? 'No pudimos cambiar el rol.');
      },
    });
  }

  removeMember(member: GroupMembership): void {
    this.memberToRemove.set(member);
    this.removeDialog.set(true);
  }

  confirmRemoveMember(): void {
    const member = this.memberToRemove();
    const group = this.group();
    if (!member || !group) return;

    this.removeDialog.set(false);
    this.memberToRemove.set(null);
    this.memberActionError.set(null);

    this.groupService.updateMember(group.id, member.user, { remove: true }).subscribe({
      next: () => this.loadGroup(group.id),
      error: (err) => {
        this.memberActionError.set(err.error?.detail ?? 'No pudimos dar de baja al integrante.');
      },
    });
  }

  cancelRemoveMember(): void {
    this.removeDialog.set(false);
    this.memberToRemove.set(null);
  }

  openMemberProfile(member: GroupMembership): void {
    this.profileMember.set(member);
    this.loadingProfile.set(true);
    this.auth.getUserById(member.user).subscribe({
      next: (profile) => {
        this.profileMemberUser.set(profile);
        this.loadingProfile.set(false);
      },
      error: () => {
        this.loadingProfile.set(false);
      },
    });
  }

  closeMemberProfile(): void {
    this.profileMember.set(null);
    this.profileMemberUser.set(null);
  }

  /** Iniciales del nombre y apellido (igual que el perfil propio). */
  memberInitials(profile: User): string {
    const source = profile.first_name?.trim() || profile.name?.trim() || '';
    const last = profile.last_name?.trim() ?? '';
    return ((source[0] ?? '?') + (last[0] ?? '')).toUpperCase().slice(0, 2);
  }

  fullName(profile: User): string {
    return [profile.first_name, profile.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  joinedLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  roleLabel(role: GroupRole): string {
    if (role === 'owner') return 'Owner';
    if (role === 'admin') return 'Admin';
    return 'Member';
  }
}
