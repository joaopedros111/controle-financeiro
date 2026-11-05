export { createSyntheticMigrator, migrationCanonicalBytes } from '../../experimental/finance-vault-migration.js';
export { openSyntheticMigrationSource, openSyntheticMigrationTarget, syntheticTargetCapability, SYNTHETIC_SOURCE_PREFIX, SYNTHETIC_TARGET_PREFIX } from '../../experimental/finance-vault-migration-storage.js';
export { migrationCases, migrationSourceFixture, migrationOwner, migrationPassword } from './vault-migration-scenarios.mjs';
export { browserStoreFactory } from './vault-browser-store.mjs';
export { createFinancialCodec } from '../../finance-vault-codec.js';
export { vaultDigest } from '../../finance-vault-recovery.js';
