# Security Improvements

This document describes the security enhancements implemented for the BookRecs application.

## 1. Session Token Encryption

### Overview
All session tokens are now encrypted before being stored in the database using AES-256-GCM encryption.

### Implementation
- **Encryption Key**: Stored in `BOOKRECS_ENCRYPTION_KEY` environment variable (32 bytes / 64 hex characters)
- **Algorithm**: AES-256-GCM (authenticated encryption)
- **IV Length**: 12 bytes (96 bits, recommended for GCM)
- **Authentication Tag**: 16 bytes (128 bits)
- **Format**: `iv:authTag:encryptedData` (hex-encoded)

### Migration
The system supports both encrypted and plaintext tokens during migration:
1. New sessions are stored encrypted
2. Login validation checks for encrypted tokens first, then falls back to plaintext
3. Old plaintext tokens continue to work until they expire or are used

### Security Benefits
- If database is compromised, session tokens cannot be used without the encryption key
- Authentication tag prevents tampering with encrypted tokens
- Unique IV for each token prevents pattern analysis

## 2. Two-Factor Authentication (2FA)

### Overview
Users can now enable TOTP-based two-factor authentication using authenticator apps like Google Authenticator, Authy, or 1Password.

### Implementation
- **Algorithm**: TOTP (Time-based One-Time Password) per RFC 6238
- **Secret Size**: 20 bytes (160 bits)
- **Token Length**: 6 digits
- **Time Window**: 30 seconds with 1 period drift tolerance
- **QR Code**: Standard `otpauth://` URI for easy setup

### Setup Flow
1. User requests 2FA setup via `/api/2fa/setup`
2. System generates secret and returns TOTP URI
3. User scans QR code or enters secret manually in authenticator app
4. User verifies with 6-digit token via `/api/2fa/verify`
5. 2FA is enabled for the account

### Login Flow with 2FA
1. User submits username/email and password to `/api/login`
2. If password is correct and 2FA is enabled:
   - System returns `{ requires2FA: true, pendingToken: "..." }`
   - No session is created yet
   - Pending token is valid for 5 minutes
3. User submits 6-digit TOTP token and pending token to `/api/2fa/login`
4. System verifies TOTP token:
   - If valid: creates session and returns user data with session cookie
   - If invalid: returns error, pending token remains valid for retry

### API Endpoints
- `POST /api/2fa/setup` - Generate 2FA secret and QR code URI
- `POST /api/2fa/verify` - Verify TOTP token and enable 2FA
- `POST /api/2fa/disable` - Disable 2FA for the account
- `GET /api/2fa/status` - Check if 2FA is enabled
- `POST /api/2fa/login` - Complete login with 2FA token

### Security Benefits
- Protection against credential stuffing and password theft
- Even if password is compromised, attacker cannot access account without TOTP
- Pending login tokens expire after 5 minutes, limiting attack window
- Rate limiting still applies to initial password verification

## 3. Previous Improvements (Already Implemented)

### Secure Cookie Flag
- Session cookies now include the `Secure` flag
- Cookies are only sent over HTTPS connections
- Prevents session hijacking via unencrypted connections

### Rate Limiting
- Login attempts are rate-limited to 5 attempts per IP + username combination
- 15-minute lockout window
- Prevents brute force attacks
- Successful login clears the rate limit counter

## Configuration

### Environment Variables
```bash
# Required for session token encryption
BOOKRECS_ENCRYPTION_KEY=ffe86ad4ed6d27a0a2d00935d1aec56ad38403aee88eca23c5f17b2ed07a7031

# Generate a new key with:
openssl rand -hex 32
```

### Database Schema Changes
```sql
-- Added to users table
ALTER TABLE users ADD COLUMN "2fa_secret" TEXT;
ALTER TABLE users ADD COLUMN "2fa_enabled" INTEGER DEFAULT 0;

-- New table for pending 2FA logins
CREATE TABLE pending_logins (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

## Testing

### Test 2FA Setup
```bash
# 1. Create a test user and login
# 2. Call POST /api/2fa/setup
# 3. Scan the returned URI with an authenticator app
# 4. Call POST /api/2fa/verify with the 6-digit token
# 5. Logout and try logging in again
# 6. You should receive { requires2FA: true, pendingToken: "..." }
# 7. Call POST /api/2fa/login with pendingToken and TOTP token
# 8. You should receive your session cookie
```

### Test Session Encryption
```bash
# 1. Login and get a session token from the cookie
# 2. Check the database: SELECT token FROM sessions;
# 3. Token should be in format: "hex:hex:hex" (not plaintext)
```

## Security Considerations

### Key Management
- The encryption key must be kept secure
- If the key is lost, all existing sessions become invalid
- Consider using a key management service for production deployments
- Rotate keys periodically by re-encrypting all sessions

### 2FA Recovery
- Currently no recovery mechanism if user loses access to their authenticator
- Future enhancement: add backup codes or email-based recovery
- For now, users can be manually reset by an admin via direct database access

### Rate Limiting Bypass
- Rate limiting is per IP + username, so distributed attacks from many IPs are not fully mitigated
- Consider adding CAPTCHA after 3 failed attempts
- Consider adding account lockout after 10 failed attempts across all IPs

## Future Enhancements

1. **Backup Codes**: Generate single-use backup codes for 2FA recovery
2. **Email Recovery**: Allow 2FA reset via email verification
3. **Session Management**: View and revoke active sessions
4. **Audit Logging**: Track security events (login attempts, 2FA changes, etc.)
5. **Key Rotation**: Automated session re-encryption with new keys
6. **Hardware Keys**: Add WebAuthn/FIDO2 support for hardware security keys
