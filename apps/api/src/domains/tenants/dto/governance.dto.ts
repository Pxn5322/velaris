/**
 * Request bodies for the governance routes (AC-F03-1, AC-F03-2).
 *
 * No class-validator decorators exist in this repository: adding it would
 * be a new runtime dependency and needs a D-xx decision first. Field
 * presence and value checks therefore live in GovernanceService and run
 * before any write.
 */

export class CreateTenantDto {
  enterpriseOrganizationId!: string;
  name!: string;
  slug!: string;
}

export class SetTenantStatusDto {
  status!: 'ACTIVE' | 'SUSPENDED';
}

export class SetMembershipRoleDto {
  roleCode!: string;
}
