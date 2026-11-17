import type { MigrationInterface, QueryRunner } from "typeorm";

export class Init1794480000000 implements MigrationInterface {
    name = 'Init1794480000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "users" (
                "id" uuid NOT NULL DEFAULT uuidv7(),
                "email" text NOT NULL,
                "password_hash" text NOT NULL,
                "display_name" text NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "users_email_check" CHECK (email = lower(email)),
                CONSTRAINT "users_pkey" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "users_email_key" ON "users" ("email")
        `);
        await queryRunner.query(`
            CREATE TABLE "workspaces" (
                "id" uuid NOT NULL DEFAULT uuidv7(),
                "name" text NOT NULL,
                "slug" text NOT NULL,
                "created_by" uuid NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces" ("slug")
        `);
        await queryRunner.query(`
            CREATE TABLE "activity_events" (
                "id" uuid NOT NULL DEFAULT uuidv7(),
                "workspace_id" uuid NOT NULL,
                "project_id" uuid,
                "task_id" uuid,
                "actor_id" uuid NOT NULL,
                "type" text NOT NULL,
                "data" jsonb NOT NULL DEFAULT '{}',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "activity_task_idx" ON "activity_events" ("task_id", "id")
            WHERE task_id IS NOT NULL
        `);
        await queryRunner.query(`
            CREATE INDEX "activity_project_idx" ON "activity_events" ("project_id", "id")
            WHERE project_id IS NOT NULL
        `);
        await queryRunner.query(`
            CREATE INDEX "activity_workspace_idx" ON "activity_events" ("workspace_id", "id")
        `);
        await queryRunner.query(`
            CREATE TABLE "projects" (
                "id" uuid NOT NULL DEFAULT uuidv7(),
                "workspace_id" uuid NOT NULL,
                "name" text NOT NULL,
                "key" text NOT NULL,
                "description" text,
                "next_task_number" integer NOT NULL DEFAULT '1',
                "created_by" uuid NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "projects_key_check" CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
                CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "projects_workspace_idx" ON "projects" ("workspace_id", "id")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "projects_workspace_id_key_key" ON "projects" ("workspace_id", "key")
        `);
        await queryRunner.query(`
            CREATE TABLE "board_columns" (
                "id" uuid NOT NULL DEFAULT uuidv7(),
                "project_id" uuid NOT NULL,
                "name" text NOT NULL,
                "position" text COLLATE "C" NOT NULL,
                "wip_limit" integer,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "board_columns_wip_limit_check" CHECK (
                    wip_limit BETWEEN 1 AND 999
                ),
                CONSTRAINT "board_columns_pkey" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "board_columns_project_id_position_key" ON "board_columns" ("project_id", "position")
        `);
        await queryRunner.query(`
            INSERT INTO "typeorm_metadata"(
                    "database",
                    "schema",
                    "table",
                    "type",
                    "name",
                    "value"
                )
            VALUES (current_database(), $1, $2, $3, $4, $5)
        `, ["public","tasks","GENERATED_COLUMN","search_vector","setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')"]);
        await queryRunner.query(`
            CREATE TABLE "tasks" (
                "id" uuid NOT NULL DEFAULT uuidv7(),
                "project_id" uuid NOT NULL,
                "column_id" uuid NOT NULL,
                "number" integer NOT NULL,
                "title" text NOT NULL,
                "description" text,
                "priority" text NOT NULL DEFAULT 'medium',
                "assignee_id" uuid,
                "reporter_id" uuid NOT NULL,
                "due_at" TIMESTAMP WITH TIME ZONE,
                "reminder_sent_at" TIMESTAMP WITH TIME ZONE,
                "position" text COLLATE "C" NOT NULL,
                "search_vector" tsvector GENERATED ALWAYS AS (
                    setweight(to_tsvector('english', title), 'A') || setweight(
                        to_tsvector('english', coalesce(description, '')),
                        'B'
                    )
                ) STORED NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "tasks_priority_check" CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
                CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "tasks_due_reminder_idx" ON "tasks" ("due_at")
            WHERE reminder_sent_at IS NULL
                AND assignee_id IS NOT NULL
        `);
        await queryRunner.query(`
            CREATE INDEX "tasks_search_idx" ON "tasks" USING gin ("search_vector")
        `);
        await queryRunner.query(`
            CREATE INDEX "tasks_assignee_idx" ON "tasks" ("assignee_id", "id")
        `);
        await queryRunner.query(`
            CREATE INDEX "tasks_project_idx" ON "tasks" ("project_id", "id")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "tasks_column_id_position_key" ON "tasks" ("column_id", "position")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "tasks_project_id_number_key" ON "tasks" ("project_id", "number")
        `);
        await queryRunner.query(`
            CREATE TABLE "attachments" (
                "id" uuid NOT NULL DEFAULT uuidv7(),
                "task_id" uuid NOT NULL,
                "uploader_id" uuid NOT NULL,
                "file_name" text NOT NULL,
                "content_type" text NOT NULL,
                "size_bytes" bigint NOT NULL,
                "storage_key" text NOT NULL,
                "status" text NOT NULL DEFAULT 'pending',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "attachments_status_check" CHECK (status IN ('pending', 'ready')),
                CONSTRAINT "attachments_size_bytes_check" CHECK (size_bytes > 0),
                CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "attachments_pending_idx" ON "attachments" ("created_at")
            WHERE status = 'pending'
        `);
        await queryRunner.query(`
            CREATE INDEX "attachments_task_idx" ON "attachments" ("task_id", "id")
            WHERE status = 'ready'
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments" ("storage_key")
        `);
        await queryRunner.query(`
            CREATE TABLE "comments" (
                "id" uuid NOT NULL DEFAULT uuidv7(),
                "task_id" uuid NOT NULL,
                "author_id" uuid NOT NULL,
                "body" text NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "comments_task_idx" ON "comments" ("task_id", "id")
        `);
        await queryRunner.query(`
            CREATE TABLE "invitations" (
                "id" uuid NOT NULL DEFAULT uuidv7(),
                "workspace_id" uuid NOT NULL,
                "email" text NOT NULL,
                "role" text NOT NULL,
                "token_hash" text NOT NULL,
                "invited_by" uuid NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "accepted_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "invitations_role_check" CHECK (role IN ('admin', 'member', 'viewer')),
                CONSTRAINT "invitations_email_check" CHECK (email = lower(email)),
                CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "invitations_workspace_idx" ON "invitations" ("workspace_id", "id")
            WHERE accepted_at IS NULL
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "invitations_pending_email_uq" ON "invitations" ("workspace_id", "email")
            WHERE accepted_at IS NULL
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations" ("token_hash")
        `);
        await queryRunner.query(`
            CREATE TABLE "workspace_members" (
                "id" uuid NOT NULL DEFAULT uuidv7(),
                "workspace_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                "role" text NOT NULL,
                "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "workspace_members_role_check" CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
                CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "workspace_members_user_idx" ON "workspace_members" ("user_id", "workspace_id")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members" ("workspace_id", "user_id")
        `);
        await queryRunner.query(`
            ALTER TABLE "workspaces"
            ADD CONSTRAINT "workspaces_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "activity_events"
            ADD CONSTRAINT "activity_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "activity_events"
            ADD CONSTRAINT "activity_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "projects"
            ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "projects"
            ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "board_columns"
            ADD CONSTRAINT "board_columns_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "tasks_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "board_columns"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "tasks_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "attachments"
            ADD CONSTRAINT "attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "attachments"
            ADD CONSTRAINT "attachments_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "comments"
            ADD CONSTRAINT "comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "comments"
            ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "invitations"
            ADD CONSTRAINT "invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "invitations"
            ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "workspace_members"
            ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "workspace_members"
            ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_user_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_workspace_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "invitations" DROP CONSTRAINT "invitations_invited_by_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "invitations" DROP CONSTRAINT "invitations_workspace_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "comments" DROP CONSTRAINT "comments_author_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "comments" DROP CONSTRAINT "comments_task_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "attachments" DROP CONSTRAINT "attachments_uploader_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "attachments" DROP CONSTRAINT "attachments_task_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "tasks_reporter_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "tasks_assignee_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "tasks_column_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "tasks_project_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "board_columns" DROP CONSTRAINT "board_columns_project_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "projects" DROP CONSTRAINT "projects_created_by_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "projects" DROP CONSTRAINT "projects_workspace_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_actor_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_workspace_id_fkey"
        `);
        await queryRunner.query(`
            ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_created_by_fkey"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."workspace_members_workspace_id_user_id_key"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."workspace_members_user_idx"
        `);
        await queryRunner.query(`
            DROP TABLE "workspace_members"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."invitations_token_hash_key"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."invitations_pending_email_uq"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."invitations_workspace_idx"
        `);
        await queryRunner.query(`
            DROP TABLE "invitations"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."comments_task_idx"
        `);
        await queryRunner.query(`
            DROP TABLE "comments"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."attachments_storage_key_key"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."attachments_task_idx"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."attachments_pending_idx"
        `);
        await queryRunner.query(`
            DROP TABLE "attachments"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."tasks_project_id_number_key"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."tasks_column_id_position_key"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."tasks_project_idx"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."tasks_assignee_idx"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."tasks_search_idx"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."tasks_due_reminder_idx"
        `);
        await queryRunner.query(`
            DROP TABLE "tasks"
        `);
        await queryRunner.query(`
            DELETE FROM "typeorm_metadata"
            WHERE "type" = $1
                AND "name" = $2
                AND "database" = current_database()
                AND "schema" = $3
                AND "table" = $4
        `, ["GENERATED_COLUMN","search_vector","public","tasks"]);
        await queryRunner.query(`
            DROP INDEX "public"."board_columns_project_id_position_key"
        `);
        await queryRunner.query(`
            DROP TABLE "board_columns"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."projects_workspace_id_key_key"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."projects_workspace_idx"
        `);
        await queryRunner.query(`
            DROP TABLE "projects"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."activity_workspace_idx"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."activity_project_idx"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."activity_task_idx"
        `);
        await queryRunner.query(`
            DROP TABLE "activity_events"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."workspaces_slug_key"
        `);
        await queryRunner.query(`
            DROP TABLE "workspaces"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."users_email_key"
        `);
        await queryRunner.query(`
            DROP TABLE "users"
        `);
    }

}
