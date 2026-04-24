-- CreateTable
CREATE TABLE "observations" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "slotName" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bsci" DOUBLE PRECISION NOT NULL,
    "alertLevel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aiComment" TEXT,
    "aiTokensUsed" INTEGER,
    "marketSnapshot" JSONB,
    "previousObsId" TEXT,
    "accuracyVerified" BOOLEAN NOT NULL DEFAULT false,
    "actualDirection" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detector_scores" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "detector" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "signal" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "detector_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bsci_log" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "bsci" DOUBLE PRECISION NOT NULL,
    "alertLevel" TEXT NOT NULL,
    "topDetector" TEXT,
    "direction" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bsci_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bsci_weights" (
    "id" TEXT NOT NULL,
    "detector" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "totalSignals" INTEGER NOT NULL DEFAULT 0,
    "correctSignals" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bsci_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "content" JSONB,
    "hint" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "observations_ticker_timestamp_idx" ON "observations"("ticker", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "observations_bsci_idx" ON "observations"("bsci");

-- CreateIndex
CREATE INDEX "observations_alertLevel_idx" ON "observations"("alertLevel");

-- CreateIndex
CREATE INDEX "detector_scores_detector_createdAt_idx" ON "detector_scores"("detector", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "detector_scores_observationId_idx" ON "detector_scores"("observationId");

-- CreateIndex
CREATE INDEX "bsci_log_ticker_timestamp_idx" ON "bsci_log"("ticker", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "bsci_weights_detector_key" ON "bsci_weights"("detector");

-- CreateIndex
CREATE INDEX "reports_ticker_timestamp_idx" ON "reports"("ticker", "timestamp" DESC);
