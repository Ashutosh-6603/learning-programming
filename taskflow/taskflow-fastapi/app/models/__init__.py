"""Every model, imported once, so `Base.metadata` knows all tables (Alembic reads it)."""

from app.models.activity import ActivityEvent
from app.models.project import BoardColumn
from app.models.project import Project
from app.models.task import Attachment
from app.models.task import Comment
from app.models.task import Task
from app.models.user import User
from app.models.workspace import Invitation
from app.models.workspace import Workspace
from app.models.workspace import WorkspaceMember

__all__ = [
    "ActivityEvent",
    "Attachment",
    "BoardColumn",
    "Comment",
    "Invitation",
    "Project",
    "Task",
    "User",
    "Workspace",
    "WorkspaceMember",
]
