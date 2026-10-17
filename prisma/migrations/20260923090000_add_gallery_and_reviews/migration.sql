CREATE TYPE "GalleryAlbumStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

CREATE TABLE "GalleryAlbum" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" "GalleryAlbumStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "permissionConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "permissionActorId" TEXT,
  "permissionAt" TIMESTAMP(3),
  "coverPhotoId" TEXT,
  "createRequestKey" TEXT,
  "createFingerprint" TEXT,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GalleryAlbum_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GalleryPhoto" (
  "id" TEXT NOT NULL,
  "albumId" TEXT,
  "uploaderId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "contentFingerprint" TEXT NOT NULL,
  "fullKey" TEXT NOT NULL,
  "thumbnailKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "caption" TEXT NOT NULL DEFAULT '',
  "alt" TEXT NOT NULL DEFAULT '',
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GalleryPhoto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GalleryAudit" (
  "id" TEXT NOT NULL,
  "albumId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "priorStatus" "GalleryAlbumStatus",
  "newStatus" "GalleryAlbumStatus",
  "permissionConfirmed" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GalleryAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Review" (
  "id" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "orderNumber" TEXT,
  "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
  "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
  "publicationConsent" BOOLEAN NOT NULL,
  "consentVersion" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "moderationReason" TEXT,
  "moderatedById" TEXT,
  "moderatedAt" TIMESTAMP(3),
  "requestKey" TEXT NOT NULL,
  "submissionFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewPhoto" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "fullKey" TEXT NOT NULL,
  "thumbnailKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewPhoto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewAudit" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "priorStatus" "ReviewStatus" NOT NULL,
  "newStatus" "ReviewStatus" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StorageCleanupJob" (
  "id" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorageCleanupJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentDeletionAudit" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentDeletionAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GalleryAlbum_slug_key" ON "GalleryAlbum"("slug");
CREATE UNIQUE INDEX "GalleryAlbum_coverPhotoId_key" ON "GalleryAlbum"("coverPhotoId");
CREATE UNIQUE INDEX "GalleryAlbum_createdById_createRequestKey_key" ON "GalleryAlbum"("createdById", "createRequestKey");
CREATE INDEX "GalleryAlbum_status_publishedAt_id_idx" ON "GalleryAlbum"("status", "publishedAt", "id");
CREATE INDEX "GalleryAlbum_createdAt_id_idx" ON "GalleryAlbum"("createdAt", "id");
CREATE UNIQUE INDEX "GalleryPhoto_fullKey_key" ON "GalleryPhoto"("fullKey");
CREATE UNIQUE INDEX "GalleryPhoto_thumbnailKey_key" ON "GalleryPhoto"("thumbnailKey");
CREATE UNIQUE INDEX "GalleryPhoto_uploaderId_requestKey_key" ON "GalleryPhoto"("uploaderId", "requestKey");
CREATE UNIQUE INDEX "GalleryPhoto_albumId_sortOrder_key" ON "GalleryPhoto"("albumId", "sortOrder");
CREATE INDEX "GalleryPhoto_albumId_sortOrder_id_idx" ON "GalleryPhoto"("albumId", "sortOrder", "id");
CREATE INDEX "GalleryPhoto_expiresAt_idx" ON "GalleryPhoto"("expiresAt");
CREATE INDEX "GalleryAudit_albumId_createdAt_idx" ON "GalleryAudit"("albumId", "createdAt");
CREATE UNIQUE INDEX "Review_requestKey_key" ON "Review"("requestKey");
CREATE INDEX "Review_status_createdAt_id_idx" ON "Review"("status", "createdAt", "id");
CREATE INDEX "Review_phone_idx" ON "Review"("phone");
CREATE UNIQUE INDEX "ReviewPhoto_fullKey_key" ON "ReviewPhoto"("fullKey");
CREATE UNIQUE INDEX "ReviewPhoto_thumbnailKey_key" ON "ReviewPhoto"("thumbnailKey");
CREATE UNIQUE INDEX "ReviewPhoto_reviewId_sortOrder_key" ON "ReviewPhoto"("reviewId", "sortOrder");
CREATE INDEX "ReviewPhoto_reviewId_sortOrder_idx" ON "ReviewPhoto"("reviewId", "sortOrder");
CREATE INDEX "ReviewAudit_reviewId_createdAt_idx" ON "ReviewAudit"("reviewId", "createdAt");
CREATE UNIQUE INDEX "StorageCleanupJob_objectKey_key" ON "StorageCleanupJob"("objectKey");
CREATE INDEX "StorageCleanupJob_nextAttemptAt_createdAt_idx" ON "StorageCleanupJob"("nextAttemptAt", "createdAt");
CREATE INDEX "ContentDeletionAudit_entityType_entityId_createdAt_idx" ON "ContentDeletionAudit"("entityType", "entityId", "createdAt");

ALTER TABLE "GalleryAlbum" ADD CONSTRAINT "GalleryAlbum_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GalleryAlbum" ADD CONSTRAINT "GalleryAlbum_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GalleryPhoto" ADD CONSTRAINT "GalleryPhoto_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "GalleryAlbum"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GalleryPhoto" ADD CONSTRAINT "GalleryPhoto_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GalleryAlbum" ADD CONSTRAINT "GalleryAlbum_coverPhotoId_fkey" FOREIGN KEY ("coverPhotoId") REFERENCES "GalleryPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GalleryAudit" ADD CONSTRAINT "GalleryAudit_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "GalleryAlbum"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GalleryAudit" ADD CONSTRAINT "GalleryAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewPhoto" ADD CONSTRAINT "ReviewPhoto_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewAudit" ADD CONSTRAINT "ReviewAudit_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewAudit" ADD CONSTRAINT "ReviewAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentDeletionAudit" ADD CONSTRAINT "ContentDeletionAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
