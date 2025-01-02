# Noodles.Fun — Feed Your KOLs! 🍜

**Noodles.Fun** turns Twitter (X) accounts into special bonding curve tokens. Trade these tokens and use them to pay for promotion services on X, such as shoutouts or pinned tweets. A fun way to support and engage with KOLs!

## How It Works

1. **Every Twitter Account Has a Token:** Each token represents a unique bonding curve for a Twitter (X) account.
2. **Trade Instantly:** Use a bonding curve to buy or sell tokens. No need for liquidity pools or order books.
3. **Spend Tokens for Promotions:** The X account owner can accept tokens as payment for services, such as tweets or pinned posts.

## Contracts

|Contract|Description|Mainnet address|Testnet address|
|--------|--------------------|---------------|---------------|
| **VisibilityCredits**  | Implements a bonding curve where token price = A × supply² + B × supply + basePrice. Price grows as supply grows | Coming Soon      | [0xd10c04ba41033cc91006381aaA6fc3e657F98Aa5](https://explorer.testnet.abs.xyz/address/0xd10c04ba41033cc91006381aaA6fc3e657F98Aa5)        |
| **VisibilityServices** | Lets creators accept tokens for off-chain promotion services.                                                   | Coming Soon      | [0x71eE755BfFAeD9C5f7b99fEa64ae74de20e6b703](https://explorer.testnet.abs.xyz/address/0x71eE755BfFAeD9C5f7b99fEa64ae74de20e6b703#contract)        |

---

## Development

### Setup

1. Install packages:

   ```bash
   npm install
   ```

2. Compile:

   ```bash
   npm run compile
   ```

### Deploy

#### Configuration

Ensure you setup your `.env` file correctly. You can initialize it from the provided `.env.example` file:

   ```bash
   cp .env_example .env
   ```

#### Deploy to the Abstract Testnet

   ```bash
   npm run deploy abstractTestnet
   ```

### Testing

```bash
npm run test
```

### Local Fork Testing

1. Install Rust (if not already installed):

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. Build the local node:

   ```bash
   git clone https://github.com/matter-labs/era-test-node
   cd era-test-node
   make fetch-contracts && make build-contracts
   make clean && make build-contracts && make rust-build
   ```

   If you see any build errors about `aws-lc-sys`, you might need:

   ```bash
   sudo apt remove gcc-9 && sudo apt install clang
   ```

3. Run forked node:

   ```bash
   ./target/release/anvil-zksync fork --fork-url https://api.testnet.abs.xyz
   ```

4. In another terminal, run tests:

   ```bash
   npm run test-local
   ```
