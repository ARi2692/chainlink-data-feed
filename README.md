# chainlink-data-feed

A Chainlink CRE (Chainlink Runtime Environment) workflow that reads live token prices from Chainlink Data Feeds on Ethereum Sepolia and writes price snapshots on-chain — triggered via HTTP with a single JSON payload.

## What It Does

1. Accepts an HTTP request with a `{ "token": "ETH" }` body
2. Reads the current USD price of that token from a **Chainlink Data Feed** on ETH Sepolia via EVM Read
3. Writes the result on-chain to the `PriceSnapshot` contract via EVM Write (two-step CRE report pattern)

## Flow

```
HTTP Request { "token": "ETH" }
        │
        ▼
CRE Workflow (HTTP Trigger)
        │
        ├── EVM Read  →  Chainlink Data Feed (latestRoundData)
        │                returns: price, blockNumber (updatedAt)
        │
        └── EVM Write →  PriceSnapshot.sol
                         stores: token, price, blockNumber, timestamp
```

## Deployed Contract

**PriceSnapshot on Ethereum Sepolia:**
`0xfE542F38e1cc89ef7e66D6B7946020Ed4d3675b6`

View on Etherscan: https://sepolia.etherscan.io/address/0xfE542F38e1cc89ef7e66D6B7946020Ed4d3675b6

## Supported Tokens

| Token | Chainlink Feed (Sepolia)                     |
|-------|----------------------------------------------|
| ETH   | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |
| BTC   | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` |
| LINK  | `0xc59E3633BAAC79493d908e63626716e204A45EdF` |
| DAI   | `0x14866185B1962B63C3Ea9E03Bc1da838bab34C19` |

To add more tokens, add an entry to `dataFeeds` in `config.staging.json` — no code changes needed.

---

## Prerequisites

- Node.js v18+
- Bun — 
    ```bash 
    npm install -g bun 
    ```
- Chainlink CRE CLI — [install here](https://docs.chain.link/cre/getting-started/cli-installation)
- A wallet with Sepolia ETH (for gas) — [Sepolia faucet](https://faucets.chain.link/sepolia)

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/chainlink-data-feed.git
cd chainlink-data-feed
```

### 2. Install dependencies

```bash
npm install
```

---

## Configuration

### 3. Set up secrets

```bash
cp secrets.yaml.example secrets.yaml
```

Edit `secrets.yaml` 

> **Never commit `secrets.yaml`** — it is gitignored.

### 4. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
CRE_ETH_PRIVATE_KEY=0xYourPrivateKeyHere
CRE_TARGET=staging-settings
```

> **Never commit `.env`** — it is gitignored.

### 5. Configure CRE Workflow

The workflow config is in `config.staging.json`. Feed addresses are pre-configured for Ethereum Sepolia. If you deployed your own instance of `PriceSnapshot.sol`, update the `PriceSnapshotAddress` field with your deployed contract address.

To add more tokens, use [Chainlink Price Feeds](https://docs.chain.link/data-feeds/price-feeds/addresses)

```json
{
  "schedule": "*/30 * * * * *",
  "evms": [
    {
      "chainSelectorName": "ethereum-testnet-sepolia",
      "PriceSnapshotAddress": "your_deployed_priceSnapshot_contract",
      "gasLimit": "1000000",
      "dataFeeds": {
        "ETH": "0x694AA1769357215DE4FAC081bf1f309aDC325306",
        "BTC": "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
        "LINK": "0xc59E3633BAAC79493d908e63626716e204A45EdF",
        "DAI": "0x14866185B1962B63C3Ea9E03Bc1da838bab34C19"
      }
    }
  ]
}
```

---

## Deploy the Contract (if deploying fresh)

The contract is already deployed at `0xfE542F38e1cc89ef7e66D6B7946020Ed4d3675b6`. If you want to deploy your own instance:

### Remix IDE

1. Open [Remix IDE](https://remix.ethereum.org)
2. Paste `contracts/PriceSnapshot.sol`
3. Import the `ReceiverTemplate` interface from `contracts/interfaces/`
4. Compile with Solidity `^0.8.0`
5. Deploy to **Sepolia** with the constructor argument:
   - `_forwarderAddress`: `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` (see [CRE ETHSepolia forwarder address](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts))
6. Copy the deployed address into `config.staging.json` under `PriceSnapshotAddress`

---

## Run the Workflow

### Simulate (no broadcast — dry run only)

```bash
cre workflow simulate my-workflow
```

### Simulate with broadcast (writes on-chain)

```bash
cre workflow simulate my-workflow --broadcast
```

When prompted, for **HTTP trigger** paste the payload directly:

```
┃ HTTP Trigger Configuration
┃ Enter a file path or JSON directly for the HTTP trigger
┃ > {"key": "value"} or ./payload.json
```

### CRE Workflow Payload

```bash
# ETH
{"token":"ETH"}

