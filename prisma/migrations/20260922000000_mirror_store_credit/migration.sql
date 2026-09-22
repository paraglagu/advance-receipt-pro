-- Mirror advance balances into Shopify store credit for POS visibility.
ALTER TABLE "AdvanceSettings" ADD COLUMN "mirrorStoreCredit" BOOLEAN NOT NULL DEFAULT true;
