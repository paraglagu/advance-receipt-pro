-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "storeName" TEXT,
    "storeAddress" TEXT,
    "storeCity" TEXT,
    "storeState" TEXT,
    "storePincode" TEXT,
    "storeTel" TEXT,
    "storeEmail" TEXT,
    "storeGstin" TEXT,
    "logoUrl" TEXT,
    "receiptPrefix" TEXT NOT NULL DEFAULT 'ADV-26-27-',
    "receiptSuffix" TEXT NOT NULL DEFAULT '',
    "nextReceiptNo" INTEGER NOT NULL DEFAULT 1,
    "receiptPadding" INTEGER NOT NULL DEFAULT 4,
    "pageSize" TEXT NOT NULL DEFAULT 'THERMAL80',
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "showQr" BOOLEAN NOT NULL DEFAULT false,
    "tenderNames" TEXT NOT NULL DEFAULT 'Advance Adjusted',
    "autoApply" BOOLEAN NOT NULL DEFAULT true,
    "declarationText" TEXT NOT NULL DEFAULT 'Received with thanks the sum stated above as an advance against future purchase.',
    "termsText" TEXT NOT NULL DEFAULT 'This advance is adjustable against any future purchase.
Non-transferable. Valid subject to store policy.',
    "footerText" TEXT NOT NULL DEFAULT 'This is a computer generated receipt.',
    "poweredByText" TEXT NOT NULL DEFAULT 'Powered by Advance Receipt Pro',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceReceipt" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "appliedPaise" INTEGER NOT NULL DEFAULT 0,
    "refundedPaise" INTEGER NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "staffName" TEXT,
    "productListed" BOOLEAN NOT NULL DEFAULT false,
    "productId" TEXT,
    "productVariantId" TEXT,
    "productTitle" TEXT,
    "productVariantTitle" TEXT,
    "productSku" TEXT,
    "productSpec" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ADMIN',
    "posOrderId" TEXT,
    "posOrderName" TEXT,
    "posGateway" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvanceReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'WEBHOOK',
    "releasedAt" TIMESTAMP(3),
    "releaseNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "receiptId" TEXT,
    "receiptNo" TEXT,
    "orderId" TEXT,
    "orderName" TEXT,
    "note" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "tenderPaise" INTEGER NOT NULL DEFAULT 0,
    "allocatedPaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'NO_TENDER',
    "message" TEXT,
    "orderDate" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessedOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceSettings_shop_key" ON "AdvanceSettings"("shop");

-- CreateIndex
CREATE INDEX "AdvanceReceipt_shop_customerId_idx" ON "AdvanceReceipt"("shop", "customerId");

-- CreateIndex
CREATE INDEX "AdvanceReceipt_shop_status_idx" ON "AdvanceReceipt"("shop", "status");

-- CreateIndex
CREATE INDEX "AdvanceReceipt_shop_receiptDate_idx" ON "AdvanceReceipt"("shop", "receiptDate");

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceReceipt_shop_receiptNo_key" ON "AdvanceReceipt"("shop", "receiptNo");

-- CreateIndex
CREATE INDEX "Allocation_shop_orderId_idx" ON "Allocation"("shop", "orderId");

-- CreateIndex
CREATE INDEX "Allocation_shop_customerId_idx" ON "Allocation"("shop", "customerId");

-- CreateIndex
CREATE INDEX "Allocation_receiptId_idx" ON "Allocation"("receiptId");

-- CreateIndex
CREATE INDEX "LedgerEntry_shop_customerId_entryDate_idx" ON "LedgerEntry"("shop", "customerId", "entryDate");

-- CreateIndex
CREATE INDEX "LedgerEntry_shop_entryDate_idx" ON "LedgerEntry"("shop", "entryDate");

-- CreateIndex
CREATE INDEX "LedgerEntry_shop_type_idx" ON "LedgerEntry"("shop", "type");

-- CreateIndex
CREATE INDEX "ProcessedOrder_shop_status_idx" ON "ProcessedOrder"("shop", "status");

-- CreateIndex
CREATE INDEX "ProcessedOrder_shop_processedAt_idx" ON "ProcessedOrder"("shop", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedOrder_shop_orderId_key" ON "ProcessedOrder"("shop", "orderId");

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "AdvanceReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

