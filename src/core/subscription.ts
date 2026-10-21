import {
  accessTokenFromSecret,
  blobFromSecret,
  credentialsDocument,
  fetchClaudeProfile,
  isAccessExpired,
  refreshClaudeOauth,
  usageRequest,
  type ClaudeOauthBlob,
  type HttpClient,
} from "./oauth-claude.js";

export interface SubscriptionPoll {
  /** Access token to show as current. Null when the secret was empty. */
  accessToken: string | null;
  /** Present when the secret was a credentials document. */
  blob: ClaudeOauthBlob | null;
  /** True when the refresh grant returned a new access token. */
  rotated: boolean;
  /** The refresh lineage is dead. The user has to sign in again. */
  dead: boolean;
  /** Credentials JSON to write back. Set only when rotated and the caller owns the blob. */
  stored?: string;
  usageStatus: number | null;
  usageBody: string | null;
  error?: "transient" | "invalid_grant" | "invalid_client" | "no_refresh_token";
}

/**
 * Refresh a Claude subscription blob when it is near expiry, then read the
 * usage endpoint. A login Claude Code currently has on disk is never
 * refreshed: rotating it would invalidate the official client.
 */
export async function pollClaudeSubscription(
  secret: string,
  http: HttpClient,
  ownsDisk: boolean,
  now = Date.now(),
): Promise<SubscriptionPoll> {
  let blob = blobFromSecret(secret);
  if (!blob) return { accessToken: null, blob: null, rotated: false, dead: false, usageStatus: null, usageBody: null };
  let rotated = false;
  let dead = false;
  let error: SubscriptionPoll["error"];
  if (!ownsDisk && blob.refreshToken && isAccessExpired(blob.expiresAt, now)) {
    const refreshed = await refreshClaudeOauth(blob, http, now);
    if (refreshed.blob) {
      blob = refreshed.blob;
      rotated = true;
    } else if (refreshed.error === "invalid_grant") {
      dead = true;
      error = refreshed.error;
    } else if (refreshed.error) {
      error = refreshed.error;
    }
  }
  const accessToken = blob.accessToken || accessTokenFromSecret(secret);
  if (!accessToken || dead) {
    return { accessToken, blob, rotated, dead, usageStatus: null, usageBody: null, error, stored: rotated ? credentialsDocument(blob) : undefined };
  }
  try {
    const response = await http(usageRequest(accessToken));
    const profile = blob.email && blob.accountUuid ? null : await fetchClaudeProfile(accessToken, http);
    let profileTouched = false;
    if (profile) {
      blob = {
        ...blob,
        email: blob.email ?? profile.email,
        accountUuid: blob.accountUuid ?? profile.accountUuid,
        organizationUuid: blob.organizationUuid ?? profile.organizationUuid,
      };
      profileTouched = secret.trim().startsWith("{");
    }
    return {
      accessToken,
      blob,
      rotated,
      dead,
      stored: rotated || profileTouched ? credentialsDocument(blob) : undefined,
      usageStatus: response.status,
      usageBody: response.body,
      error,
    };
  } catch {
    return {
      accessToken,
      blob,
      rotated,
      dead,
      stored: rotated ? credentialsDocument(blob) : undefined,
      usageStatus: null,
      usageBody: null,
      error: error ?? "transient",
    };
  }
}
