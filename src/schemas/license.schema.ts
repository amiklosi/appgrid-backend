import { Static, Type } from '@sinclair/typebox';

// License status enum
export const LicenseStatusSchema = Type.Union([
  Type.Literal('ACTIVE'),
  Type.Literal('EXPIRED'),
  Type.Literal('REVOKED'),
  Type.Literal('SUSPENDED'),
]);

// Create license request
export const CreateLicenseSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
  maxActivations: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
  notes: Type.Optional(Type.String()),
});

export type CreateLicenseDTO = Static<typeof CreateLicenseSchema>;

// Validate license request
export const ValidateLicenseSchema = Type.Object({
  licenseKey: Type.String({ minLength: 1 }),
  deviceFingerprint: Type.Optional(Type.String()),
});

export type ValidateLicenseDTO = Static<typeof ValidateLicenseSchema>;

// Deactivate license request
export const DeactivateLicenseSchema = Type.Object({
  licenseKey: Type.String({ minLength: 1 }),
  deviceFingerprint: Type.String({ minLength: 1 }),
});

export type DeactivateLicenseDTO = Static<typeof DeactivateLicenseSchema>;

// Deactivation response
export const DeactivationResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.String(),
  currentActivations: Type.Optional(Type.Integer()),
});

// Update license request
export const UpdateLicenseSchema = Type.Object({
  status: Type.Optional(LicenseStatusSchema),
  expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
  maxActivations: Type.Optional(Type.Integer({ minimum: 1 })),
  notes: Type.Optional(Type.String()),
});

export type UpdateLicenseDTO = Static<typeof UpdateLicenseSchema>;

// License response
export const LicenseResponseSchema = Type.Object({
  id: Type.String(),
  userId: Type.String(),
  licenseKey: Type.String(),
  status: LicenseStatusSchema,
  issuedAt: Type.String(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  activatedAt: Type.Union([Type.String(), Type.Null()]),
  revokedAt: Type.Union([Type.String(), Type.Null()]),
  maxActivations: Type.Integer(),
  metadata: Type.Union([Type.Record(Type.String(), Type.Any()), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

// Validation response
export const ValidationResponseSchema = Type.Object({
  valid: Type.Boolean(),
  license: Type.Optional(LicenseResponseSchema),
  message: Type.String(),
});
