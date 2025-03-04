# Noodles.Fun — Feed Your KOLs! 🍜

**Noodles.Fun** transforms **Twitter (X) accounts into tradeable tokens** powered by bonding curves. These tokens aren’t just collectibles—they’re a **new way to book promotions**, like shoutouts or pinned tweets, while creating deeper engagement with Key Opinion Leaders (KOLs).  

## **How It Works**  

1. **Every Twitter (X) Account Has Its Own Token**. Each profile is linked to a **bonding curve token**, setting its own market dynamics.
2. **Buy & Sell Instantly**. No liquidity pools, no order books—just **seamless trading** via bonding curves.
3. **Use Tokens for Promotions**. Token holders can **pay creators directly** for promotional tweets. Creators can also accept **ETH payments** and allocate part of their earnings to **buy back and burn** their tokens, adding an extra layer of value.  

## Upgradeable Contracts

|Contract|Description|Mainnet address (Proxy)|Testnet address (Proxy)|
|--------|--------------------|---------------|---------------|
| **VisibilityCredits**  | Implements a bonding curve where token price = A × supply² + B × supply + basePrice. Price grows as supply grows | [0x0DA6Bfd5d50edb31AF14C3A7820d28dB475Ec97D](https://abscan.org/address/0x0da6bfd5d50edb31af14c3a7820d28db475ec97d)      | [0x25aaca9fD684CD710BB87bd8f87A2a9F20e5a269](https://sepolia.abscan.org/address/0x25aaca9fd684cd710bb87bd8f87a2a9f20e5a269)        |
| **VisibilityServices** (VisibilityCredits + ETH payments)| Lets creators accept tokens for off-chain promotion services.                                                   | -| [0x446aC2A937b7ef299402D97a9132CD2ce7Ff73b1](https://sepolia.abscan.org/address/0x446ac2a937b7ef299402d97a9132cd2ce7ff73b1)        |
| **VisibilityServices**  (VisibilityCredits payments only)| Lets creators accept tokens for off-chain promotion services.                                                   | [0x89e74F963e506D6921FF33cB75b53b963D7218bE](https://abscan.org/address/0x89e74F963e506D6921FF33cB75b53b963D7218bE)      | -  |
| **PointsSBT**  | Soulbound tokens to reward early users | [0xE19FF0aCF99fc4598003d34E8DF7b828849B9F48](https://abscan.org/address/0xE19FF0aCF99fc4598003d34E8DF7b828849B9F48)      | [0x53D523F98dFd0B4b8ADd9306D345d6e709AD6b18](https://sepolia.abscan.org/address/0x53d523f98dfd0b4b8add9306d345d6e709ad6b18)        |

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

3. Run tests:

   ```bash
   npm run test
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

## Tests

### Run local node

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

3. Run local node:

   ```bash
   ./target/release/anvil-zksync
   ```

4. Or run forked node:

   ```bash
   ./target/release/anvil-zksync fork --fork-url https://api.testnet.abs.xyz --fork-block-number 3558125
   ```

5. In another terminal, run tests:

   ```bash
   npm run test-localhost
   ```
