CREATE INDEX "Task_storeId_updatedAt_idx" ON "Task"("storeId", "updatedAt");
CREATE INDEX "Notification_userId_storeId_createdAt_idx" ON "Notification"("userId", "storeId", "createdAt");
CREATE INDEX "Notification_userId_storeId_readAt_idx" ON "Notification"("userId", "storeId", "readAt");
