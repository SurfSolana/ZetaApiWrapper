// zeta-test.js

import { ZetaClientWrapper } from './zeta-api-v4.js';
import { utils, assets, constants } from "@zetamarkets/sdk";
import logger from './logger.js';

async function main() {
  const zetaWrapper = new ZetaClientWrapper();
  await zetaWrapper.initialize();
  
  const marketIndex = constants.Asset.SOL;

  let direction = 'long';

  logger.info(`Open position`, { direction: direction.toUpperCase() });
  try {
    const tx = await zetaWrapper.openPositionWithTPSLVersioned(
      direction,
      marketIndex
    );
    logger.info(`Position opened:`, { direction, transaction: tx });
  } catch (error) {
    logger.error(`Error opening position`, { error: error.message });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
