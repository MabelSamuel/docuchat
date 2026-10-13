import { appEvents } from "../lib/events";
import { AUTH_EVENTS } from "../events/auth.events";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import crypto from "crypto";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../lib/tokens";

export async function register(data: {
  name: string;
  email: string;
  password: string;
}) {
  const existing = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase().trim() },
  });
  if (existing) throw new Error("Email already registered");

  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({
    data: {
      name: data.name.trim(),
      email: data.email.toLowerCase().trim(),
      passwordHash,
    },
  });

  // Find the default role
  const defaultRole = await prisma.role.findFirst({
    where: { isDefault: true },
  });

  if (defaultRole) {
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: defaultRole.id,
      },
    });
  }

  // Emit and move on. Don't wait for listeners.
  appEvents.emit(AUTH_EVENTS.USER_REGISTERED, {
    id: user.id,
    email: user.email,
    tier: user.tier,
  });

  return { id: user.id, email: user.email, tier: user.tier };
}

export async function login(data: {
  email: string;
  password: string;
  deviceInfo?: string;
}) {
  const user = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase().trim() },
  });

  if (!user || !user.isActive) {
    // Emit the failure event before throwing
    appEvents.emit(AUTH_EVENTS.LOGIN_FAILED, {
      email: data.email,
      deviceInfo: data.deviceInfo,
      reason: "user_not_found",
    });
    throw new Error("Invalid credentials");
  }

  const valid = await verifyPassword(data.password, user.passwordHash);
  if (!valid) {
    appEvents.emit(AUTH_EVENTS.LOGIN_FAILED, {
      email: data.email,
      deviceInfo: data.deviceInfo,
      reason: "wrong_password",
    });
    throw new Error("Invalid credentials");
  }

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Store the refresh token hash (never store the raw token)
  const tokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");

  // We need a RefreshToken model for this.
  // Add it to your schema if you haven't already.
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Emit success event
  appEvents.emit(AUTH_EVENTS.USER_LOGGED_IN, {
    userId: user.id,
    deviceInfo: data.deviceInfo,
  });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, tier: user.tier },
  };
}

export async function refresh(rawRefreshToken: string) {
  // Verify the JWT signature and expiration
  let payload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw new Error("Invalid refresh token");
  }

  if (payload.type !== "refresh") {
    throw new Error("Invalid token type");
  }

  // Check if this token exists in the database (not revoked)
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawRefreshToken)
    .digest("hex");

  const stored = await prisma.refreshToken.findUnique({
    where: { token: tokenHash },
  });

  if (!stored || stored.expiresAt < new Date()) {
    throw new Error("Refresh token expired or revoked");
  }

  // Get the user
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
  });
  if (!user || !user.isActive) {
    throw new Error("User not found or inactive");
  }

  // Rotate: delete the old token, create a new one
  await prisma.refreshToken.delete({ where: { token: tokenHash } });

  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);
  const newHash = crypto
    .createHash("sha256")
    .update(newRefreshToken)
    .digest("hex");

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: newHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

// ── Logout ────────────────────────────────────────────────

export async function logout(rawRefreshToken: string) {
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawRefreshToken)
    .digest("hex");

  // Delete the token. If it doesn't exist, that's fine.
  await prisma.refreshToken.deleteMany({
    where: { token: tokenHash },
  });
}
