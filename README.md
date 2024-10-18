# ZetaClientWrapper

ZetaClientWrapper is a Node.js module that provides a convenient interface for interacting with the Zeta Markets SDK. It simplifies the process of initializing the client, managing connections, and executing trades on the Solana blockchain.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Usage](#usage)
5. [API Reference](#api-reference)
6. [Error Handling](#error-handling)
7. [Contributing](#contributing)
8. [License](#license)

## Prerequisites

Before you begin, ensure you have met the following requirements:

- Node.js (v14 or later)
- npm (v6 or later)
- A Solana wallet with some SOL for transaction fees
- Access to a Solana RPC endpoint
- A Helius RPC URL for priority fees (optional)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/zeta-client-wrapper.git
   ```

2. Navigate to the project directory:
   ```
   cd zeta-client-wrapper
   ```

3. Install the dependencies:
   ```
   npm install
   ```

## Configuration

1. Create a `.env` file in the root directory of the project.

2. Add the following environment variables to the `.env` file:

   ```
   RPC_ENDPOINT_1=your_primary_rpc_endpoint
   RPC_ENDPOINT_2=your_secondary_rpc_endpoint (optional)
   RPC_WS_ENDPOINT_2=your_secondary_websocket_endpoint (optional)
   RPC_ENDPOINT_3=your_additional_rpc_endpoint (optional)
   RPC_WS_ENDPOINT_3=your_additional_websocket_endpoint (optional)
   HELIUS_RPC=your_helius_rpc_url
   KEYPAIR_FILE_PATH=path_to_your_solana_keypair_file
   REDIS_HOST=your_redis_host
   REDIS_PORT=your_redis_port
   REDIS_PASSWORD=your_redis_password
   ```

   Replace the placeholders with your actual values.

   Note: The RPC_ENDPOINT_1 is required, while RPC_ENDPOINT_2, RPC_WS_ENDPOINT_2, RPC_ENDPOINT_3, and RPC_WS_ENDPOINT_3 are optional additional connections.

## Usage

The ZetaClientWrapper supports multiple RPC connections, with the primary connection being mandatory and additional connections being optional. Here's how to use it:

```javascript
import { ZetaClientWrapper } from './zeta-api-v4.js';

async function main() {
  const zetaClient = new ZetaClientWrapper();

  try {
    // Initialize the client
    await zetaClient.initialize();

    // The primary connection (RPC_ENDPOINT_1) is now set up
    console.log('Primary connection established');

    // Check if additional connections are available
    if (zetaClient.connection_2) {
      console.log('Additional connection 2 is available');
    }

    if (zetaClient.connection_3) {
      console.log('Additional connection 3 is available');
    }

    // Open a long position
    const txid = await zetaClient.openPositionWithTPSLVersioned('long');
    console.log(`Position opened. Transaction ID: ${txid}`);

    // Get current position
    const position = await zetaClient.getPosition(zetaClient.activeMarket);
    console.log('Current position:', position);

    // Cancel all orders
    await zetaClient.cancelAllOrders(zetaClient.activeMarket);
    console.log('All orders cancelled');

  } catch (error) {
    console.error('Error:', error);
  }
}

main();
```

In this example, the `initialize()` method sets up all available connections based on the provided environment variables. The primary connection (RPC_ENDPOINT_1) is required, while the additional connections (RPC_ENDPOINT_2 and RPC_ENDPOINT_3) are optional.

The optional connections can be used for specific purposes like load balancing, failover, or dedicated operations, providing flexibility in your application architecture.

## API Reference

### `ZetaClientWrapper`

#### Methods

- `initialize()`: Initializes the ZetaClientWrapper, setting up connections and loading the exchange. It establishes the primary connection and optional additional connections if the corresponding environment variables are set.
- `openPositionWithTPSLVersioned(direction, marketIndex)`: Opens a position with take-profit and stop-loss orders.
- `getPosition(marketIndex)`: Retrieves the current position for the specified market.
- `cancelAllOrders(marketIndex)`: Cancels all orders for the specified market.
- `updateSettings(newSettings)`: Updates the trading settings (leverage, take-profit, stop-loss).
- `fetchSettings()`: Retrieves the current trading settings from Redis.

### Error Handling

The ZetaClientWrapper uses a logger to record errors and important information. Make sure to handle errors appropriately in your application:

```javascript
try {
  // Your code here
} catch (error) {
  logger.error('An error occurred:', error);
}
```

## Contributing

Contributions to the ZetaClientWrapper are welcome. Please follow these steps:

1. Fork the repository
2. Create a new branch (`git checkout -b feature/your-feature-name`)
3. Make your changes
4. Commit your changes (`git commit -am 'Add some feature'`)
5. Push to the branch (`git push origin feature/your-feature-name`)
6. Create a new Pull Request

## License

MIT License

Copyright (c) [year] [fullname]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.