/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { StorageCleanupService } from './storage-cleanup.service';

describe('StorageCleanupService', () => {
  const job = {
    id: 'job-1',
    objectKey: 'gallery/admin/photo/full.jpg',
    purpose: 'GALLERY',
    attempts: 0,
    createdAt: new Date(),
  };

  it('reference-checks before deleting an object', async () => {
    const prisma = {
      storageCleanupJob: {
        findMany: jest.fn().mockResolvedValue([job]),
        delete: jest.fn(),
      },
      galleryPhoto: { count: jest.fn().mockResolvedValue(1) },
    } as any;
    const storage = { delete: jest.fn() } as any;

    await new StorageCleanupService(prisma, storage).run();

    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.storageCleanupJob.delete).not.toHaveBeenCalled();
  });

  it('removes an unreferenced object and completes its job', async () => {
    const prisma = {
      storageCleanupJob: {
        findMany: jest.fn().mockResolvedValue([job]),
        delete: jest.fn().mockResolvedValue(job),
      },
      galleryPhoto: { count: jest.fn().mockResolvedValue(0) },
    } as any;
    const storage = { delete: jest.fn().mockResolvedValue(undefined) } as any;

    await expect(
      new StorageCleanupService(prisma, storage).run(),
    ).resolves.toEqual({ processed: 1, deleted: 1 });
    expect(storage.delete).toHaveBeenCalledWith(job.objectKey);
    expect(prisma.storageCleanupJob.delete).toHaveBeenCalledWith({
      where: { id: job.id },
    });
  });

  it('retains failed jobs with exponential backoff and no secret error text', async () => {
    const prisma = {
      storageCleanupJob: {
        findMany: jest.fn().mockResolvedValue([job]),
        update: jest.fn().mockResolvedValue(job),
      },
      galleryPhoto: { count: jest.fn().mockResolvedValue(0) },
    } as any;
    const storage = {
      delete: jest.fn().mockRejectedValue(new Error('secret provider detail')),
    } as any;

    await new StorageCleanupService(prisma, storage).run();

    const data = prisma.storageCleanupJob.update.mock.calls[0][0].data;
    expect(data.attempts).toBe(1);
    expect(data.lastError).toBe('Error');
    expect(data.nextAttemptAt).toBeInstanceOf(Date);
  });
});
