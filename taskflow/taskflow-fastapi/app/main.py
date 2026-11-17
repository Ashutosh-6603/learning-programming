from collections.abc import AsyncIterator
from contextlib import AsyncExitStack
from contextlib import asynccontextmanager

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.activity.router import router as activity_router
from app.attachments.router import router as attachments_router
from app.auth.dependencies import limit_api
from app.auth.router import router as auth_router
from app.comments.router import router as comments_router
from app.config import Settings
from app.config import get_settings
from app.core.errors import add_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import BodyGuardMiddleware
from app.core.middleware import RequestContextMiddleware
from app.health.router import router as health_router
from app.infra.resources import open_resources
from app.projects.router import router as projects_router
from app.realtime.hub import running_hub
from app.realtime.router import router as realtime_router
from app.realtime.router import ws_router
from app.search.router import router as search_router
from app.tasks.router import router as tasks_router
from app.users.router import router as users_router
from app.workspaces.router import router as workspaces_router

API_PREFIX = "/api/v1"


def create_app(settings: Settings | None = None) -> FastAPI:
    """Builds a complete, independent app. main.py's `app` is one; each test can make its own."""
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Code before `yield` runs at startup, code after it at shutdown. The exit stack closes
        # what was opened, in reverse order, even if startup fails halfway.
        async with AsyncExitStack() as stack:
            resources = await stack.enter_async_context(open_resources(settings))
            app.state.resources = resources
            app.state.hub = await stack.enter_async_context(running_hub(resources))
            yield

    docs = settings.app_env != "production"
    app = FastAPI(
        title="TaskFlow API (FastAPI)",
        description="Generated from code. The contract lives in contract/openapi.yaml.",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
    )
    add_exception_handlers(app)
    # The last middleware added runs first: request context → CORS → body guard → routes.
    app.add_middleware(BodyGuardMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id", "Retry-After"],
        max_age=600,
    )
    app.add_middleware(RequestContextMiddleware)

    app.include_router(health_router)
    # Secure by default: every router included here needs an access token, and is rate limited
    # per user. Only routers included straight into `api` (auth) are public.
    protected = APIRouter(dependencies=[Depends(limit_api)])
    protected.include_router(users_router)
    protected.include_router(workspaces_router)
    protected.include_router(projects_router)
    protected.include_router(tasks_router)
    protected.include_router(comments_router)
    protected.include_router(activity_router)
    protected.include_router(search_router)
    protected.include_router(attachments_router)
    protected.include_router(realtime_router)
    api = APIRouter(prefix=API_PREFIX)
    api.include_router(auth_router)
    api.include_router(protected)
    app.include_router(api)
    app.include_router(ws_router)
    return app


app = create_app()
