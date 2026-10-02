-- Das interne Arbeitsmodul des Teams: Projekte, Aufgaben, Planung.
--
-- Rein additiv: elf neue Tabellen und fuenf neue Enums, keine bestehende
-- Spalte wird angefasst. Ein Rollback bedeutet deshalb, die neuen Tabellen
-- wieder fallen zu lassen - an den Daten der uebrigen Module aendert diese
-- Migration nichts.
--
-- Die Indizes sind die, nach denen das Modul wirklich fragt: «meine Aufgaben»
-- (Assignee), das Board (Projekt + Status), die Planung und die Reminder
-- (Faelligkeit), das Archiv (archivedAt). Keine Indizes auf Verdacht.

-- CreateEnum
CREATE TYPE "WorkspaceProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkspaceTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkspacePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "WorkspaceMemberRole" AS ENUM ('LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "WorkspaceReminder" AS ENUM ('NONE', 'ON_DUE_DATE', 'ONE_DAY', 'THREE_DAYS', 'ONE_WEEK');

-- CreateTable
CREATE TABLE "WorkspaceProject" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkspaceProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "priority" "WorkspacePriority",
    "accent" TEXT,
    "startAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedModuleId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedByDiscordId" TEXT,
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "rolle" "WorkspaceMemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceTask" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "projectId" TEXT,
    "status" "WorkspaceTaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "WorkspacePriority" NOT NULL DEFAULT 'NORMAL',
    "startAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reminder" "WorkspaceReminder" NOT NULL DEFAULT 'NONE',
    "reminderSentAt" TIMESTAMP(3),
    "linkedModuleId" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceTaskAssignee" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceTaskAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceChecklistItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "erledigt" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorDiscordId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "erledigt" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceAttachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "fileName" TEXT NOT NULL,
    "anzeigeName" TEXT NOT NULL,
    "mimeTyp" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "uploadedByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceActivity" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "art" TEXT NOT NULL,
    "detail" TEXT,
    "actorDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceTemplate" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "projectTitle" TEXT NOT NULL,
    "accent" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archivedAt" TIMESTAMP(3),
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceTemplateTask" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "WorkspacePriority" NOT NULL DEFAULT 'NORMAL',
    "position" INTEGER NOT NULL,
    "faelligNachTagen" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceTemplateTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceProject_guildId_archivedAt_updatedAt_idx" ON "WorkspaceProject"("guildId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkspaceProject_guildId_status_idx" ON "WorkspaceProject"("guildId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceProjectMember_discordId_idx" ON "WorkspaceProjectMember"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceProjectMember_projectId_discordId_key" ON "WorkspaceProjectMember"("projectId", "discordId");

-- CreateIndex
CREATE INDEX "WorkspaceTask_guildId_status_idx" ON "WorkspaceTask"("guildId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceTask_projectId_status_idx" ON "WorkspaceTask"("projectId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceTask_guildId_dueAt_idx" ON "WorkspaceTask"("guildId", "dueAt");

-- CreateIndex
CREATE INDEX "WorkspaceTask_status_reminder_dueAt_idx" ON "WorkspaceTask"("status", "reminder", "dueAt");

-- CreateIndex
CREATE INDEX "WorkspaceTask_guildId_updatedAt_idx" ON "WorkspaceTask"("guildId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkspaceTaskAssignee_discordId_idx" ON "WorkspaceTaskAssignee"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceTaskAssignee_taskId_discordId_key" ON "WorkspaceTaskAssignee"("taskId", "discordId");

-- CreateIndex
CREATE INDEX "WorkspaceChecklistItem_taskId_position_idx" ON "WorkspaceChecklistItem"("taskId", "position");

-- CreateIndex
CREATE INDEX "WorkspaceComment_taskId_createdAt_idx" ON "WorkspaceComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceMilestone_projectId_dueAt_idx" ON "WorkspaceMilestone"("projectId", "dueAt");

-- CreateIndex
CREATE INDEX "WorkspaceLink_projectId_idx" ON "WorkspaceLink"("projectId");

-- CreateIndex
CREATE INDEX "WorkspaceLink_taskId_idx" ON "WorkspaceLink"("taskId");

-- CreateIndex
CREATE INDEX "WorkspaceAttachment_projectId_idx" ON "WorkspaceAttachment"("projectId");

-- CreateIndex
CREATE INDEX "WorkspaceAttachment_taskId_idx" ON "WorkspaceAttachment"("taskId");

-- CreateIndex
CREATE INDEX "WorkspaceActivity_taskId_createdAt_idx" ON "WorkspaceActivity"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceActivity_projectId_createdAt_idx" ON "WorkspaceActivity"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceActivity_guildId_createdAt_idx" ON "WorkspaceActivity"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceTemplate_guildId_archivedAt_idx" ON "WorkspaceTemplate"("guildId", "archivedAt");

-- CreateIndex
CREATE INDEX "WorkspaceTemplateTask_templateId_position_idx" ON "WorkspaceTemplateTask"("templateId", "position");

-- AddForeignKey
ALTER TABLE "WorkspaceProjectMember" ADD CONSTRAINT "WorkspaceProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WorkspaceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTask" ADD CONSTRAINT "WorkspaceTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WorkspaceProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTaskAssignee" ADD CONSTRAINT "WorkspaceTaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkspaceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceChecklistItem" ADD CONSTRAINT "WorkspaceChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkspaceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceComment" ADD CONSTRAINT "WorkspaceComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkspaceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMilestone" ADD CONSTRAINT "WorkspaceMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WorkspaceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceLink" ADD CONSTRAINT "WorkspaceLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WorkspaceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceLink" ADD CONSTRAINT "WorkspaceLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkspaceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAttachment" ADD CONSTRAINT "WorkspaceAttachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WorkspaceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAttachment" ADD CONSTRAINT "WorkspaceAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkspaceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceActivity" ADD CONSTRAINT "WorkspaceActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WorkspaceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceActivity" ADD CONSTRAINT "WorkspaceActivity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkspaceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTemplateTask" ADD CONSTRAINT "WorkspaceTemplateTask_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkspaceTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

