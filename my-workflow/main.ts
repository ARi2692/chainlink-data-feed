import {
  cre,
  getNetwork,
  encodeCallMsg,
  bytesToHex,
  hexToBase64,
  Runtime,
  Runner,
  LAST_FINALIZED_BLOCK_NUMBER,
  decodeJson,
  HTTPPayload,
  TxStatus,
} from "@chainlink/cre-sdk";
import {
  type Address,
  encodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  parseAbiParameters,
  zeroAddress,
} from "viem";
import type { Config, PriceData } from "./types";

const priceFeedAbi = [
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

function getPriceData(
  runtime: Runtime<Config>,
  evmClient: InstanceType<typeof cre.capabilities.EVMClient>,
  feedAddress: Address,
): PriceData {
  const callData = encodeFunctionData({
    abi: priceFeedAbi,
    functionName: "latestRoundData",
    args: [],
  });

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: feedAddress,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  const priceDataTuple = decodeFunctionResult({
    abi: priceFeedAbi,
    functionName: "latestRoundData",
    data: bytesToHex(contractCall.data),
  }) as [bigint, bigint, bigint, bigint, bigint];

  return {
    roundId: priceDataTuple[0],
    answer: priceDataTuple[1],
    startedAt: priceDataTuple[2],
    updatedAt: priceDataTuple[3], // ← block when feed was last updated
    answeredInRound: priceDataTuple[4],
  };
}

function writePriceSnapshot(
  runtime: Runtime<Config>,
  evmClient: InstanceType<typeof cre.capabilities.EVMClient>,
  record: {
    token:       string;
    price:       bigint;
    blockNumber: bigint;
    timestamp:   bigint;
  }
): string {
  const PriceSnapshotAddress = runtime.config.evms[0].PriceSnapshotAddress as Address;

  // Encode Record fields as ABI parameters 
  const reportData = encodeAbiParameters(
    parseAbiParameters("string token, uint256 price, uint256 blockNumber, uint256 timestamp"),
    [record.token, record.price, record.blockNumber, record.timestamp]
  );

  runtime.log(`[WRITE] Encoded report data: ${reportData}`);

  // Generate cryptographically signed CRE report 
  const reportResponse = runtime
    .report({
      encodedPayload: hexToBase64(reportData),
      encoderName:   "evm",
      signingAlgo:   "ecdsa",
      hashingAlgo:   "keccak256",
    })
    .result();

  runtime.log(`[WRITE] Report generated, submitting to ${PriceSnapshotAddress}...`);

  // Write report on-chain 
  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: PriceSnapshotAddress,
      report:   reportResponse,
      gasConfig: {
        gasLimit: runtime.config.evms[0].gasLimit,
      },
    })
    .result();

  if (writeResult.txStatus === TxStatus.SUCCESS) {
    const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
    runtime.log(`[WRITE] Success! tx hash: ${txHash}`);
    return txHash;
  }

  throw new Error(`Transaction failed with status: ${writeResult.txStatus}`);
}

function onHttpTrigger(runtime: Runtime<Config>, payload: HTTPPayload): string {
  // Parse the incoming JSON body
  if (!payload.input || payload.input.length === 0) {
    return JSON.stringify({ error: "Empty request body" });
  }

  const inputData = decodeJson(payload.input) as { token?: string };
  const token = inputData.token?.toUpperCase();

  if (!token) {
    return JSON.stringify({ error: "Missing 'token' field in request body" });
  }

  // Pull dataFeeds from config
  const dataFeeds = (runtime.config.evms[0].dataFeeds ?? {}) as Record<
    string,
    string
  >;
  const feedAddress = dataFeeds[token] as Address | undefined;

  if (!feedAddress) {
    return JSON.stringify({
      error: `Unsupported token: ${token}`,
      supported: Object.keys(dataFeeds), // ← reads whatever is in your config file
    });
  }

  runtime.log(`[HTTP] Token requested: ${token}`);
  runtime.log(`[HTTP] Using feed address: ${feedAddress}`);

  // Set up EVM client
  const evmConfig = runtime.config.evms[0];
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: evmConfig.chainSelectorName,
    isTestnet: true,
  });

  if (!network) {
    throw new Error(`Unknown chain: ${evmConfig.chainSelectorName}`);
  }

  const evmClient = new cre.capabilities.EVMClient(
    network.chainSelector.selector,
  );

   // STEP 1: EVM READ 
  const priceData = getPriceData(runtime, evmClient, feedAddress);

  // Map latestRoundData() → Record fields
  const price       = priceData.answer;               // uint256 price (×1e8)
  const blockNumber = priceData.updatedAt;            // block feed was last updated
  const timestamp   = BigInt(Math.floor(Date.now() / 1000)); // unix seconds now

  const priceUsd = Number(price) / 10 ** 8;
  runtime.log(`[READ]  ${token}/USD = $${priceUsd.toFixed(2)}`);
  runtime.log(`[READ]  blockNumber  = ${blockNumber}`);
  runtime.log(`[READ]  timestamp    = ${timestamp}`);

  // STEP 2: EVM WRITE (two-step) 
  const txHash = writePriceSnapshot(runtime, evmClient, {
    token,
    price,
    blockNumber,
    timestamp,
  });

  return JSON.stringify({
    token,
    priceUsd:    (Number(price) / 1e8).toFixed(2),
    price:       price.toString(),
    blockNumber: blockNumber.toString(),
    timestamp:   timestamp.toString(),
    txHash,
  });
}

const initWorkflow = (config: Config) => {
  const http = new cre.capabilities.HTTPCapability();

  return [
    cre.handler(
      http.trigger({
        authorizedKeys: [
          {
            type: "KEY_TYPE_ECDSA_EVM",
            publicKey: "",
          },
        ],
      }),
      onHttpTrigger,
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
