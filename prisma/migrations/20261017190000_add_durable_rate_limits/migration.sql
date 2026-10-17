CREATE TABLE "ApiRateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApiRateLimit_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "ApiRateLimit_resetAt_idx" ON "ApiRateLimit"("resetAt");
