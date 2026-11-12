# Authentication Configuration for bookrecs.dev

## Overview
Updated the authentication system to properly support the custom domain `bookrecs.dev` while maintaining compatibility with localhost development.

## Changes Made

### Cookie Configuration (`src/api.ts`)
Modified the `setSessionCookie` function to dynamically set cookie attributes based on the request:

```typescript
function setSessionCookie(token: string, req: Request): string {
  const host = req.headers.get("host") || "localhost";
  const protocol = req.headers.get("x-forwarded-proto") || "http";
  const isSecure = protocol === "https" || host.includes("bookrecs.dev");
  
  const secureFlag = isSecure ? "Secure; " : "";
  const domain = host.includes("bookrecs.dev") ? "; Domain=bookrecs.dev" : "";
  
  return `${SESSION_COOKIE}=${token}; HttpOnly; ${secureFlag}Path=/${domain}; SameSite=None; Max-Age=${SESSION_TTL}`;
}
```

### Key Changes

1. **Dynamic Domain Setting**
   - For `bookrecs.dev`: Sets `Domain=bookrecs.dev` to allow cookies across subdomains
   - For `localhost`: Omits Domain attribute (cookies scoped to exact host)

2. **Dynamic Secure Flag**
   - Enabled for HTTPS connections
   - Enabled when host contains `bookrecs.dev`
   - Disabled for HTTP localhost

3. **SameSite=None**
   - Required for cross-site cookie handling
   - Necessary when using cloudflared tunnel with custom domain
   - Must be paired with Secure flag

4. **Function Signature Updates**
   - Updated all `setSessionCookie` calls to accept `Request` parameter
   - Updated `handleSignup` to accept and pass `Request` object
   - Ensures proper header inspection for domain detection

## Cookie Behavior

### For bookrecs.dev
```
session=<token>; HttpOnly; Secure; Path=/; Domain=bookrecs.dev; SameSite=None; Max-Age=2592000
```
- ✅ Secure flag enabled (HTTPS)
- ✅ Domain set to bookrecs.dev
- ✅ SameSite=None for cross-site support
- ✅ Works with cloudflared tunnel

### For localhost
```
session=<token>; HttpOnly; Path=/; SameSite=None; Max-Age=2592000
```
- ❌ No Secure flag (HTTP)
- ❌ No Domain attribute (scoped to localhost)
- ✅ SameSite=None for consistency
- ✅ Works for local development

## Testing

### Test bookrecs.dev Cookie
```bash
curl -s -i http://localhost:3000/api/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"testpass123"}' \
  -H "Host: bookrecs.dev" | grep -i set-cookie
```

Expected output:
```
set-cookie: session=<token>; HttpOnly; Secure; Path=/; Domain=bookrecs.dev; SameSite=None; Max-Age=2592000
```

### Test localhost Cookie
```bash
curl -s -i http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"usernameOrEmail":"testuser","password":"testpass123"}' \
  -H "Host: localhost:3000" | grep -i set-cookie
```

Expected output:
```
set-cookie: session=<token>; HttpOnly; Path=/; SameSite=None; Max-Age=2592000
```

## Security Considerations

1. **SameSite=None**
   - Required for custom domains behind cloudflared
   - Must be paired with Secure flag in production
   - Allows cross-site requests (necessary for tunnel)

2. **Domain Scope**
   - bookrecs.dev domain allows subdomain sharing
   - Localhost scoped to exact host only
   - Prevents cookie leakage between environments

3. **HttpOnly**
   - Prevents JavaScript access to session cookie
   - Mitigates XSS attacks

4. **Secure Flag**
   - Ensures cookies only sent over HTTPS
   - Automatically enabled for bookrecs.dev
   - Disabled for HTTP localhost development

## Deployment Notes

### Server Configuration
- Server listens on `0.0.0.0:3000`
- Cloudflared tunnel handles HTTPS termination
- X-Forwarded-Proto header indicates original protocol

### Cloudflare Tunnel
- Handles SSL/TLS for bookrecs.dev
- Forwards requests to localhost:3000
- Sets X-Forwarded-Proto and X-Forwarded-For headers

### Environment Variables
No new environment variables required. The system automatically detects the domain from request headers.

## Browser Compatibility

### Modern Browsers (Chrome, Firefox, Safari, Edge)
- ✅ Full support for SameSite=None
- ✅ Secure cookies over HTTPS
- ✅ Domain-scoped cookies

### Mobile Browsers
- ✅ iOS Safari: Full support
- ✅ Android Chrome: Full support
- ✅ Samsung Internet: Full support

## Troubleshooting

### Cookie Not Set in Browser
1. Check browser console for cookie warnings
2. Verify HTTPS is being used (not HTTP)
3. Check cloudflared tunnel is running
4. Verify X-Forwarded-Proto header is set to "https"

### Authentication Not Persisting
1. Check cookie is being stored (DevTools > Application > Cookies)
2. Verify Domain matches current site
3. Check Secure flag is set for HTTPS
4. Verify SameSite=None is present

### Cross-Domain Issues
1. Ensure Domain=bookrecs.dev is set
2. Verify cloudflared is properly configured
3. Check CORS headers if making API calls from different origin
4. Verify SameSite=None is present

## Future Enhancements

1. **Subdomain Support**
   - Currently supports bookrecs.dev exactly
   - Could add support for subdomains (e.g., api.bookrecs.dev)
   - Would require wildcard domain configuration

2. **Environment Detection**
   - Could add explicit environment configuration
   - Allow override via environment variables
   - Support multiple custom domains

3. **Cookie Rotation**
   - Implement cookie token rotation
   - Add refresh token mechanism
   - Improve security for long-lived sessions

## References

- [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)
- [MDN: SameSite cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite)
- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
