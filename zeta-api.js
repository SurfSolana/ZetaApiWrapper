import {
  Wallet,
  CrossClient,
  Exchange,
  Network,
  Market,
  utils,
  types,
  assets,
  constants,
  events
} from "@zetamarkets/sdk";
import {   
  PublicKey,
  Connection,
  Keypair,
  Transaction,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";
import fs from "fs";
import dotenv from 'dotenv';
import logger from "./logger.js";
import Redis from 'ioredis';

import {
  BN,
  HeliusPriorityLevel,
  PriorityFeeMethod,
  PriorityFeeSubscriber
} from "@drift-labs/sdk";

dotenv.config();

export class ZetaClientWrapper {
  constructor() {
    this.client = null;
    this.connection = null;
    
    this.connection_2 = null;
    this.connection_3 = null;
    
    this.wallet = null;
    this.activeMarket = constants.Asset.SOL;
    this.use_db_settings = true;
    
    this.heliusPriorityFees = null;
    this.priorityLevel = HeliusPriorityLevel.HIGH;
    this.priorityFeeMultiplier = 1;
    
    this.currentPriorityFee = 10_000;
    
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
    });
    
  }
  
  async processTransactionWithRetry(transaction, maxRetries = 3, retryDelay = 100) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Fetch the freshest blockhash
        const { blockhash, lastValidBlockHeight } = await this.client.provider.connection.getLatestBlockhash("finalized");
        
        logger.info(`Attempt ${attempt} - Fresh Blockhash:`, { blockhash, lastValidBlockHeight });
        
        // Update the transaction with the fresh blockhash
        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;
        
        const txid = await utils.processTransaction(
          this.client.provider,
          transaction,
          undefined,
          {
            skipPreflight: true,
            preflightCommitment: "finalized",
            commitment: "finalized",
          },
          false,
          utils.getZetaLutArr()
          // We no longer need to pass the blockhash here as it's already in the transaction
        );
        
        // If we reach this point, the transaction was sent successfully
        logger.info(`Transaction sent successfully. txid: ${txid}`);
        return txid; // Exit the method, no need for further retries
        
      } catch (error) {
        if (attempt === maxRetries) {
          logger.error(`Transaction failed after ${maxRetries} attempts. Final error: ${error.message}`);
          throw error;
        }
        logger.warn(`Transaction attempt ${attempt} failed. Retrying in ${retryDelay}ms. Error: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  
  async openPositionWithTPSLVersioned(direction, marketIndex = this.activeMarket) {
    logger.info(`Opening ${direction} position for ${assets.assetToName(marketIndex)}`);
    
    const settings = await this.fetchSettings();
    logger.info(`Using settings:`, settings);
    
    await this.updateHeliusPriorityFees();
    
    await this.client.updateState();
    
    const balance = Exchange.riskCalculator.getCrossMarginAccountState(this.client.account).balance;
    
    const side = direction === "long" ? types.Side.BID : types.Side.ASK;
    
    const { currentPrice, adjustedPrice, positionSize, nativeLotSize } = this.calculatePricesAndSize(side, marketIndex, balance, settings);
    
    const { takeProfitPrice, takeProfitTrigger, stopLossPrice, stopLossTrigger } = 
    this.calculateTPSLPrices(direction, adjustedPrice, settings);
    
    logger.info(`Current price: ${currentPrice}, Adjusted price: ${adjustedPrice.toFixed(4)}`);
    logger.info(`TP Price: ${takeProfitPrice.toFixed(4)}, TP Trigger: ${takeProfitTrigger.toFixed(4)}`);
    logger.info(`SL Price: ${stopLossPrice.toFixed(4)}, SL Trigger: ${stopLossTrigger.toFixed(4)}`);
    
    const mainOrderIx = this.createMainOrderInstruction(marketIndex, adjustedPrice, nativeLotSize, side);
    const tpOrderIx = this.createTPLimitOrderInstruction(direction, marketIndex, takeProfitPrice, takeProfitTrigger, nativeLotSize);
    const slOrderIx = this.createSLOrderInstruction(direction, marketIndex, stopLossPrice, stopLossTrigger, nativeLotSize, 0);
    
    let transaction = new Transaction();
    transaction.add(mainOrderIx);
    transaction.add(tpOrderIx);
    transaction.add(slOrderIx);
    
    const txid = await this.processTransactionWithRetry(transaction);
    
    logger.info(`Transaction sent. txid: ${txid}`);
    return txid;
  }
  
  
  async setupHeliusPriorityFees() {
    const config = {
      priorityFeeMethod: PriorityFeeMethod.HELIUS,
      heliusRpcUrl: process.env.HELIUS_RPC,
      frequencyMs: 5000,
    };
    
    this.heliusPriorityFees = new PriorityFeeSubscriber(config);
    await this.heliusPriorityFees.subscribe();
    await this.heliusPriorityFees.load();
  }
  
  async updateHeliusPriorityFees() {
    try {
      await this.heliusPriorityFees.load();
      this.currentPriorityFee = this.heliusPriorityFees.getHeliusPriorityFeeLevel(this.priorityLevel);
      this.currentPriorityFee = Math.floor(this.currentPriorityFee * this.priorityFeeMultiplier);
      console.log(`Updated Helius Priority Fee (${this.priorityLevel} level):`, this.currentPriorityFee);
      
      Exchange.updatePriorityFee(this.currentPriorityFee);
      
    } catch (error) {
      console.error("Error updating Helius priority fees:", error);
    }
  }
  
  async initialize() {
    try {
      
      this.connection = new Connection(process.env.RPC_ENDPOINT_1);
      
      if (process.env.RPC_ENDPOINT_2) {
        this.connection_2 = new Connection(process.env.RPC_ENDPOINT_2, {
          wsEndpoint: process.env.RPC_WS_ENDPOINT_2,
        });
      }
      
      if (process.env.RPC_ENDPOINT_3) {
        this.connection_3 = new Connection(process.env.RPC_ENDPOINT_3, {
          wsEndpoint: process.env.RPC_WS_ENDPOINT_3,
        });
      }
      
      const keyPairFile = process.env.KEYPAIR_FILE_PATH;
      const secretKeyString = fs.readFileSync(keyPairFile, "utf8");
      const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
      const keypair = Keypair.fromSecretKey(secretKey);
      this.wallet = new Wallet(keypair);
      
      const loadExchangeConfig = types.defaultLoadExchangeConfig(
        Network.MAINNET,
        this.connection,
        {
          skipPreflight: true,
          preflightCommitment: "finalized",
          commitment: "finalized",
        },
        4,
        true,
        this.connection,
        [ this.activeMarket ],
        undefined,
        [ this.activeMarket ]
      );
      
      await Exchange.load(
        loadExchangeConfig,
        this.wallet,
      );
      
      Exchange.setUseAutoPriorityFee(false);
      await this.setupHeliusPriorityFees();
      await this.updateawait this.updateHeliusPriorityFees();
      
      this.client = await CrossClient.load(
        this.connection,
        this.wallet,
        undefined,
        undefined,
        undefined,
        undefined,
        true
      );
      
      logger.info("ZetaClientWrapper initialized");
    } catch (error) {
      logger.error("Error initializing ZetaClientWrapper:", error);
      throw error;
    }
  }
  
  getCalculatedMarkPrice(asset) {
    const orderBook = Exchange.getOrderbook(asset);
    return Number((orderBook.asks[0].price + orderBook.bids[0].price) / 2);
  }
  
  async getPosition(marketIndex) {
    try {
      await this.client.updateState();
      const positions = this.client.getPositions(marketIndex);
      
      return positions[0] || null;
    } catch (error) {
      logger.error(`Error getting position for market ${marketIndex}:`, error);
      throw error;
    }
  }
  
  async updateSettings(newSettings) {
    await this.redis.hmset('trading_settings', newSettings);
    return this.fetchSettings();
  }
  
  async fetchSettings() {
    try {
      const redisSettings = await this.redis.hgetall('trading_settings');
      return {
        leverageMultiplier: parseFloat(redisSettings.leverageMultiplier) || 8,
        takeProfitPercentage: parseFloat(redisSettings.takeProfitPercentage) || 0.0018,
        stopLossPercentage: parseFloat(redisSettings.stopLossPercentage) || 0.022
      };
    } catch (error) {
      logger.error(`Error fetching settings from Redis:`, error);
      return {
        leverageMultiplier: 8,
        takeProfitPercentage: 0.0018,
        stopLossPercentage: 0.022
      };
    }
  }  
  
  async cancelAllOrders(marketIndex) {
    try {
      const result = await this.client.cancelAllOrders(marketIndex);
      logger.info(`Cancelled all orders for market ${marketIndex}`);
      return result;
    } catch (error) {
      logger.error(`Error cancelling all orders for market ${marketIndex}:`, error);
      throw error;
    }
  }
  
  calculateTPSLPrices(direction, price, settings) {
    const { takeProfitPercentage, stopLossPercentage } = settings;
    const isLong = direction === "long";
    
    const takeProfitPrice = isLong ? 
    price + (price * takeProfitPercentage) : 
    price - (price * takeProfitPercentage);
    
    const takeProfitTrigger = isLong ? 
    price + ((takeProfitPrice - price) / 2) : 
    price - ((price - takeProfitPrice) / 2);
    
    const stopLossPrice = isLong ?
    price - (price * stopLossPercentage) :
    price + (price * stopLossPercentage);
    
    const stopLossTrigger = isLong ? 
    price - ((price - stopLossPrice) * 0.9) : 
    price + ((stopLossPrice - price) * 0.9);
    
    return { 
      takeProfitPrice, 
      takeProfitTrigger, 
      stopLossPrice, 
      stopLossTrigger 
    };
  }
  
  calculatePricesAndSize(side, marketIndex, balance, settings) {

    // force update orderbook
    Exchange.getPerpMarket(marketIndex).forceFetchOrderbook();

    const orderbook = Exchange.getOrderbook(marketIndex);
    const currentPrice = side === types.Side.BID ? orderbook.asks[0].price : orderbook.bids[0].price;
    const slippage = 0.00005; // 0.005%
    const adjustedPrice = side === types.Side.BID ? 
    currentPrice * (1 + slippage) : 
    currentPrice * (1 - slippage);
    
    const balanceDecimal = balance;
    const positionSize = (balanceDecimal * settings.leverageMultiplier) / currentPrice;
    const nativeLotSize = utils.convertDecimalToNativeLotSize(positionSize.toFixed(1));
    
    logger.info(`Order Size: `, positionSize.toFixed(1));
    
    return { currentPrice, adjustedPrice, positionSize, nativeLotSize };
  }
  
  createMainOrderInstruction(marketIndex, adjustedPrice, nativeLotSize, side) {
    return this.client.createPlacePerpOrderInstruction(
      marketIndex,
      utils.convertDecimalToNativeInteger(adjustedPrice),
      nativeLotSize,
      side,
      { 
        orderType: types.OrderType.LIMIT,
        tifOptions: {}
      }
    );
  }
  
  createTPLimitOrderInstruction(direction, marketIndex, takeProfitPrice, takeProfitTrigger, nativeLotSize) {
    
    const tp_side = direction === "long" ? types.Side.ASK : types.Side.BID;
    const triggerDirection = direction === "long" ? types.TriggerDirection.GREATERTHANOREQUAL : types.TriggerDirection.LESSTHANOREQUAL;
    
    return this.client.createPlacePerpOrderInstruction(
      marketIndex,
      utils.convertDecimalToNativeInteger(takeProfitPrice),
      nativeLotSize,
      tp_side,
      { 
        orderType: types.OrderType.LIMIT,
        tifOptions: {},
        reduceOnly: true
      }
    );
  }
  
  createTPOrderInstruction(direction, marketIndex, takeProfitPrice, takeProfitTrigger, nativeLotSize, triggerOrderBit = 0) {
    const tp_side = direction === "long" ? types.Side.ASK : types.Side.BID;
    const triggerDirection = direction === "long" ? types.TriggerDirection.GREATERTHANOREQUAL : types.TriggerDirection.LESSTHANOREQUAL;
    
    return this.client.createPlaceTriggerOrderIx(
      marketIndex,
      utils.convertDecimalToNativeInteger(takeProfitPrice),
      nativeLotSize,
      tp_side,
      utils.convertDecimalToNativeInteger(takeProfitTrigger),
      triggerDirection,
      new BN(0), // triggerTimestamp (0 for price trigger)
      types.OrderType.LIMIT,
      triggerOrderBit, // using our own instead of this.client.findAvailableTriggerOrderBit(),
      { 
        reduceOnly: true,
        tag: constants.DEFAULT_ORDER_TAG
      }
    );
  }
  
  createSLOrderInstruction(direction, marketIndex, stopLossPrice, stopLossTrigger, nativeLotSize, triggerOrderBit = 1) {
    const sl_side = direction === "long" ? types.Side.ASK : types.Side.BID;
    const triggerDirection = direction === "long" ? types.TriggerDirection.LESSTHANOREQUAL : types.TriggerDirection.GREATERTHANOREQUAL;
    
    return this.client.createPlaceTriggerOrderIx(
      marketIndex,
      utils.convertDecimalToNativeInteger(stopLossPrice),
      nativeLotSize,
      sl_side,
      utils.convertDecimalToNativeInteger(stopLossTrigger),
      triggerDirection,
      new BN(0), // triggerTimestamp (0 for price trigger)
      types.OrderType.LIMIT,
      triggerOrderBit, // this.client.findAvailableTriggerOrderBit()
      { 
        reduceOnly: true,
        tag: constants.DEFAULT_ORDER_TAG
      }
    );
  }
  
}
