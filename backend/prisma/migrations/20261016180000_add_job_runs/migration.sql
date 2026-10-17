-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "JobTrigger" AS ENUM ('CRON', 'MANUAL');

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" "JobTrigger" NOT NULL,
    "errorSummary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_runs_jobName_startedAt_idx" ON "job_runs"("jobName", "startedAt");