# BTC
{"token":"BTC"}

# LINK
{"token":"LINK"}

# DAI
{"token":"DAI"}
```

Paste any of the above when prompted by the CLI.

---

## Expected Output

```
Running trigger trigger=http-trigger@1.0.0-alpha

[USER LOG] [HTTP] token requested: ETH
[USER LOG] [HTTP] Using feed address: 0x694AA1769357215DE4FAC081bf1f309aDC325306
[USER LOG] [READ]  ETH/USD = $1675.27
[USER LOG] [READ]  blockNumber  = 1781436840
[USER LOG] [READ]  timestamp    = 1781439607
[USER LOG] [WRITE] Encoded report data: 0x...
[USER LOG] [WRITE] Report generated, submitting to 0xfE542F38e1cc89ef7e66D6B7946020Ed4d3675b6...
[USER LOG] [WRITE] Success! tx hash: 0xb8e9a696c7...

Workflow Simulation Result:
 ""{\"token\":\"ETH\",\"priceUsd\":\"1675.27\",\"price\":\"167527000000\",\"blockNumber\":\"1781436840\",\"timestamp\":\"1781439607\",\"txHash\":\"0xb8e9a696c71727a7bab8685ce4242c29a25e2b46fe33b237fab4ef33ac408552\"}""
```

Verify the snapshot on Etherscan by calling `getLatestSnapshot("ETH")` on the contract.

---


## Contract: Record Mapping

| Record field  | Source                          | Notes                               |
|---------------|---------------------------------|-------------------------------------|
| `token`       | HTTP body `token` field         | e.g. `"ETH"`                        |
| `price`       | `latestRoundData().answer`      | Scaled ×1e8 (e.g. 167527000000)     |
| `blockNumber` | `latestRoundData().updatedAt`   | Block when feed was last updated    |
| `timestamp`   | `Date.now() / 1000`             | Unix seconds at workflow execution  |

---

## Project Structure

```
chainlink-data-feed/
├── workflow/
│   ├── main.ts                  # Workflow entry point (HTTP trigger handler)
│   ├── types.ts                 # Config and PriceData type definitions
│   ├── config.production.yaml   # Chain, contract, and feed addresses
│   ├── config.staging.yaml      # Chain, contract, and feed addresses
│   └── workflow.yaml            # CRE workflow metadata   
├── contracts/
│   ├── PriceSnapshot.sol           # Main contract
│   └── interfaces/
│       ├── ReceiverTemplate.sol    # CRE receiver base
│       ├── IReceiver.sol           # CRE receiver interface
│       └── IERC165.sol             # ERC165 interface
├── secrets.yaml.example  # Template — copy to secrets.yaml
├── .env.example          # Template — copy to .env
└── README.md
```

---

## Security

- Never commit `secrets.yaml` or `.env` — both are gitignored
- Use `.env.example` and `secrets.yaml.example` as templates (no real values)
- The contract only accepts writes from the authorized CRE forwarder address set at deploy time