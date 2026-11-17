from fastapi import APIRouter
from fastapi import WebSocket

from app.auth.dependencies import CurrentUser
from app.realtime.hub import HubDep
from app.realtime.tickets import TicketOut

router = APIRouter(tags=["realtime"])
# The socket itself sits at the root (/ws), outside /api/v1, and authenticates with a ticket.
ws_router = APIRouter()


@router.post("/ws/ticket", status_code=201)
async def issue_ticket(user_id: CurrentUser, hub: HubDep) -> TicketOut:
    return await hub.tickets.issue(user_id)


@ws_router.websocket("/ws")
async def websocket(ws: WebSocket, hub: HubDep) -> None:
    await hub.serve(ws)
