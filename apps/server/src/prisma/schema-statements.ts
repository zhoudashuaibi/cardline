/**
 * SQLite 建表语句（与 prisma/schema.prisma 保持一致）。
 *
 * 用途：Prisma 的 `db push` 需要 CLI，而生产镜像里不带 CLI。
 * 服务启动时会用这些幂等语句保证表结构存在，Docker 与本地都能开箱即用。
 * 修改 schema.prisma 时请同步这里的字段。
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "AdminUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '管理员',
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_username_key" ON "AdminUser"("username")`,

  `CREATE TABLE IF NOT EXISTS "Batch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batchId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    "source" TEXT NOT NULL DEFAULT 'paste',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Batch_batchId_key" ON "Batch"("batchId")`,

  `CREATE TABLE IF NOT EXISTS "Account" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "credits" INTEGER NOT NULL,
    "cardKey" TEXT NOT NULL,
    "cardDisabled" BOOLEAN NOT NULL DEFAULT false,
    "planType" TEXT,
    "accountId" TEXT,
    "userId" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "sessionToken" TEXT,
    "expiresAt" DATETIME,
    "rawSource" TEXT NOT NULL DEFAULT 'sub2api',
    "rawJson" TEXT,
    "banStatus" TEXT NOT NULL DEFAULT 'unknown',
    "banReason" TEXT,
    "banKeywords" TEXT,
    "banCheckedAt" DATETIME,
    "redeemStatus" TEXT NOT NULL DEFAULT 'unredeemed',
    "redeemedAt" DATETIME,
    "redeemCount" INTEGER NOT NULL DEFAULT 0,
    "copyCount" INTEGER NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Account_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("batchId") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Account_cardKey_key" ON "Account"("cardKey")`,
  `CREATE INDEX IF NOT EXISTS "Account_credits_idx" ON "Account"("credits")`,
  `CREATE INDEX IF NOT EXISTS "Account_banStatus_idx" ON "Account"("banStatus")`,
  `CREATE INDEX IF NOT EXISTS "Account_redeemStatus_idx" ON "Account"("redeemStatus")`,
  `CREATE INDEX IF NOT EXISTS "Account_email_idx" ON "Account"("email")`,
  `CREATE INDEX IF NOT EXISTS "Account_createdAt_idx" ON "Account"("createdAt")`,

  `CREATE TABLE IF NOT EXISTS "MailCredential" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accountId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'outlook',
    "authType" TEXT NOT NULL DEFAULT 'oauth2',
    "password" TEXT,
    "clientId" TEXT,
    "refreshToken" TEXT,
    "line" TEXT,
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MailCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MailCredential_accountId_key" ON "MailCredential"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "MailCredential_email_idx" ON "MailCredential"("email")`,

  `CREATE TABLE IF NOT EXISTS "RedeemLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cardKey" TEXT NOT NULL,
    "accountId" INTEGER,
    "credits" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RedeemLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "RedeemLog_cardKey_idx" ON "RedeemLog"("cardKey")`,
  `CREATE INDEX IF NOT EXISTS "RedeemLog_createdAt_idx" ON "RedeemLog"("createdAt")`,

  `CREATE TABLE IF NOT EXISTS "PickupLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accountId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "credits" INTEGER,
    "code" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickupLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "PickupLog_accountId_idx" ON "PickupLog"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "PickupLog_createdAt_idx" ON "PickupLog"("createdAt")`,

  `CREATE TABLE IF NOT EXISTS "CreditTier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "credits" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CreditTier_credits_key" ON "CreditTier"("credits")`,

  `CREATE TABLE IF NOT EXISTS "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
  )`,
];
