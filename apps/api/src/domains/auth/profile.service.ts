/**
 * Self-service profile updates for the signed-in caller.
 *
 * A user may change only their own display name and photo. The identity is
 * always the token-verified subject, never a client-supplied user id. The
 * photo arrives as a browser-compressed data URL because this deployment has
 * no object-storage binding; the service revalidates the MIME type, base64
 * payload and magic bytes, and caps the decoded size before writing. The API
 * never accepts a remote URL here, so the UI cannot be turned into a URL
 * loader for third-party content.
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { AuthenticatedIdentity } from './auth.interface.js';

export interface UpdateProfileInput {
  displayName?: string;
  /** Data URL, or null to remove the uploaded photo. */
  avatarDataUrl?: string | null;
}

export interface StoredProfile {
  displayName: string;
  /** Null when the caller has no uploaded photo override. */
  avatarDataUrl: string | null;
  /** True when an explicit remove/upload decision is stored. */
  hasAvatarOverride: boolean;
}

export interface ProfileView {
  displayName: string;
  avatarUrl: string | null;
}

const DISPLAY_NAME_MAX = 80;
const AVATAR_MAX_BYTES = 512 * 1024;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

const MAGIC: Record<string, (bytes: Buffer) => boolean> = {
  png: (bytes) =>
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  jpeg: (bytes) =>
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff,
  webp: (bytes) =>
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP',
};

@Injectable()
export class ProfileService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /** Database profile for an already verified identity, or null. */
  async findForIdentity(
    identity: AuthenticatedIdentity,
  ): Promise<StoredProfile | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        provider_externalSubject: {
          provider: identity.provider,
          externalSubject: identity.subject,
        },
      },
      select: { displayName: true, avatarDataUrl: true },
    });
    if (!user) return null;
    return {
      displayName: user.displayName,
      avatarDataUrl: user.avatarDataUrl || null,
      hasAvatarOverride: user.avatarDataUrl !== null,
    };
  }

  /** Update the caller's own profile fields. */
  async update(
    identity: AuthenticatedIdentity,
    input: UpdateProfileInput,
  ): Promise<ProfileView> {
    if (input.displayName === undefined && input.avatarDataUrl === undefined) {
      throw new BadRequestException('displayName or avatarDataUrl is required');
    }

    const displayName =
      input.displayName === undefined
        ? undefined
        : normalizeDisplayName(input.displayName);
    const avatarDataUrl =
      input.avatarDataUrl === undefined
        ? undefined
        : normalizeAvatar(input.avatarDataUrl);

    const user = await this.prisma.user.findUnique({
      where: {
        provider_externalSubject: {
          provider: identity.provider,
          externalSubject: identity.subject,
        },
      },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('No application profile exists yet');
    }

    const saved = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(displayName === undefined ? {} : { displayName }),
        ...(avatarDataUrl === undefined
          ? {}
          : { avatarDataUrl: avatarDataUrl ?? '' }),
      },
      select: { displayName: true, avatarDataUrl: true },
    });

    return {
      displayName: saved.displayName,
      avatarUrl: saved.avatarDataUrl || null,
    };
  }
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('displayName must be text');
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > DISPLAY_NAME_MAX) {
    throw new BadRequestException(
      `displayName must be between 2 and ${DISPLAY_NAME_MAX} characters`,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new BadRequestException('displayName contains control characters');
  }
  return name;
}

function normalizeAvatar(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('avatarDataUrl must be text or null');
  }
  const match = DATA_URL.exec(value);
  if (!match) {
    throw new BadRequestException('Upload a PNG, JPEG or WebP image');
  }
  const [, format, base64] = match;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) {
    throw new BadRequestException(
      `The profile photo must be smaller than ${Math.round(
        AVATAR_MAX_BYTES / 1024,
      )} KB`,
    );
  }
  if (!MAGIC[format](bytes)) {
    throw new BadRequestException('The uploaded file is not a valid image');
  }
  return value;
}
