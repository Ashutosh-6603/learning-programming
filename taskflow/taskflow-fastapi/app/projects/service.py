from collections import defaultdict
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.core.fractional_index import key_between
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import conflict
from app.db.errors import is_unique_violation
from app.deps import JobsDep
from app.deps import SessionDep
from app.models.project import BoardColumn
from app.models.project import Project
from app.models.task import Task
from app.projects.board_cache import BoardCacheDep
from app.projects.schemas import BoardColumnOut
from app.projects.schemas import BoardOut
from app.projects.schemas import ColumnOut
from app.projects.schemas import CreateProjectIn
from app.projects.schemas import ProjectOut
from app.projects.schemas import TaskOut
from app.projects.schemas import UpdateProjectIn
from app.projects.schemas import task_relations

DEFAULT_COLUMNS = ["To Do", "In Progress", "Done"]


class ProjectsService:
    def __init__(
        self,
        session: SessionDep,
        access: AccessDep,
        activity: ActivityDep,
        cache: BoardCacheDep,
        jobs: JobsDep,
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.cache = cache
        self.jobs = jobs

    async def list(self, workspace_id: UUID, user_id: UUID, page: PageQuery) -> Page[ProjectOut]:
        await self.access.member(workspace_id, user_id)
        query = select(Project).where(Project.workspace_id == workspace_id)
        query = keyset(query, Project.id, descending=True, limit=page.limit, after=after_id(page))
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, page.limit, ProjectOut.of, lambda p: {"id": str(p.id)})

    async def create(self, workspace_id: UUID, user_id: UUID, body: CreateProjectIn) -> ProjectOut:
        await self.access.member(workspace_id, user_id, "admin")
        project = Project(
            workspace_id=workspace_id,
            name=body.name,
            key=body.key,
            description=body.description,
            created_by=user_id,
        )
        try:
            self.session.add(project)
            await self.session.flush()
            position = None
            for name in DEFAULT_COLUMNS:
                position = key_between(position, None)
                self.session.add(BoardColumn(project_id=project.id, name=name, position=position))
            self.activity.record(
                workspace_id=workspace_id,
                actor_id=user_id,
                project_id=project.id,
                type="project.created",
                data={"name": project.name, "key": project.key},
            )
            await self.session.commit()
        except IntegrityError as err:
            if is_unique_violation(err):
                raise conflict("Project key is already used in this workspace") from err
            raise
        return ProjectOut.of(project)

    async def get(self, project_id: UUID, user_id: UUID) -> ProjectOut:
        project, _ = await self.access.project(project_id, user_id)
        return ProjectOut.of(project)

    async def update(self, project_id: UUID, user_id: UUID, body: UpdateProjectIn) -> ProjectOut:
        project, _ = await self.access.project(project_id, user_id, "admin")
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(project, field, value)
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project_id,
            type="project.updated",
            data=body.model_dump(mode="json", by_alias=True, exclude_unset=True),
        )
        await self.session.commit()
        await self.cache.invalidate(project_id)
        return ProjectOut.of(project)

    async def delete(self, project_id: UUID, user_id: UUID) -> None:
        project, _ = await self.access.project(project_id, user_id, "admin")
        await self.session.execute(delete(Project).where(Project.id == project_id))
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project_id,
            type="project.deleted",
            data={"name": project.name, "key": project.key},
        )
        await self.session.commit()
        await self.cache.invalidate(project_id)
        await self.jobs.delete_storage_prefix(f"projects/{project_id}/")

    async def board(self, project_id: UUID, user_id: UUID) -> BoardOut:
        project, _ = await self.access.project(project_id, user_id)

        async def load() -> BoardOut:
            # Two queries, one after the other: a session runs one statement at a time.
            columns = await self.session.scalars(
                select(BoardColumn)
                .where(BoardColumn.project_id == project_id)
                .order_by(BoardColumn.position)
            )
            tasks = await self.session.scalars(
                select(Task)
                .options(*task_relations())
                .where(Task.project_id == project_id)
                .order_by(Task.position)
            )
            by_column: defaultdict[UUID, list[TaskOut]] = defaultdict(list)
            for task in tasks:
                by_column[task.column_id].append(TaskOut.of(task))
            return BoardOut(
                project=ProjectOut.of(project),
                columns=[
                    BoardColumnOut(**ColumnOut.of(c).model_dump(), tasks=by_column[c.id])
                    for c in columns
                ],
            )

        return await self.cache.get_or_load(project_id, load)


ProjectsServiceDep = Annotated[ProjectsService, Depends()]
