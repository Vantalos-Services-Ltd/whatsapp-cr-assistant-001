-- CreateTable
CREATE TABLE "earnings_settings" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "basePayMonthly" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "commissionBrackets" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "earnings_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_earnings" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "revenueTotal" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "earnings_settings_agencyId_idx" ON "earnings_settings"("agencyId");

-- CreateIndex
CREATE INDEX "earnings_settings_operatorId_idx" ON "earnings_settings"("operatorId");

-- CreateIndex
CREATE UNIQUE INDEX "earnings_settings_agencyId_operatorId_key" ON "earnings_settings"("agencyId", "operatorId");

-- CreateIndex
CREATE INDEX "monthly_earnings_agencyId_year_month_idx" ON "monthly_earnings"("agencyId", "year", "month");

-- CreateIndex
CREATE INDEX "monthly_earnings_operatorId_year_month_idx" ON "monthly_earnings"("operatorId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_earnings_agencyId_operatorId_year_month_key" ON "monthly_earnings"("agencyId", "operatorId", "year", "month");

-- AddForeignKey
ALTER TABLE "earnings_settings" ADD CONSTRAINT "earnings_settings_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_settings" ADD CONSTRAINT "earnings_settings_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_earnings" ADD CONSTRAINT "monthly_earnings_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_earnings" ADD CONSTRAINT "monthly_earnings_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
