"""Optional managed-host authentication. The browser launcher keeps its existing mode."""

import hmac

from starlette.responses import JSONResponse


class SessionAuthMiddleware:
    def __init__(self, app, *, token: str, allowed_origins: list[str]):
        self.app = app
        self.authorization = f"Bearer {token}".encode("ascii")
        self.allowed_origins = {origin.encode("ascii") for origin in allowed_origins}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        origin = headers.get(b"origin")
        if origin and origin not in self.allowed_origins:
            await JSONResponse({"detail": "Origin is not allowed."}, status_code=403)(scope, receive, send)
            return
        if not hmac.compare_digest(headers.get(b"authorization", b""), self.authorization):
            await JSONResponse({"detail": "A valid application session is required."}, status_code=401)(scope, receive, send)
            return
        await self.app(scope, receive, send)
