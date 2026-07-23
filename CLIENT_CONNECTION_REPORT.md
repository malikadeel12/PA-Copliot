# PA Copilot — Connection Issue

## Finding

Google login succeeds, but the client receives:

```text
GET https://pa-copilot.onrender.com/api/auth/me
net::ERR_CONNECTION_RESET
```

This is not an application-code or authentication error. It means the network connection to the Render backend is being closed before the request reaches our application.

The same login and new-account flow has been tested successfully multiple times from our side without errors. The issue appears specific to the client’s network route, ISP, VPN, firewall, proxy, or security software.

## Client check

1. Open:

   ```text
   https://pa-copilot.onrender.com/api/health
   ```

2. Test once with VPN off.
3. Test in Chrome Incognito.
4. Test using a mobile hotspot.
5. Send us a screenshot showing whether the health URL opens.

If the health URL also shows a connection reset, it confirms a network-to-Render connectivity issue rather than a code issue.

## Solution

Temporary solution:

- Turn off VPN/proxy/security filtering.
- Try Chrome Incognito.
- Use a mobile hotspot or another internet connection.

Permanent solution implemented:

```text
Client browser → Vercel frontend → Render backend
```

Backend API requests are now proxied through the Vercel domain. After the
updated frontend is deployed, the client will connect only to
`pa-copliot-gamma.vercel.app`, avoiding direct browser access to the
blocked/reset `onrender.com` connection.
